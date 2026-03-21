/**
 * Cloudflare Access OAuth Handler using Hono
 * Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/access-handler.ts
 */

import { Hono } from "hono";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AuthCfAccessEnv } from "../../index";
import type { Props } from "../../index";
import {
	addApprovedClient,
	fetchUpstreamAuthToken,
	generateCodeChallenge,
	generateCodeVerifier,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	isClientApproved,
	OAuthError,
	validateCSRFToken,
} from "./workers-oauth-utils";
import { ApprovalPage } from "./approval-page";
import { ConsentPage } from "./consent-page";
import { initKernel, getFileAPIv2, normalizePath } from "../mcp-backend/syapi";
import { decryptGrant } from "../mcp-backend/utils/crypto";

// Import static files accessor
import { getFileContent } from "./static";
import { verifyToken } from "./jwt";

type Env = AuthCfAccessEnv;

type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };
type HonoEnv = { Bindings: EnvWithOAuth };

/** Grant record structure from KV */
interface GrantRecord {
	userId: string;
	clientId: string;
	scope: string[];
	encryptedProps: string;
	expiresAt?: number;
}

/** Build upstream CF Access redirect URL with base64-encoded state (no KV needed) */
async function buildUpstreamRedirect(oauthReqInfo: AuthRequest, env: EnvWithOAuth, requestUrl: string): Promise<string> {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = btoa(JSON.stringify({ oauthReqInfo, codeVerifier }));
	return getUpstreamAuthorizeUrl({
		client_id: env.ACCESS_CLIENT_ID,
		redirect_uri: new URL("/callback", requestUrl).href,
		scope: "openid email profile",
		state,
		upstream_url: env.ACCESS_AUTHORIZATION_URL,
		code_challenge: codeChallenge,
	});
}

const app = new Hono<HonoEnv>();

// Error handler
app.onError((error, c) => {
	console.error("handleAccessRequest error:", error);
	if (error instanceof OAuthError) {
		return error.toResponse();
	}
	return c.text(`Error: ${error.message}`, 500);
});

// Static file routes (public, no auth required)
app.get("/static/:name", async (c) => {
	const result = await getFileContent(c.req.param("name"));
	if (!result) {
		return c.text("Not found", 404);
	}
	return c.text(result.content, 200, {
		"Content-Type": result.mimeType,
		"Cache-Control": "public, max-age=86400",
	});
});

