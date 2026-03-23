// workers-oauth-utils.ts
// OAuth utility functions with CSRF and state validation security fixes
// Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/workers-oauth-utils.ts

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { encode as msgpackEncode, decode as msgpackDecode } from "@msgpack/msgpack";
import { pack7bit, unpack7bit, base64urlEncode, base64urlDecode } from "../mcp-backend/utils/fakeEncrypt";

/** Throw an OAuth-style error response as HTTPException */
function oauthError(status: number, error: string, description: string): never {
	throw new HTTPException(status as ContentfulStatusCode, {
		res: Response.json({ error, error_description: description }, { status }),
	});
}

export function unauthorized(c: Context): never {
	throw new HTTPException(401, {
		res: c.json({
			jsonrpc: '2.0', error: {
				code: ErrorCode.ConnectionClosed, message: 'Unauthorized'
			}, id: null
		}, 401),
	});
}

const CSRF_COOKIE = "__Host-CSRF_TOKEN";

/** Set CSRF cookie as a truncated SHA-256 hash of the state value */
export async function setStateCSRF(c: Context, state: string): Promise<void> {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
	const token = new Uint8Array(hash, 0, 16).toHex();
	setCookie(c, CSRF_COOKIE, token, {
		httpOnly: true, secure: true, path: "/", sameSite: "Lax", maxAge: 600,
	});
}

/** Validate that the submitted state matches the CSRF cookie hash */
export async function validateStateCSRF(c: Context, state: string): Promise<void> {
	const tokenFromCookie = getCookie(c, CSRF_COOKIE);
	if (!tokenFromCookie) {
		oauthError(400, "invalid_request", "Missing CSRF cookie");
	}

	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
	const expected = new Uint8Array(hash, 0, 16).toHex();
	if (expected !== tokenFromCookie) {
		oauthError(400, "invalid_request", "CSRF validation failed");
	}
}


const APPROVED_CLIENTS_COOKIE = "__Host-APPROVED_CLIENTS";
const THIRTY_DAYS_IN_SECONDS = 2592000;

export async function isClientApproved(
	c: Context,
	clientId: string,
	cookieSecret: string,
): Promise<boolean> {
	const value = await getSignedCookie(c, cookieSecret, APPROVED_CLIENTS_COOKIE);
	if (!value) return false;
	try {
		const clients = JSON.parse(value);
		return Array.isArray(clients) && clients.includes(clientId);
	} catch {
		return false;
	}
}

export async function addApprovedClient(
	c: Context,
	clientId: string,
	cookieSecret: string,
): Promise<void> {
	let existing: string[] = [];
	const value = await getSignedCookie(c, cookieSecret, APPROVED_CLIENTS_COOKIE);
	if (value) {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) existing = parsed;
		} catch { /* ignore malformed cookie */ }
	}

	const updated = Array.from(new Set([...existing, clientId]));
	await setSignedCookie(c, APPROVED_CLIENTS_COOKIE, JSON.stringify(updated), cookieSecret, {
		httpOnly: true,
		secure: true,
		path: "/",
		sameSite: "Lax",
		maxAge: THIRTY_DAYS_IN_SECONDS,
	});
}

// Generate PKCE code verifier
export function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return array.toHex();
}

