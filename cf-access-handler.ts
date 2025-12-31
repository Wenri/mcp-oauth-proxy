import type { Env } from "./index";

/**
 * Cloudflare Access OAuth Handler
 *
 * This handler implements the OAuth flow using Cloudflare Access as the identity provider.
 * It handles:
 * 1. Redirecting users to Cloudflare Access for authentication
 * 2. Handling the OAuth callback with authorization code
 * 3. Exchanging the authorization code for tokens
 * 4. Storing and managing tokens in KV
 */

interface OAuthState {
  redirect_uri: string;
  code_verifier: string;
  client_id: string;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

interface JWTClaims {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
  aud: string[];
  exp: number;
  iat: number;
  iss: string;
  [key: string]: unknown;
}

// Helper to decode JWT claims (without verification - verification done by CF Access)
function decodeJWTClaims(token: string): JWTClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const payload = parts[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
}

// Generate a random string for state/verifier
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Generate code challenge from verifier (S256)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Build Cloudflare Access authorization URL
function buildAuthorizationUrl(
  teamDomain: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scope?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  if (scope) {
    params.set("scope", scope);
  }

  // Use OIDC-specific authorization endpoint with client_id in path
  return `https://${teamDomain}/cdn-cgi/access/sso/oidc/${clientId}/authorization?${params.toString()}`;
}

const CFAccessHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle authorization endpoint
    if (url.pathname === "/authorize") {
      return handleAuthorize(request, env);
    }

    // Handle OAuth callback from Cloudflare Access
    if (url.pathname === "/callback") {
      return handleCallback(request, env);
    }

    // Handle token endpoint
    if (url.pathname === "/token") {
      return handleToken(request, env);
    }

    // Handle client registration (dynamic client registration for MCP)
    if (url.pathname === "/register") {
      return handleClientRegistration(request, env);
    }