// GET /download/:token/* - Proxy file downloads using encrypted grant token
// URL format: /download/{encryptedToken}/temp/export/filename.zip
// Token is encrypted grantKey (userId:grantId) bound to the file path
app.get("/download/:token/*", async (c) => {
	const env = c.env;
	const token = c.req.param("token");
	// Get the path after /download/{token}, normalized to match encryption
	const filePath = normalizePath(c.req.path.split("/").slice(3).join("/"));

	// Decrypt token to get grantKey
	let grantKey: string;
	try {
		grantKey = await decryptGrant(token, filePath, env.COOKIE_ENCRYPTION_KEY);
	} catch {
		return c.text("Invalid token", 401);
	}

	// Parse grantKey
	const colonIndex = grantKey.indexOf(":");
	if (colonIndex === -1) {
		return c.text("Invalid token format", 401);
	}
	const userId = grantKey.slice(0, colonIndex);
	const grantId = grantKey.slice(colonIndex + 1);

	// Verify grant exists and is not expired
	const grant = await env.OAUTH_KV.get<GrantRecord>(`grant:${userId}:${grantId}`, "json");
	if (!grant) {
		return c.text("Grant not found or revoked", 401);
	}
	if (grant.expiresAt && grant.expiresAt < Math.floor(Date.now() / 1000)) {
		return c.text("Grant expired", 401);
	}

	// Calculate cache TTL from grant expiry (default 1 hour if no expiry)
	const now = Math.floor(Date.now() / 1000);
	const cacheTtl = grant.expiresAt ? Math.max(0, grant.expiresAt - now) : 3600;

	// Initialize kernel with service token
	const kernelUrl = env.SIYUAN_KERNEL_URL || new URL(c.req.url).origin;
	initKernel(
		kernelUrl,
		env.SIYUAN_KERNEL_TOKEN,
		env.CF_ACCESS_SERVICE_CLIENT_ID,
		env.CF_ACCESS_SERVICE_CLIENT_SECRET,
	);

	// Fetch file using syapi (caching handled by getFileAPIv2)
	const response = await getFileAPIv2(filePath.slice(1), cacheTtl);
	if (!response) {
		return c.text("File not found", 404);
	}

	// Build response headers from upstream
	const filename = filePath.split("/").pop() || "download";
	const headers = new Headers(response.headers);
	headers.set("Content-Disposition", `attachment; filename="${filename}"`);

	return new Response(response.body, {
		status: response.status,
		headers,
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
	if (await isClientApproved(c, clientId, env.COOKIE_ENCRYPTION_KEY)) {
		return c.redirect(await buildUpstreamRedirect(oauthReqInfo, env, request.url));
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

	c.header("Set-Cookie", setCookie);
	c.header("Content-Security-Policy", "frame-ancestors 'none'");
	c.header("X-Frame-Options", "DENY");
	return c.html(
		<ApprovalPage
			request={request}
			client={clientInfo}
			server={serverInfo}
			state={{ oauthReqInfo }}
			csrfToken={csrfToken}
		/>,
	);
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

	await addApprovedClient(c, state.oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY);

	return c.redirect(await buildUpstreamRedirect(state.oauthReqInfo, env, request.url));
});

// Server info shared across pages
const serverInfo = {
	description: "SiYuan Note MCP Server with Cloudflare Access authentication.",
	logo: "https://b3log.org/images/brand/siyuan-128.png",
	name: "SiYuan MCP Server",
};

// GET /callback - Exchange code, verify JWT, show consent page
app.get("/callback", async (c) => {
	const env = c.env;
	const request = c.req.raw;
	const code = c.req.query("code");
	const stateParam = c.req.query("state");

	if (!stateParam) {
		return c.text("Missing state parameter", 400);
	}

	let upstreamState: { oauthReqInfo: AuthRequest; codeVerifier?: string };
	try {
		upstreamState = JSON.parse(atob(stateParam));
	} catch {
		return c.text("Invalid state data", 400);
	}

	const { oauthReqInfo, codeVerifier } = upstreamState;

	if (!oauthReqInfo?.clientId) {
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

	let clientInfo = null;
	try {
		clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
	} catch { /* client not found */ }

	const { token: csrfToken, setCookie } = generateCSRFProtection();
	const state = btoa(JSON.stringify({ oauthReqInfo, user, accessToken }));

	c.header("Set-Cookie", setCookie);
	c.header("Content-Security-Policy", "frame-ancestors 'none'");
	c.header("X-Frame-Options", "DENY");
	return c.html(
		ConsentPage({
			client: clientInfo,
			user: { email: user.email, name: user.name },
			server: serverInfo,
			defaults: {
				label: user.name,
				hasServerKernelUrl: !!env.SIYUAN_KERNEL_URL,
				hasServerKernelToken: !!env.SIYUAN_KERNEL_TOKEN,
			},
			state,
			csrfToken,
		}),
	);
});

// POST /callback - Process consent form and complete authorization
app.post("/callback", async (c) => {
	const env = c.env;
	const request = c.req.raw;

	const formData = await request.formData();
	validateCSRFToken(formData, request);

	const encodedState = formData.get("state");
	if (!encodedState || typeof encodedState !== "string") {
		return c.text("Missing state", 400);
	}

	let state: { oauthReqInfo: AuthRequest; user: { email: string; name: string; sub: string }; accessToken: string };
	try {
		state = JSON.parse(atob(encodedState));
	} catch {
		return c.text("Invalid state data", 400);
	}

	// Read user-provided values
	const label = (formData.get("label") as string)?.trim() || state.user.name;
	const userKernelUrl = (formData.get("kernel_url") as string)?.trim() || undefined;
	const kernelToken = (formData.get("kernel_token") as string) || undefined;

	// Validate kernel URL if provided
	if (userKernelUrl) {
		try {
			const parsed = new URL(userKernelUrl);
			if (!["http:", "https:"].includes(parsed.protocol)) {
				return c.text("Invalid kernel URL: must be HTTP or HTTPS", 400);
			}
		} catch {
			return c.text("Invalid kernel URL", 400);
		}
	}

	// Resolve kernel URL: user input > env default > same origin fallback
	const workerBaseUrl = new URL(request.url).origin;
	const kernelUrl = userKernelUrl || env.SIYUAN_KERNEL_URL || workerBaseUrl;

	const props: Props = {
		accessToken: state.accessToken,
		email: state.user.email,
		login: state.user.sub,
		name: state.user.name,
		workerBaseUrl,
		kernelUrl,
		kernelToken: kernelToken || env.SIYUAN_KERNEL_TOKEN || undefined,
	};

	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label },
		props,
		request: state.oauthReqInfo,
		scope: state.oauthReqInfo.scope,
		userId: state.user.sub,
	});

	return c.redirect(redirectTo, 302);
});

// Export the Hono app directly (has .fetch method compatible with OAuthProvider)
export const accessApp = app;