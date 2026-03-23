/**
 * Cloudflare Access OAuth Handler using Hono
 * Based on: https://github.com/cloudflare/ai/blob/main/demos/remote-mcp-cf-access/src/access-handler.ts
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { HTTPException } from "hono/http-exception";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { AuthCfAccessEnv, AuthContext, Props } from "../../index";
import {
	addApprovedClient,
	deflateToBase64url,
	fetchUpstreamAuthToken,
	generateCodeChallenge,
	generateCodeVerifier,
	getUpstreamAuthorizeUrl,
	inflateFromBase64url,
	isClientApproved,
	packState,
	setStateCSRF,
	unpackState,
	validateStateCSRF,
} from "./workers-oauth-utils";
import { ApprovalPage } from "./approval-page";
import { ConsentPage } from "./consent-page";
import { initKernel, getFileAPIv2, normalizePath } from "../mcp-backend/syapi";
import { decryptGrant } from "../mcp-backend/utils/fakeEncrypt";

// Import static files accessor
import { getFileContent } from "./static";
import { verifyToken } from "./jwt";

type HonoEnv = { Bindings: AuthCfAccessEnv };

/** Grant record structure from KV */
interface GrantRecord {
	userId: string;
	clientId: string;
	scope: string[];
	encryptedProps: string;
	expiresAt?: number;
}

/** Build upstream CF Access redirect URL with compact state */
async function buildUpstreamRedirect(oauthReqInfo: AuthRequest, env: AuthCfAccessEnv, requestUrl: string): Promise<string> {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = await deflateToBase64url(packState({ oauthReqInfo, codeVerifier }));
	return getUpstreamAuthorizeUrl({
		client_id: env.ACCESS_CLIENT_ID,
		redirect_uri: new URL("/callback", requestUrl).href,
		scope: "openid email profile",
		state,
		upstream_url: env.ACCESS_AUTHORIZATION_URL,
		code_challenge: codeChallenge,
	});
}

async function lookupClient(env: AuthCfAccessEnv, clientId: string) {
	try { return await env.OAUTH_PROVIDER.lookupClient(clientId); }
	catch { return null; }
}

export const app = new Hono<HonoEnv>();

app.use("*", cors({
	origin: "*",
	allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
	allowHeaders: ["Content-Type", "Accept", "Authorization", "X-SiYuan-Key", "mcp-session-id", "MCP-Protocol-Version"],
	maxAge: 86400,
}), async (c, next) => {
	await next();
	c.header("Content-Security-Policy", "frame-ancestors 'none'");
	c.header("X-Frame-Options", "DENY");
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

	const clientInfo = await lookupClient(env, clientId);
	const state = await deflateToBase64url(packState({oauthReqInfo, codeVerifier: generateCodeVerifier()}));
	await setStateCSRF(c, state);

	return c.html(
		<ApprovalPage
			request={request}
			client={clientInfo}
			server={serverInfo}
			state={state}
		/>,
	);
});

// POST /authorize - Handle approval form submission
app.post("/authorize", async (c) => {
	const env = c.env;
	const request = c.req.raw;

	const formData = await request.formData();

	const encodedState = formData.get("state");
	if (!encodedState || typeof encodedState !== "string") {
		return c.text("Missing state in form data", 400);
	}

	await validateStateCSRF(c, encodedState);

	let state: { oauthReqInfo?: AuthRequest };
	try {
		state = unpackState(await inflateFromBase64url(encodedState));
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

	let oauthReqInfo: AuthRequest;
	let codeVerifier: string;
	try {
		const unpacked = unpackState(await inflateFromBase64url(stateParam));
		oauthReqInfo = unpacked.oauthReqInfo;
		codeVerifier = unpacked.codeVerifier!;
	} catch {
		return c.text("Invalid state data", 400);
	}

	if (!oauthReqInfo?.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	// Exchange the code for an access token
	const idToken = await fetchUpstreamAuthToken({
		client_id: env.ACCESS_CLIENT_ID,
		client_secret: env.ACCESS_CLIENT_SECRET,
		code: code ?? undefined,
		redirect_uri: new URL("/callback", request.url).href,
		upstream_url: env.ACCESS_TOKEN_URL,
		code_verifier: codeVerifier,
	});

	const { email, name, sub } = await verifyToken(env, idToken) as { email: string; name: string; sub: string };
	const clientInfo = await lookupClient(env, oauthReqInfo.clientId);
	const state = await deflateToBase64url(packState({
		oauthReqInfo,
		user: {email, name, sub},
		codeVerifier: generateCodeVerifier()
	}));
	await setStateCSRF(c, state);

	return c.html(
		<ConsentPage
			client={clientInfo}
			user={{ email, name }}
			server={serverInfo}
			defaults={{
				label: name,
				hasServerKernelUrl: !!env.SIYUAN_KERNEL_URL,
				hasServerKernelToken: !!env.SIYUAN_KERNEL_TOKEN,
			}}
			state={state}
		/>,
	);
});

// POST /callback - Process consent form and complete authorization
app.post("/callback", async (c) => {
	const env = c.env;
	const request = c.req.raw;

	const formData = await request.formData();

	const encodedState = formData.get("state");
	if (!encodedState || typeof encodedState !== "string") {
		return c.text("Missing state", 400);
	}

	await validateStateCSRF(c, encodedState);

	let state: { oauthReqInfo: AuthRequest; user?: { email: string; name: string; sub: string } };
	try {
		state = unpackState(await inflateFromBase64url(encodedState));
	} catch {
		return c.text("Invalid state data", 400);
	}

	if (!state.oauthReqInfo?.clientId || !state.user) {
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

// MCP forwarding helpers (called by OAuthProvider apiHandlers after token validation)
function unauthorized(c: Context<HonoEnv>): never {
	throw new HTTPException(401, {
		res: c.json({
			jsonrpc: '2.0', error: {
				code: ErrorCode.ConnectionClosed, message: 'Unauthorized'
			}, id: null
		}, 401),
	});
}

export async function extractAuthContext(c: Context<HonoEnv>): Promise<AuthContext> {
	const props = (c.executionCtx as ExecutionContext).props as Props;
	if (!props) unauthorized(c);

	const authHeader = c.req.header('Authorization');
	if (!authHeader?.startsWith('Bearer ')) unauthorized(c);

	// Token format is userId:grantId:secret — extract without full unwrap
	const parts = authHeader.slice(7).split(':');
	if (parts.length !== 3) unauthorized(c);

	const [userId, grantId] = parts;
	return { ...props, secret: `${userId}:${grantId}` };
}