// Generate PKCE code challenge (S256)
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function getUpstreamAuthorizeUrl(params: {
	upstream_url: string;
	client_id: string;
	redirect_uri: string;
	scope: string;
	state: string;
	code_challenge?: string;
}): string {
	const url = new URL(params.upstream_url);
	url.searchParams.set("client_id", params.client_id);
	url.searchParams.set("redirect_uri", params.redirect_uri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", params.scope);
	url.searchParams.set("state", params.state);
	if (params.code_challenge) {
		url.searchParams.set("code_challenge", params.code_challenge);
		url.searchParams.set("code_challenge_method", "S256");
	}
	return url.toString();
}

export async function fetchUpstreamAuthToken(params: {
	upstream_url: string;
	client_id: string;
	client_secret: string;
	code?: string;
	redirect_uri: string;
	code_verifier?: string;
}): Promise<string> {
	if (!params.code) {
		oauthError(400, "invalid_request", "Missing authorization code");
	}

	const data = new URLSearchParams({
		client_id: params.client_id,
		client_secret: params.client_secret,
		code: params.code,
		grant_type: "authorization_code",
		redirect_uri: params.redirect_uri,
	});
	if (params.code_verifier) {
		data.set("code_verifier", params.code_verifier);
	}

	const response = await fetch(params.upstream_url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: data.toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		oauthError(response.status, "server_error", `Failed to exchange code for token: ${errorText}`);
	}

	const body = (await response.json()) as { id_token?: string };
	const idToken = body.id_token;
	if (!idToken) {
		oauthError(400, "server_error", "Missing id token");
	}

	return idToken;
}

/** Deflate-compress + base64url encode */
export async function deflateToBase64url(data: Uint8Array): Promise<string> {
	const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
	const buf = await new Response(stream).arrayBuffer();
	return base64urlEncode(new Uint8Array(buf));
}

/** Base64url decode + inflate-decompress */
export async function inflateFromBase64url(encoded: string): Promise<Uint8Array> {
	const bytes = base64urlDecode(encoded);
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Pack AuthRequest (+ optional codeVerifier/user) as MessagePack array.
 * Text fields are GSM 7-bit packed (12.5% savings on ASCII).
 * Binary fields (hex/base64url) decoded to raw bytes.
 * Constants (responseType="code", codeChallengeMethod="S256") omitted.
 * Text: clientId\nredirectUri\nscope\nstate[\nresource...]\remail\nname\nsub
 * Format: [packed7bitText, codeVerifier?, codeChallenge?]
 */
export function packState(opts: {
	oauthReqInfo: AuthRequest;
	codeVerifier?: string;
	user?: { email: string; name: string; sub: string };
}): Uint8Array {
	const { oauthReqInfo, codeVerifier, user } = opts;
	const textParts = [
		oauthReqInfo.clientId,
		oauthReqInfo.redirectUri,
		oauthReqInfo.scope.join(" "),
		oauthReqInfo.state,
	];
	const resource = oauthReqInfo.resource;
	if (resource) {
		if (Array.isArray(resource)) textParts.push(...resource);
		else textParts.push(resource);
	}
	let text = textParts.join("\n");
	if (user) {
		text += "\r" + [user.email, user.name, user.sub].join("\n");
	}
	const arr: unknown[] = [pack7bit(text)];
	if (codeVerifier) {
		arr.push(Uint8Array.fromHex(codeVerifier));
		if (oauthReqInfo.codeChallenge) {
			arr.push(Uint8Array.fromBase64(oauthReqInfo.codeChallenge, { alphabet: "base64url" }));
		}
	}
	return msgpackEncode(arr);
}

export function unpackState(buf: Uint8Array): {
	oauthReqInfo: AuthRequest;
	codeVerifier?: string;
	user?: { email: string; name: string; sub: string };
} {
	const arr = msgpackDecode(buf) as [Uint8Array, Uint8Array?, Uint8Array?];
	const maxSeptets = Math.floor((arr[0].length * 8) / 7);
	const fullText = unpack7bit(arr[0], maxSeptets);
	const [oauthText, userText] = fullText.split("\r");
	const parts = oauthText.split("\n");
	const result: ReturnType<typeof unpackState> = {
		oauthReqInfo: {
			responseType: "code",
			clientId: parts[0],
			redirectUri: parts[1],
			scope: parts[2].split(" "),
			state: parts[3],
			codeChallenge: arr[2]?.toBase64({ alphabet: "base64url", omitPadding: true }),
			codeChallengeMethod: arr[2] ? "S256" : undefined,
			resource: parts.length > 5 ? parts.slice(4) : (parts[4] || undefined),
		},
	};
	if (arr[1]) {
		result.codeVerifier = (arr[1] as Uint8Array).toHex();
	}
	if (userText) {
		const userParts = userText.split("\n");
		result.user = { email: userParts[0], name: userParts[1], sub: userParts[2] };
	}
	return result;
}
