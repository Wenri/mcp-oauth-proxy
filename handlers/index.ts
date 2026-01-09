/**
 * SiYuan MCP Server with Cloudflare Access Authentication
 * Based on: https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Connection, ConnectionContext } from 'agents';
import { accessApp } from './access-handler';
import { initializeSiyuanMCPServer, setOAuthTokenExpiry, setGrantKey, logPush } from '../siyuan-mcp';
import type { Env } from '..';
import type { Props } from './workers-oauth-utils';
import pkg from '../package.json' with { type: 'json' };

/**
 * SiYuan MCP Agent for Cloudflare Workers
 */
export class SiyuanMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });

  async init() {
    if (!this.env.SIYUAN_KERNEL_URL && !this.props?.workerBaseUrl) {
      logPush('Warning: Neither SIYUAN_KERNEL_URL nor workerBaseUrl available');
      return;
    }

    // Pass worker base URL from OAuth props
    // If SIYUAN_KERNEL_URL not set, workerBaseUrl is used as default
    await initializeSiyuanMCPServer(
      this.server,
      this.env,
      this.props?.workerBaseUrl,
      this.env.COOKIE_ENCRYPTION_KEY
    );

    // Log authenticated user info
    if (this.props?.email) {
      logPush(`Authenticated user: ${this.props.email}`);
    }
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    // Capture OAuth token and expiry from Authorization header
    const authHeader = ctx.request?.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      // Extract grantKey (userId:grantId) from token
      // Token format: userId:grantId:secret
      const parts = token.split(':');
      if (parts.length >= 2) {
        const userId = parts[0];
        const grantId = parts[1];
        setGrantKey(`${userId}:${grantId}`);

        // Look up grant expiry from KV (longer TTL than access token)
        const grant = await this.env.OAUTH_KV.get<{ expiresAt?: number }>(
          `grant:${userId}:${grantId}`,
          'json'
        );
        if (grant?.expiresAt) {
          setOAuthTokenExpiry(grant.expiresAt);
        }
      }
    }
    return super.onConnect(conn, ctx);
  }
}

/**
 * Validate X-SiYuan-Key header against SIYUAN_KERNEL_TOKEN
 */
function validateSiyuanKey(key: string, env: Env): Props | null {
  if (!env.SIYUAN_KERNEL_TOKEN || key !== env.SIYUAN_KERNEL_TOKEN) {
    return null;
  }
  return {
    accessToken: '',
    email: 'siyuan-key-auth',
    login: 'siyuan-key-user',
    name: 'SiYuan Key Auth',
    workerBaseUrl: '',
  };
}

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 * Also supports X-SiYuan-Key header auth using SIYUAN_KERNEL_TOKEN.
 */
export default new OAuthProvider({
  // API handlers (require valid access token or X-SiYuan-Key)
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
  // External token authentication via Bearer token
  // Called when Bearer token not found in internal KV
  resolveExternalToken: async ({ token, request, env }: { token: string; request: Request; env: unknown }) => {
    if (!token) return null;

    const props = validateSiyuanKey(token, env as Env);
    if (!props) return null;

    props.workerBaseUrl = new URL(request.url).origin;
    return { props };
  },
});