    // Handle well-known OAuth metadata
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return handleOAuthMetadata(request, env);
    }

    // Handle RFC 9728 Protected Resource Metadata
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return handleProtectedResourceMetadata(request, env);
    }

    // Default: return 404
    return new Response("Not found", { status: 404 });
  },
};

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const scope = url.searchParams.get("scope") || undefined;
  const state = url.searchParams.get("state");

  // Validate required parameters
  if (!clientId || !redirectUri) {
    return new Response("Missing required parameters: client_id, redirect_uri", { status: 400 });
  }

  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return new Response("Only S256 code_challenge_method is supported", { status: 400 });
  }

  // Generate our own state and code verifier for the CF Access flow
  const cfAccessState = generateRandomString(32);
  const cfAccessCodeVerifier = generateRandomString(64);
  const cfAccessCodeChallenge = await generateCodeChallenge(cfAccessCodeVerifier);

  // Store the original OAuth request state
  const oauthState: OAuthState = {
    redirect_uri: redirectUri,
    code_verifier: cfAccessCodeVerifier,
    client_id: clientId,
    scope,
  };

  // Store state in KV with the client's state as additional data
  await env.OAUTH_KV.put(
    `state:${cfAccessState}`,
    JSON.stringify({
      ...oauthState,
      original_state: state,
      original_code_challenge: codeChallenge,
    }),
    { expirationTtl: 600 } // 10 minutes
  );

  // Build callback URL (our server's callback endpoint)
  const baseUrl = new URL(request.url).origin;
  const callbackUrl = `${baseUrl}/callback`;

  // Redirect to Cloudflare Access
  const authUrl = buildAuthorizationUrl(
    env.CF_ACCESS_TEAM_DOMAIN,
    env.CF_ACCESS_CLIENT_ID,
    callbackUrl,
    cfAccessState,
    cfAccessCodeChallenge,
    scope
  );

  return Response.redirect(authUrl, 302);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return new Response(`OAuth error: ${error} - ${errorDescription}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  // Retrieve stored state
  const storedStateJson = await env.OAUTH_KV.get(`state:${state}`);
  if (!storedStateJson) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  const storedState = JSON.parse(storedStateJson) as OAuthState & {
    original_state?: string;
    original_code_challenge?: string;
  };

  // Exchange code for tokens with Cloudflare Access OIDC endpoint
  const tokenUrl = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/token`;
  const baseUrl = new URL(request.url).origin;

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: env.CF_ACCESS_CLIENT_ID,
      client_secret: env.CF_ACCESS_CLIENT_SECRET,
      redirect_uri: `${baseUrl}/callback`,
      code_verifier: storedState.code_verifier,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("Token exchange failed:", errorText);
    return new Response(`Token exchange failed: ${errorText}`, { status: 500 });
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;

  // Decode the ID token to get user claims
  let claims: JWTClaims;
  try {
    claims = decodeJWTClaims(tokens.id_token || tokens.access_token);
  } catch (error) {
    return new Response("Failed to decode token", { status: 500 });
  }

  // Generate our own authorization code to give back to the MCP client
  const mcpAuthCode = generateRandomString(32);

  // Store the tokens associated with this auth code
  await env.OAUTH_KV.put(
    `auth_code:${mcpAuthCode}`,
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      claims,
      client_id: storedState.client_id,
      redirect_uri: storedState.redirect_uri,
      original_code_challenge: storedState.original_code_challenge,
    }),
    { expirationTtl: 300 } // 5 minutes
  );

  // Clean up the state
  await env.OAUTH_KV.delete(`state:${state}`);

  // Redirect back to the MCP client with our auth code
  const redirectUrl = new URL(storedState.redirect_uri);
  redirectUrl.searchParams.set("code", mcpAuthCode);
  if (storedState.original_state) {
    redirectUrl.searchParams.set("state", storedState.original_state);
  }

  return Response.redirect(redirectUrl.toString(), 302);
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const contentType = request.headers.get("Content-Type") || "";
  let params: URLSearchParams;

  if (contentType.includes("application/json")) {
    const body = await request.json();
    params = new URLSearchParams(body as Record<string, string>);
  } else {
    const body = await request.text();
    params = new URLSearchParams(body);
  }

  const grantType = params.get("grant_type");
  const code = params.get("code");
  const clientId = params.get("client_id");
  const codeVerifier = params.get("code_verifier");
  const refreshToken = params.get("refresh_token");

  // Handle authorization code grant
  if (grantType === "authorization_code") {
    if (!code) {
      return jsonResponse({ error: "invalid_request", error_description: "Missing code" }, 400);
    }

    // Retrieve stored auth code data
    const authCodeData = await env.OAUTH_KV.get(`auth_code:${code}`);
    if (!authCodeData) {
      return jsonResponse(
        { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
        400
      );
    }

    const storedData = JSON.parse(authCodeData) as {
      access_token: string;
      refresh_token?: string;
      claims: JWTClaims;
      client_id: string;
      redirect_uri: string;
      original_code_challenge?: string;
    };

    // Validate client_id
    if (clientId && clientId !== storedData.client_id) {
      return jsonResponse({ error: "invalid_client", error_description: "Client ID mismatch" }, 400);
    }

    // Validate PKCE code verifier if a challenge was provided
    if (storedData.original_code_challenge && codeVerifier) {
      const computedChallenge = await generateCodeChallenge(codeVerifier);
      if (computedChallenge !== storedData.original_code_challenge) {
        return jsonResponse(
          { error: "invalid_grant", error_description: "Invalid code_verifier" },
          400
        );
      }
    }

    // Clean up auth code
    await env.OAUTH_KV.delete(`auth_code:${code}`);

    // Calculate expires_in from JWT exp claim
    const expiresIn = Math.max(0, storedData.claims.exp - Math.floor(Date.now() / 1000));

    // Generate refresh token for the MCP client (still needed to get new CF Access tokens)
    let mcpRefreshToken: string | undefined;
    if (storedData.refresh_token) {
      mcpRefreshToken = generateRandomString(64);
      await env.OAUTH_KV.put(
        `refresh:${mcpRefreshToken}`,
        JSON.stringify({
          cf_refresh_token: storedData.refresh_token,
          client_id: storedData.client_id,
        }),
        { expirationTtl: 86400 * 30 } // 30 days
      );
    }

    // Return the actual CF Access JWT - downstream apps can validate it directly
    // using JWKS at https://{team}.cloudflareaccess.com/cdn-cgi/access/sso/oidc/{client_id}/jwks
    const response: Record<string, unknown> = {
      access_token: storedData.access_token,
      token_type: "Bearer",
      expires_in: expiresIn,
    };
    if (mcpRefreshToken) {
      response.refresh_token = mcpRefreshToken;
    }

    return jsonResponse(response);
  }

  // Handle refresh token grant
  if (grantType === "refresh_token") {
    if (!refreshToken) {
      return jsonResponse(
        { error: "invalid_request", error_description: "Missing refresh_token" },
        400
      );
    }

    const refreshData = await env.OAUTH_KV.get(`refresh:${refreshToken}`);
    if (!refreshData) {
      return jsonResponse(
        { error: "invalid_grant", error_description: "Invalid or expired refresh token" },
        400
      );
    }

    const storedRefresh = JSON.parse(refreshData) as {
      cf_refresh_token?: string;
      client_id: string;
    };

    if (!storedRefresh.cf_refresh_token) {
      return jsonResponse(
        { error: "invalid_grant", error_description: "No refresh token available" },
        400
      );
    }

    // Exchange CF Access refresh token for new access token via OIDC endpoint
    const tokenUrl = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: storedRefresh.cf_refresh_token,
        client_id: env.CF_ACCESS_CLIENT_ID,
        client_secret: env.CF_ACCESS_CLIENT_SECRET,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token refresh failed:", errorText);
      // Delete invalid refresh token
      await env.OAUTH_KV.delete(`refresh:${refreshToken}`);
      return jsonResponse(
        { error: "invalid_grant", error_description: "Failed to refresh token" },
        400
      );
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;

    // Decode claims from new token
    let claims: JWTClaims;
    try {
      claims = decodeJWTClaims(tokens.id_token || tokens.access_token);
    } catch {
      return jsonResponse(
        { error: "server_error", error_description: "Failed to decode refreshed token" },
        500
      );
    }

    const expiresIn = Math.max(0, claims.exp - Math.floor(Date.now() / 1000));

    // Update stored refresh token if a new one was issued
    if (tokens.refresh_token && tokens.refresh_token !== storedRefresh.cf_refresh_token) {
      await env.OAUTH_KV.put(
        `refresh:${refreshToken}`,
        JSON.stringify({
          cf_refresh_token: tokens.refresh_token,
          client_id: storedRefresh.client_id,
        }),
        { expirationTtl: 86400 * 30 }
      );
    }

    return jsonResponse({
      access_token: tokens.access_token,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken, // Return same MCP refresh token
    });
  }

  return jsonResponse(
    { error: "unsupported_grant_type", error_description: "Unsupported grant type" },
    400
  );
}

