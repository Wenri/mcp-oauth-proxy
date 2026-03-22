// workers-oauth-utils.ts
// OAuth utility functions with CSRF and state validation security fixes
// Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/workers-oauth-utils.ts

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { encode as msgpackEncode, decode as msgpackDecode } from "@msgpack/msgpack";
import { pack7bit, unpack7bit, base64urlEncode, base64urlDecode } from "../mcp-backend/utils/fakeEncrypt";

/**
 * OAuth 2.1 compliant error class.
 * Represents errors that occur during OAuth operations with standardized error codes and descriptions.
 */
export class OAuthError extends Error {
	constructor(
		public code: string,
		public description: string,
		public statusCode = 400,
	) {
		super(description);
		this.name = "OAuthError";
	}

	toResponse(): Response {
		return new Response(
			JSON.stringify({
				error: this.code,
				error_description: this.description,
			}),
			{
				status: this.statusCode,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}

export function generateCSRFProtection(): { token: string; setCookie: string } {
	const csrfCookieName = "__Host-CSRF_TOKEN";
	const token = crypto.randomUUID();
	const setCookie = `${csrfCookieName}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
	return { token, setCookie };
}

export function validateCSRFToken(formData: FormData, request: Request): void {
	const csrfCookieName = "__Host-CSRF_TOKEN";

	const tokenFromForm = formData.get("csrf_token");
	if (!tokenFromForm || typeof tokenFromForm !== "string") {
		throw new OAuthError("invalid_request", "Missing CSRF token in form data", 400);
	}

	const cookieHeader = request.headers.get("Cookie") || "";
	const cookies = cookieHeader.split(";").map((c) => c.trim());
	const csrfCookie = cookies.find((c) => c.startsWith(`${csrfCookieName}=`));
	const tokenFromCookie = csrfCookie ? csrfCookie.substring(csrfCookieName.length + 1) : null;

	if (!tokenFromCookie) {
		throw new OAuthError("invalid_request", "Missing CSRF token cookie", 400);
	}

	if (tokenFromForm !== tokenFromCookie) {
		throw new OAuthError("invalid_request", "CSRF token mismatch", 400);
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
		throw new OAuthError("invalid_request", "Missing authorization code");
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
		throw new OAuthError("server_error", `Failed to exchange code for token: ${errorText}`, response.status);
	}

	const body = (await response.json()) as { id_token?: string };
	const idToken = body.id_token;
	if (!idToken) {
		throw new OAuthError("server_error", "Missing id token");
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
 * Pack AuthRequest + codeVerifier as MessagePack array.
 * Text fields are GSM 7-bit packed (12.5% savings on ASCII).
 * Binary fields (hex/base64url) decoded to raw bytes.
 * Constants (responseType="code", codeChallengeMethod="S256") omitted.
 * Text: clientId\nredirectUri\nscope\nstate[\nresource...]
 * Format: [codeVerifier, packed7bitText, codeChallenge?]
 */
export function packState(oauthReqInfo: AuthRequest, codeVerifier: string): Uint8Array {
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
	const arr: unknown[] = [
		Uint8Array.fromHex(codeVerifier),
		pack7bit(textParts.join("\n")),
	];
	if (oauthReqInfo.codeChallenge) {
		arr.push(Uint8Array.fromBase64(oauthReqInfo.codeChallenge, { alphabet: "base64url" }));
	}
	return msgpackEncode(arr);
}

export function unpackState(buf: Uint8Array): { oauthReqInfo: AuthRequest; codeVerifier: string } {
	const arr = msgpackDecode(buf) as [Uint8Array, Uint8Array, Uint8Array?];
	const maxSeptets = Math.floor((arr[1].length * 8) / 7);
	const parts = unpack7bit(arr[1], maxSeptets).split("\n");
	return {
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
		codeVerifier: (arr[0] as Uint8Array).toHex(),
	};
}
