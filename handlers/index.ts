/**
 * SiYuan MCP Server with Cloudflare Access Authentication
 * Based on: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { handleAccessRequest } from './access-handler';
import { initializeSiyuanMCPServer, logPush } from '../siyuan-mcp';
import type { Env } from '../types';
import type { Props } from './workers-oauth-utils';

// Re-export Env for convenience
export type { Env } from '../types';

/**
 * SiYuan MCP Agent for Cloudflare Workers
 */
export class SiyuanMCP extends McpAgent<Env, Record<string, never>, Props> {
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

    // Log authenticated user info
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }
}

/**
 * Handle MCP requests (SSE and HTTP)
 */
async function handleMcpRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === '/sse' || pathname === '/sse/message') {
    return SiyuanMCP.serveSSE('/sse').fetch(req, env, ctx);
  }
  if (pathname === '/mcp') {
    return SiyuanMCP.serve('/mcp').fetch(req, env, ctx);
  }
  return new Response('Not found', { status: 404 });
}

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 */
export default new OAuthProvider({
  // MCP transport handler (require valid access token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiHandler: { fetch: handleMcpRequest as any },
  apiRoute: ['/sse', '/mcp'],
  // OAuth endpoints
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // Default handler for OAuth flow (redirects to CF Access)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: { fetch: handleAccessRequest as any },
});
