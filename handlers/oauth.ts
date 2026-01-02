/**
 * Cloudflare Access OAuth Handler (Hono)
 *
 * Integrates Cloudflare Access as the identity provider with OAuthProvider.
 * Handles /authorize (redirect to CF Access) and /callback (complete authorization).
 * Token exchange is handled automatically by OAuthProvider.
 *
 * Security: Uses both KV storage AND session cookies for OAuth state validation
 * following Cloudflare's recommended defense-in-depth pattern:
 * - KV proves the server issued the state token
 * - Cookie proves this specific browser initiated the flow
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import type { OAuthHelpers, AuthRequest } from '@cloudflare/workers-oauth-provider';

// Extend Env to include OAUTH_PROVIDER helpers injected by OAuthProvider
export type EnvWithOAuth = Env & {
  OAUTH_PROVIDER: OAuthHelpers;
};

// Session cookie name for OAuth state binding
const STATE_COOKIE_NAME = '__Host-oauth_state';
const STATE_TTL = 600; // 10 minutes

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
    scope: scope.includes('openid') ? scope.join(' ') : ['openid', ...scope].join(' '),
  });
  return `https://${teamDomain}/cdn-cgi/access/sso/oidc/${clientId}/authorization?${params.toString()}`;
}

// Create Hono app for OAuth routes
const oauth = new Hono<{ Bindings: EnvWithOAuth }>();

// CORS middleware for cross-origin MCP clients
oauth.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
    maxAge: 86400,
  })
);

/**
 * GET /authorize - Parse OAuth request and redirect to Cloudflare Access
 */
oauth.get('/authorize', async (c) => {
  const env = c.env;

  // Parse the OAuth authorization request using OAuthProvider helper
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);

  // Generate state and PKCE for CF Access
  const cfState = generateRandomString(32);
  const cfCodeVerifier = generateRandomString(64);
  const cfCodeChallenge = await generateCodeChallenge(cfCodeVerifier);

  // Store the original auth request with our CF Access state in KV
  const storedState: StoredState = {
    authRequest,
    cfCodeVerifier,
  };
  await env.OAUTH_KV.put(`cf_state:${cfState}`, JSON.stringify(storedState), {
    expirationTtl: STATE_TTL,
  });

  // Build callback URL
  const baseUrl = new URL(c.req.url).origin;
  const callbackUrl = `${baseUrl}/callback`;

  // Build CF Access auth URL
  const cfAuthUrl = buildCFAccessAuthUrl(
    env.CF_ACCESS_TEAM_DOMAIN,
    env.CF_ACCESS_CLIENT_ID,
    callbackUrl,
    cfState,
    cfCodeChallenge,
    authRequest.scope
  );

  // Set state cookie for session binding and redirect
  setCookie(c, STATE_COOKIE_NAME, cfState, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: STATE_TTL,
  });

  return c.redirect(cfAuthUrl, 302);
});

/**
 * GET /callback - Exchange CF Access code for tokens, then complete OAuth flow
 */
oauth.get('/callback', async (c) => {
  try {
  const env = c.env;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  // Helper to clear cookie and return error
  const errorResponse = (message: string, status: 400 | 500 = 400) => {
    deleteCookie(c, STATE_COOKIE_NAME, { path: '/', secure: true });
    return c.text(message, status);
  };

  if (error) {
    return errorResponse(`OAuth error: ${error} - ${errorDescription}`);
  }

  if (!code || !state) {
    return errorResponse('Missing code or state parameter');
  }

  // Validate session cookie matches the state parameter (defense-in-depth)
  const cookieState = getCookie(c, STATE_COOKIE_NAME);
  if (cookieState !== state) {
    console.warn('OAuth state mismatch: cookie does not match state parameter');
    return errorResponse('Invalid OAuth state: session mismatch');
  }

  // Retrieve stored state from KV
  const storedStateJson = await env.OAUTH_KV.get(`cf_state:${state}`);
  if (!storedStateJson) {
    return errorResponse('Invalid or expired state');
  }

  const storedState = JSON.parse(storedStateJson) as StoredState;
  await env.OAUTH_KV.delete(`cf_state:${state}`);

  // Exchange code for tokens with Cloudflare Access
  const tokenUrl = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${env.CF_ACCESS_CLIENT_ID}/token`;
  const baseUrl = new URL(c.req.url).origin;

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
    return errorResponse(`Token exchange failed: ${errorText}`, 500);
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;

  // Decode user claims from the token
  let claims: JWTClaims;
  try {
    claims = decodeJWTClaims(tokens.id_token || tokens.access_token);
  } catch {
    return errorResponse('Failed to decode token claims', 500);
  }

  // Complete the OAuth authorization using OAuthProvider
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
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      groups: claims.groups,
      cfAccessToken: tokens.access_token,
      cfRefreshToken: tokens.refresh_token,
    },
  });

  // Clear cookie and redirect to client
  deleteCookie(c, STATE_COOKIE_NAME, { path: '/', secure: true });
  return c.redirect(redirectTo, 302);
  } catch (err) {
    console.error('Callback error:', err);
    return c.text(`Callback error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

export { oauth };