async function handleClientRegistration(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json();
  const {
    redirect_uris,
    client_name,
    token_endpoint_auth_method,
  } = body as {
    redirect_uris?: string[];
    client_name?: string;
    token_endpoint_auth_method?: string;
  };

  if (!redirect_uris || redirect_uris.length === 0) {
    return jsonResponse(
      { error: "invalid_request", error_description: "redirect_uris is required" },
      400
    );
  }

  // Generate client credentials
  const clientId = generateRandomString(32);
  const clientSecret = generateRandomString(64);

  // Store client registration
  await env.OAUTH_KV.put(
    `client:${clientId}`,
    JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris,
      client_name: client_name || "MCP Client",
      token_endpoint_auth_method: token_endpoint_auth_method || "none",
      created_at: Date.now(),
    }),
    { expirationTtl: 86400 * 365 } // 1 year
  );

  return jsonResponse(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris,
      client_name: client_name || "MCP Client",
      token_endpoint_auth_method: token_endpoint_auth_method || "none",
    },
    201
  );
}

async function handleOAuthMetadata(request: Request, env: Env): Promise<Response> {
  const baseUrl = new URL(request.url).origin;

  return jsonResponse({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    // MCP server URL - clients should connect here after obtaining token
    resource_server: env.DOWNSTREAM_MCP_URL,
    // JWKS endpoint for token validation (OIDC-specific)
    jwks_uri: `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/jwks`,
  });
}

// RFC 9728 Protected Resource Metadata
async function handleProtectedResourceMetadata(request: Request, env: Env): Promise<Response> {
  const baseUrl = new URL(request.url).origin;

  return jsonResponse({
    // The protected resource identifier (the MCP server)
    resource: env.DOWNSTREAM_MCP_URL,
    // Authorization servers that can issue tokens for this resource
    authorization_servers: [baseUrl],
    // Scopes supported by this protected resource
    scopes_supported: ["openid", "email", "profile", "groups"],
    // How bearer tokens can be presented
    bearer_methods_supported: ["header"],
    // JWKS for token validation
    jwks_uri: `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/jwks`,
  });
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export default CFAccessHandler;
