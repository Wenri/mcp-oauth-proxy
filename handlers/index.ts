/**
 * Handlers - Cloudflare Workers integration with Hono
 *
 * Provides OAuthProvider configuration with SiyuanMCP agent.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { oauth } from './oauth';
import { initializeSiyuanMCPServer, logPush } from '../siyuan-mcp';
import type { Env } from '../types';

// Re-export Env for convenience
export type { Env } from '../types';

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
 * Hono app for default handler routes
 */
const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
    maxAge: 86400,
  })
);

// Mount OAuth routes
app.route('/', oauth);

// Root endpoint - server info
app.get('/', (c) =>
  c.json({
    name: 'siyuan-mcp',
    version: '1.0.0',
    endpoints: {
      sse: '/sse',
      mcp: '/mcp',
      authorize: '/authorize',
      token: '/token',
    },
  })
);

// Fallback - 404
app.notFound((c) => c.text('Not found', 404));

/**
 * OAuthProvider with SiyuanMCP agent
 *
 * OAuth flow:
 * 1. /authorize - handled by Hono app → oauth.ts → redirects to CF Access
 * 2. /callback - handled by Hono app → oauth.ts → calls completeAuthorization()
 * 3. /token - handled by OAuthProvider (automatic token exchange)
 * 4. /register - handled by OAuthProvider (dynamic client registration)
 */
export default new OAuthProvider({
  // MCP transport endpoints (require valid access token)
  apiHandlers: {
    '/sse': SiyuanMCP.serveSSE('/sse'),
    '/mcp': SiyuanMCP.mount('/mcp'),
  },
  // Hono app as default handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: app as any,
  // OAuth endpoints - OAuthProvider handles /token and /register
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // Token TTLs
  accessTokenTTL: 3600, // 1 hour
  refreshTokenTTL: 2592000, // 30 days
  scopesSupported: ['openid', 'email', 'profile', 'offline_access'],
});
