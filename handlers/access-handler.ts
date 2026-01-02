/**
 * Cloudflare Access OAuth Handler
 * Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/access-handler.ts
 */

import { Buffer } from "node:buffer";
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

type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

export async function handleAccessRequest(
	request: Request,
	env: EnvWithOAuth,
	_ctx: ExecutionContext,
): Promise<Response> {
	try {
		const { pathname, searchParams } = new URL(request.url);

		if (request.method === "GET" && pathname === "/authorize") {
			const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
			const { clientId } = oauthReqInfo;
			if (!clientId) {
				return new Response("Invalid request: missing client_id", { status: 400 });
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
		}

		if (request.method === "POST" && pathname === "/authorize") {
			try {
				const formData = await request.formData();
				validateCSRFToken(formData, request);

				const encodedState = formData.get("state");
				if (!encodedState || typeof encodedState !== "string") {
					return new Response("Missing state in form data", { status: 400 });
				}

				let state: { oauthReqInfo?: AuthRequest };
				try {
					state = JSON.parse(atob(encodedState));
				} catch {
					return new Response("Invalid state data", { status: 400 });
				}

				if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
					return new Response("Invalid request", { status: 400 });
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
			} catch (error) {
				console.error("POST /authorize error:", error);
				if (error instanceof OAuthError) {
					return error.toResponse();
				}
				return new Response(`Internal server error: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
			}
		}

		if (request.method === "GET" && pathname === "/callback") {
			let oauthReqInfo: AuthRequest;
			let codeVerifier: string | undefined;

			try {
				const result = await validateOAuthState(request, env.OAUTH_KV);
				oauthReqInfo = result.oauthReqInfo;
				codeVerifier = result.codeVerifier;
			} catch (error) {
				if (error instanceof OAuthError) {
					return error.toResponse();
				}
				return new Response("Internal server error", { status: 500 });
			}

			if (!oauthReqInfo.clientId) {
				return new Response("Invalid OAuth request data", { status: 400 });
			}

			// Exchange the code for an access token
			const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
				client_id: env.ACCESS_CLIENT_ID,
				client_secret: env.ACCESS_CLIENT_SECRET,
				code: searchParams.get("code") ?? undefined,
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
				} as Props,
				request: oauthReqInfo,
				scope: oauthReqInfo.scope,
				userId: user.sub,
			});

			return Response.redirect(redirectTo, 302);
		}

		return new Response("Not Found", { status: 404 });
	} catch (error) {
		console.error("handleAccessRequest error:", error);
		return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
	}
}

async function redirectToAccess(
	request: Request,
	env: Env,
	stateToken: string,
	codeChallenge: string,
	headers: Record<string, string> = {},
): Promise<Response> {
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

/**
 * Helper to get the Access public keys from the certs endpoint
 */
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
	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{
			hash: "SHA-256",
			name: "RSASSA-PKCS1-v1_5",
		},
		false,
		["verify"],
	);
	return key;
}

/**
 * Parse a JWT into its respective pieces
 */
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

/**
 * Validates the provided token using the Access public key set
 */
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
