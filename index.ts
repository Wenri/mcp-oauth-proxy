/**
 * MCP OAuth Proxy for Cloudflare Workers
 *
 * Uses the Cloudflare workers-oauth-provider pattern with SiyuanMCP agent.
 *
 * Routes:
 *   OAuth endpoints: /authorize, /callback, /token, /register
 *   MCP endpoints:   /sse, /mcp
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { SiyuanMCP, type SiyuanEnv } from './siyuan-mcp/agent';
import { handleOAuthRoute } from './handlers/oauth';

// Environment bindings
export interface Env extends SiyuanEnv {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;
  DOWNSTREAM_MCP_URL: string;
}

/**
 * Default handler for non-API requests (OAuth UI, etc.)
 */
const defaultHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle OAuth routes (authorize, callback, token, etc.)
    const oauthResponse = await handleOAuthRoute(request, env, url);
    if (oauthResponse) {
      return oauthResponse;
    }

    // Handle root path with info
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          name: 'siyuan-mcp',
          version: '1.0.0',
          endpoints: {
            sse: '/sse',
            mcp: '/mcp',
            authorize: '/authorize',
            token: '/token',
            register: '/register',
          },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Not found
    return new Response('Not found', {
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      },
    });
  },
};

// Export the OAuth provider with MCP agent
export default new OAuthProvider({
  // MCP API routes - both SSE and HTTP transports
  apiRoute: ['/sse', '/mcp'],
  // @ts-expect-error - McpAgent.mount returns compatible handler
  apiHandler: SiyuanMCP.mount('/sse'),
  // Default handler for OAuth and other routes
  // @ts-expect-error - Handler type mismatch
  defaultHandler: defaultHandler,
  // OAuth endpoints
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // Token TTLs
  accessTokenTTL: 3600, // 1 hour
  refreshTokenTTL: 2592000, // 30 days
  // Supported scopes
  scopesSupported: ['openid', 'email', 'profile', 'offline_access'],
});
