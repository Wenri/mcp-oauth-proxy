/**
 * MCP OAuth Proxy for Cloudflare Workers
 *
 * Routes:
 *   OAuth endpoints: /authorize, /callback, /token, /register, /revoke, /.well-known/*
 *   MCP endpoints:   /mcp, /sse
 */

import { handleOAuthRoute, handleMCPRoute, type SiyuanEnv } from './handlers';

// Environment bindings
export interface Env {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;
  DOWNSTREAM_MCP_URL: string;
}

export default {
  async fetch(request: Request, env: Env & SiyuanEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Try OAuth routes first
    const oauthResponse = await handleOAuthRoute(request, env, url);
    if (oauthResponse) {
      return oauthResponse;
    }

    // Try MCP routes
    const mcpResponse = await handleMCPRoute(request, env as SiyuanEnv, url);
    if (mcpResponse) {
      return mcpResponse;
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
