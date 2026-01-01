/**
 * Handlers - Cloudflare Workers integration
 *
 * Provides OAuthProvider configuration with SiyuanMCP agent.
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { handleOAuthRoute } from './oauth';
import { initializeSiyuanMCPServer, logPush } from '../siyuan-mcp';

// Environment interface
export interface Env {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;
  DOWNSTREAM_MCP_URL: string;
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
}

/**
 * SiYuan MCP Agent for Cloudflare Workers
 */
export class SiyuanMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'siyuan-mcp',
    version: '1.0.0',
  });

  async init() {
    if (!this.env.SIYUAN_KERNEL_URL) {
      logPush('Warning: SIYUAN_KERNEL_URL not configured');
      return;
    }

    await initializeSiyuanMCPServer(this.server, this.env);
  }
}

/**
 * Default handler for non-API requests
 */
const defaultHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const oauthResponse = await handleOAuthRoute(request, env, url);
    if (oauthResponse) {
      return oauthResponse;
    }

    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          name: 'siyuan-mcp',
          version: '1.0.0',
          endpoints: { sse: '/sse', mcp: '/mcp', authorize: '/authorize', token: '/token' },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  },
};

/**
 * OAuthProvider with SiyuanMCP agent
 */
export default new OAuthProvider({
  // Use apiHandlers for multiple routes with different transports
  apiHandlers: {
    // SSE transport for /sse endpoint
    // @ts-expect-error - McpAgent.serveSSE returns compatible handler
    '/sse': SiyuanMCP.serveSSE('/sse'),
    // Streamable HTTP transport for /mcp endpoint
    // @ts-expect-error - McpAgent.mount returns compatible handler
    '/mcp': SiyuanMCP.mount('/mcp'),
  },
  // @ts-expect-error - Handler type mismatch
  defaultHandler: defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
  scopesSupported: ['openid', 'email', 'profile', 'offline_access'],
});
