/**
 * SiYuan MCP Server with Cloudflare Access Authentication
 * Based on: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Connection, ConnectionContext } from 'agents';
import { accessApp } from './access-handler';
import { initializeSiyuanMCPServer, setOAuthToken, logPush } from '../siyuan-mcp';
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
    if (!this.env.SIYUAN_KERNEL_URL && !this.props?.workerBaseUrl) {
      logPush('Warning: Neither SIYUAN_KERNEL_URL nor workerBaseUrl available');
      return;
    }

    // Pass CF Access token and worker base URL from OAuth props
    // If SIYUAN_KERNEL_URL not set, workerBaseUrl is used as default
    await initializeSiyuanMCPServer(
      this.server,
      this.env,
      this.props?.accessToken,
      this.props?.workerBaseUrl
    );

    // Log authenticated user info
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    // Capture OAuth token from Authorization header
    const authHeader = ctx.request?.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      setOAuthToken(authHeader.slice(7));
    }
    return super.onConnect(conn, ctx);
  }
}

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 */
export default new OAuthProvider({
  // API handlers (require valid access token)
  apiHandlers: {
    '/sse': SiyuanMCP.serveSSE('/sse'),
    '/mcp': SiyuanMCP.serve('/mcp'),
  },
  // OAuth endpoints
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // Default handler for OAuth flow (redirects to CF Access)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: accessApp as any,
});
