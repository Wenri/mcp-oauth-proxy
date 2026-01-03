/**
 * Cloudflare Access OAuth Handler using Hono
 * Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/access-handler.ts
 */

import { Buffer } from "node:buffer";
import { Hono } from "hono";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../types";
import {
	addApprovedClient,
	createOAuthState,
	fetchUpstreamAuthToken,
	generateCodeChallenge,
	generateCodeVerifier,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	isClientApproved,
	OAuthError,
	type Props,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";
import { buildKernelHeaders } from "../siyuan-mcp";

type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };
type HonoEnv = { Bindings: EnvWithOAuth };

const app = new Hono<HonoEnv>();

// Error handler
app.onError((error, c) => {
	console.error("handleAccessRequest error:", error);
	if (error instanceof OAuthError) {
		return error.toResponse();
	}
	return c.text(`Error: ${error.message}`, 500);
});

// GET /download/:token/* - Proxy file downloads using OAuth token for auth
// URL format: /download/{oauth_token}/temp/export/filename.zip
app.get("/download/:token/*", async (c) => {
	const env = c.env;
	const token = c.req.param("token");
	// Get the path after /download/{token} (without leading slash for API)
	const filePath = c.req.path.split("/").slice(3).join("/");

	// Validate OAuth token and get props (includes cfAccessToken)
	const tokenData = await env.OAUTH_PROVIDER.unwrapToken<Props>(token);
	if (!tokenData) {
		return c.text("Invalid or expired token", 401);
	}

	// Fallback to request origin when SIYUAN_KERNEL_URL is not set
	const kernelUrl = env.SIYUAN_KERNEL_URL || new URL(c.req.url).origin;

	// Build auth headers using cfAccessToken from props
	const headers = buildKernelHeaders(
		env.SIYUAN_KERNEL_TOKEN,
		tokenData.grant.props.accessToken,
		env.CF_ACCESS_SERVICE_CLIENT_ID,
		env.CF_ACCESS_SERVICE_CLIENT_SECRET,
	);

	// Use /api/file/getFile API to fetch the file
	const apiUrl = new URL("/api/file/getFile", kernelUrl).href;
	const response = await fetch(apiUrl, {
		method: "POST",
		headers,
		body: JSON.stringify({ path: filePath }),
	});

	if (!response.ok) {
		return c.text(`Failed to fetch export file: ${response.status}`, response.status as any);
	}

	// Forward the response directly, preserving headers
	const responseHeaders = new Headers(response.headers);
	// Ensure Content-Disposition is set for downloads
	if (!responseHeaders.has("Content-Disposition")) {
		const filename = filePath.split("/").pop() || "download";
		responseHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
	}

	return new Response(response.body, {
		status: response.status,
		headers: responseHeaders,
	});
});

