// workers-oauth-utils.ts
// OAuth utility functions with CSRF and state validation security fixes
// Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/workers-oauth-utils.ts

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

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

export interface OAuthStateResult {
	stateToken: string;
}

export interface ValidateStateResult {
	oauthReqInfo: AuthRequest;
	codeVerifier?: string;
	clearCookie: string;
}

export interface CSRFProtectionResult {
	token: string;
	setCookie: string;
}

export interface ValidateCSRFResult {
	clearCookie: string;
}


export function generateCSRFProtection(): CSRFProtectionResult {
	const csrfCookieName = "__Host-CSRF_TOKEN";
	const token = crypto.randomUUID();
	const setCookie = `${csrfCookieName}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
	return { token, setCookie };
}

export function validateCSRFToken(formData: FormData, request: Request): ValidateCSRFResult {
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

	const clearCookie = `${csrfCookieName}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
	return { clearCookie };
}

export async function createOAuthState(
	oauthReqInfo: AuthRequest,
	kv: KVNamespace,
	codeVerifier?: string,
	stateTTL = 600,
): Promise<OAuthStateResult> {
	const stateToken = crypto.randomUUID();
	const stateData = { oauthReqInfo, codeVerifier };
	await kv.put(`oauth:state:${stateToken}`, JSON.stringify(stateData), {
		expirationTtl: stateTTL,
	});
	return { stateToken };
}

export async function validateOAuthState(
	request: Request,
	kv: KVNamespace,
): Promise<ValidateStateResult> {
	const url = new URL(request.url);
	const stateFromQuery = url.searchParams.get("state");

	if (!stateFromQuery) {
		throw new OAuthError("invalid_request", "Missing state parameter", 400);
	}

	const storedDataJson = await kv.get(`oauth:state:${stateFromQuery}`);
	if (!storedDataJson) {
		throw new OAuthError("invalid_request", "Invalid or expired state", 400);
	}

	let stateData: { oauthReqInfo: AuthRequest; codeVerifier?: string };
	try {
		stateData = JSON.parse(storedDataJson);
	} catch {
		throw new OAuthError("server_error", "Invalid state data", 500);
	}

	await kv.delete(`oauth:state:${stateFromQuery}`);
	const clearCookie = "";

	return { oauthReqInfo: stateData.oauthReqInfo, codeVerifier: stateData.codeVerifier, clearCookie };
}

export async function isClientApproved(
	request: Request,
	clientId: string,
	cookieSecret: string,
): Promise<boolean> {
	const approvedClients = await getApprovedClientsFromCookie(request, cookieSecret);
	return approvedClients?.includes(clientId) ?? false;
}

export async function addApprovedClient(
	request: Request,
	clientId: string,
	cookieSecret: string,
): Promise<string> {
	const approvedClientsCookieName = "__Host-APPROVED_CLIENTS";
	const THIRTY_DAYS_IN_SECONDS = 2592000;

	const existingApprovedClients =
		(await getApprovedClientsFromCookie(request, cookieSecret)) || [];
	const updatedApprovedClients = Array.from(new Set([...existingApprovedClients, clientId]));

	const payload = JSON.stringify(updatedApprovedClients);
	const signature = await signData(payload, cookieSecret);
	const cookieValue = `${signature}.${btoa(payload)}`;

	return `${approvedClientsCookieName}=${cookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${THIRTY_DAYS_IN_SECONDS}`;
}

// --- Helper Functions ---

async function getApprovedClientsFromCookie(
	request: Request,
	cookieSecret: string,
): Promise<string[] | null> {
	const approvedClientsCookieName = "__Host-APPROVED_CLIENTS";

	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(";").map((c) => c.trim());
	const targetCookie = cookies.find((c) => c.startsWith(`${approvedClientsCookieName}=`));

	if (!targetCookie) return null;

	const cookieValue = targetCookie.substring(approvedClientsCookieName.length + 1);
	const parts = cookieValue.split(".");

	if (parts.length !== 2) return null;

	const [signatureHex, base64Payload] = parts;
	const payload = atob(base64Payload);

	const isValid = await verifySignature(signatureHex, payload, cookieSecret);
	if (!isValid) return null;

	try {
		const approvedClients = JSON.parse(payload);
		if (!Array.isArray(approvedClients) || !approvedClients.every((item) => typeof item === "string")) {
			return null;
		}
		return approvedClients as string[];
	} catch {
		return null;
	}
}

async function signData(data: string, secret: string): Promise<string> {
	const key = await importKey(secret);
	const enc = new TextEncoder();
	const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(data));
	return new Uint8Array(signatureBuffer).toHex();
}

async function verifySignature(signatureHex: string, data: string, secret: string): Promise<boolean> {
	const key = await importKey(secret);
	const enc = new TextEncoder();
	try {
		const signatureBytes = Uint8Array.fromHex(signatureHex);
		return await crypto.subtle.verify("HMAC", key, signatureBytes, enc.encode(data));
	} catch {
		return false;
	}
}

async function importKey(secret: string): Promise<CryptoKey> {
	if (!secret) {
		throw new Error("cookieSecret is required for signing cookies");
	}
	const enc = new TextEncoder();
	return crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ hash: "SHA-256", name: "HMAC" },
		false,
		["sign", "verify"],
	);
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
}): Promise<[string, string, null] | [null, null, Response]> {
	if (!params.code) {
		return [null, null, new Response("Missing authorization code", { status: 400 })];
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
		return [null, null, new Response(`Failed to exchange code for token: ${errorText}`, { status: response.status })];
	}

	const body = (await response.json()) as { access_token?: string; id_token?: string };

	const accessToken = body.access_token;
	if (!accessToken) {
		return [null, null, new Response("Missing access token", { status: 400 })];
	}

	const idToken = body.id_token;
	if (!idToken) {
		return [null, null, new Response("Missing id token", { status: 400 })];
	}

	return [accessToken, idToken, null];
}

export interface Props {
	accessToken: string;
	email: string;
	login: string;
	name: string;
	workerBaseUrl: string;
	[key: string]: unknown;
}
