/**
 * Cloudflare Access OAuth Handler
 *
 * Integrates Cloudflare Access as the identity provider with OAuthProvider.
 * Handles /authorize (redirect to CF Access) and /callback (complete authorization).
 * Token exchange is handled automatically by OAuthProvider.
 */

import type { Env } from '../types';
import type { OAuthHelpers, AuthRequest } from '@cloudflare/workers-oauth-provider';

// Extend Env to include OAUTH_PROVIDER helpers injected by OAuthProvider
interface EnvWithOAuth extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

interface StoredState {
  authRequest: AuthRequest;
  cfCodeVerifier: string;
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

// Helper to decode JWT claims (without verification - CF Access already verified)
function decodeJWTClaims(token: string): JWTClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

// Generate a random string
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Generate PKCE code challenge (S256)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Build Cloudflare Access authorization URL
function buildCFAccessAuthUrl(
  teamDomain: string,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  scope: string[]
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // CF Access requires openid scope
    scope: scope.includes('openid') ? scope.join(' ') : ['openid', ...scope].join(' '),
  });
  return `https://${teamDomain}/cdn-cgi/access/sso/oidc/${clientId}/authorization?${params.toString()}`;
}

/**
 * Handle /authorize - Parse OAuth request and redirect to Cloudflare Access
 */
async function handleAuthorize(request: Request, env: EnvWithOAuth): Promise<Response> {
  // Parse the OAuth authorization request using OAuthProvider helper
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);

  // Generate state and PKCE for CF Access
  const cfState = generateRandomString(32);
  const cfCodeVerifier = generateRandomString(64);
  const cfCodeChallenge = await generateCodeChallenge(cfCodeVerifier);

  // Store the original auth request with our CF Access state
  const storedState: StoredState = {
    authRequest,
    cfCodeVerifier,
  };
  await env.OAUTH_KV.put(`cf_state:${cfState}`, JSON.stringify(storedState), {
    expirationTtl: 600, // 10 minutes
  });

  // Build callback URL
  const baseUrl = new URL(request.url).origin;
  const callbackUrl = `${baseUrl}/callback`;

  // Redirect to Cloudflare Access
  const cfAuthUrl = buildCFAccessAuthUrl(
    env.CF_ACCESS_TEAM_DOMAIN,
    env.CF_ACCESS_CLIENT_ID,
    callbackUrl,
    cfState,
    cfCodeChallenge,
    authRequest.scope
  );

  return Response.redirect(cfAuthUrl, 302);
}

/**
 * Handle /callback - Exchange CF Access code for tokens, then complete OAuth flow
 */
async function handleCallback(request: Request, env: EnvWithOAuth): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    return new Response(`OAuth error: ${error} - ${errorDescription}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response('Missing code or state parameter', { status: 400 });
  }

  // Retrieve stored state
  const storedStateJson = await env.OAUTH_KV.get(`cf_state:${state}`);
  if (!storedStateJson) {
    return new Response('Invalid or expired state', { status: 400 });
  }

  const storedState = JSON.parse(storedStateJson) as StoredState;
  await env.OAUTH_KV.delete(`cf_state:${state}`);

  // Exchange code for tokens with Cloudflare Access
  const tokenUrl = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/token`;
  const baseUrl = new URL(request.url).origin;

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: env.CF_ACCESS_CLIENT_ID,
      client_secret: env.CF_ACCESS_CLIENT_SECRET,
      redirect_uri: `${baseUrl}/callback`,
      code_verifier: storedState.cfCodeVerifier,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('CF Access token exchange failed:', errorText);
    return new Response(`Token exchange failed: ${errorText}`, { status: 500 });
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;

  // Decode user claims from the token
  let claims: JWTClaims;
  try {
    claims = decodeJWTClaims(tokens.id_token || tokens.access_token);
  } catch (err) {
    return new Response('Failed to decode token claims', { status: 500 });
  }

  // Complete the OAuth authorization using OAuthProvider
  // This generates the authorization code that OAuthProvider will handle at /token
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: storedState.authRequest,
    userId: claims.sub,
    metadata: {
      email: claims.email,
      name: claims.name,
      groups: claims.groups,
      authenticatedAt: Date.now(),
    },
    scope: storedState.authRequest.scope,
    props: {
      // These props are passed to MCP handlers via ctx.props
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      groups: claims.groups,
      cfAccessToken: tokens.access_token,
      cfRefreshToken: tokens.refresh_token,
    },
  });

  return Response.redirect(redirectTo, 302);
}

/**
 * Handle OAuth-related routes
 * Returns Response if handled, null otherwise
 *
 * Note: env.OAUTH_PROVIDER is injected at runtime by OAuthProvider
 */
export async function handleOAuthRoute(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  // Cast to EnvWithOAuth since OAUTH_PROVIDER is injected by OAuthProvider at runtime
  const envWithOAuth = env as EnvWithOAuth;
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  switch (url.pathname) {
    case '/authorize':
      return handleAuthorize(request, envWithOAuth);
    case '/callback':
      return handleCallback(request, envWithOAuth);
  }

  // /token, /register, /.well-known/* are handled by OAuthProvider
  return null;
}