// GET /authorize - Show approval dialog or redirect if already approved
app.get("/authorize", async (c) => {
	const env = c.env;
	const request = c.req.raw;

	const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request: missing client_id", 400);
	}

	// Check if client is already approved
	if (await isClientApproved(request, clientId, env.COOKIE_ENCRYPTION_KEY)) {
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		const { stateToken } = await createOAuthState(oauthReqInfo, env.OAUTH_KV, codeVerifier);
		return redirectToAccess(request, env, stateToken, codeChallenge);
	}

	// Generate CSRF protection for the approval form
	const { token: csrfToken, setCookie } = generateCSRFProtection();

	// Lookup client info (may return null for unregistered clients)
	let clientInfo = null;
	try {
		clientInfo = await env.OAUTH_PROVIDER.lookupClient(clientId);
	} catch {
		// Client not found, continue with null
	}

	return renderApprovalDialog(request, {
		client: clientInfo,
		csrfToken,
		server: {
			description: "SiYuan Note MCP Server with Cloudflare Access authentication.",
			logo: "https://b3log.org/images/brand/siyuan-128.png",
			name: "SiYuan MCP Server",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

// POST /authorize - Handle approval form submission
app.post("/authorize", async (c) => {
	const env = c.env;
	const request = c.req.raw;

	const formData = await request.formData();
	validateCSRFToken(formData, request);

	const encodedState = formData.get("state");
	if (!encodedState || typeof encodedState !== "string") {
		return c.text("Missing state in form data", 400);
	}

	let state: { oauthReqInfo?: AuthRequest };
	try {
		state = JSON.parse(atob(encodedState));
	} catch {
		return c.text("Invalid state data", 400);
	}

	if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
		return c.text("Invalid request", 400);
	}

	const approvedClientCookie = await addApprovedClient(
		request,
		state.oauthReqInfo.clientId,
		env.COOKIE_ENCRYPTION_KEY,
	);

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const { stateToken } = await createOAuthState(state.oauthReqInfo, env.OAUTH_KV, codeVerifier);

	return redirectToAccess(request, env, stateToken, codeChallenge, {
		"Set-Cookie": approvedClientCookie,
	});
});

// GET /callback - Handle CF Access callback
app.get("/callback", async (c) => {
	const env = c.env;
	const request = c.req.raw;
	const code = c.req.query("code");

	const { oauthReqInfo, codeVerifier } = await validateOAuthState(request, env.OAUTH_KV);

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	// Exchange the code for an access token
	const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
		client_id: env.ACCESS_CLIENT_ID,
		client_secret: env.ACCESS_CLIENT_SECRET,
		code: code ?? undefined,
		redirect_uri: new URL("/callback", request.url).href,
		upstream_url: env.ACCESS_TOKEN_URL,
		code_verifier: codeVerifier,
	});
	if (errResponse) {
		return errResponse;
	}

	const idTokenClaims = await verifyToken(env, idToken);
	const user = {
		email: idTokenClaims.email as string,
		name: idTokenClaims.name as string,
		sub: idTokenClaims.sub as string,
	};

	// Return back to the MCP client a new token
	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: user.name,
		},
		props: {
			accessToken,
			email: user.email,
			login: user.sub,
			name: user.name,
			workerBaseUrl: new URL(request.url).origin,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: user.sub,
	});

	return c.redirect(redirectTo, 302);
});

// Export the Hono app directly (has .fetch method compatible with OAuthProvider)
export const accessApp = app;

// Helper functions

function redirectToAccess(
	request: Request,
	env: Env,
	stateToken: string,
	codeChallenge: string,
	headers: Record<string, string> = {},
): Response {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.ACCESS_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "openid email profile",
				state: stateToken,
				upstream_url: env.ACCESS_AUTHORIZATION_URL,
				code_challenge: codeChallenge,
			}),
		},
		status: 302,
	});
}

async function fetchAccessPublicKey(env: Env, kid: string): Promise<CryptoKey> {
	if (!env.ACCESS_JWKS_URL) {
		throw new Error("ACCESS_JWKS_URL not provided");
	}
	// TODO: cache this
	const resp = await fetch(env.ACCESS_JWKS_URL);
	if (!resp.ok) {
		throw new Error(`Failed to fetch JWKS from ${env.ACCESS_JWKS_URL}: ${resp.status}`);
	}
	const keys = (await resp.json()) as {
		keys: (JsonWebKey & { kid: string })[];
	};
	const availableKids = keys.keys?.map((k) => k.kid) || [];
	console.log(`JWKS: Looking for kid ${kid}, available: ${availableKids.join(", ")}`);
	const jwk = keys.keys.find((key) => key.kid === kid);
	if (!jwk) {
		throw new Error(`Key with kid ${kid} not found. Available keys: ${availableKids.join(", ")}`);
	}
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{ hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
		false,
		["verify"],
	);
}

function parseJWT(token: string): {
	data: string;
	header: { kid: string; alg: string };
	payload: Record<string, unknown>;
	signature: string;
} {
	const tokenParts = token.split(".");
	if (tokenParts.length !== 3) {
		throw new Error("token must have 3 parts");
	}
	return {
		data: `${tokenParts[0]}.${tokenParts[1]}`,
		header: JSON.parse(Buffer.from(tokenParts[0], "base64url").toString()),
		payload: JSON.parse(Buffer.from(tokenParts[1], "base64url").toString()),
		signature: tokenParts[2],
	};
}

async function verifyToken(env: Env, token: string): Promise<Record<string, unknown>> {
	const jwt = parseJWT(token);
	const key = await fetchAccessPublicKey(env, jwt.header.kid);

	const verified = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		Buffer.from(jwt.signature, "base64url"),
		Buffer.from(jwt.data),
	);

	if (!verified) {
		throw new Error("failed to verify token");
	}

	const claims = jwt.payload;
	const now = Math.floor(Date.now() / 1000);
	if (typeof claims.exp === "number" && claims.exp < now) {
		throw new Error("expired token");
	}

	return claims;
}
