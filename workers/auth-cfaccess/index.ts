/**
 * CF Access Auth Worker
 *
 * This worker handles OAuth authentication via Cloudflare Access and forwards
 * MCP requests to the MCP backend worker via service binding.
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { app as accessApp, extractAuthContext } from './access-handler';
import type { AuthCfAccessEnv as Env } from '../../index';

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 * Also supports X-SiYuan-Key header auth using SIYUAN_KERNEL_TOKEN.
 */
export default new OAuthProvider({
  apiHandlers: {
    '/sse': accessApp.basePath('/sse').all(async (c): Promise<Response> => {
      return c.env.MCP_BACKEND.handleSSE(c.req.raw, await extractAuthContext(c));
    }),
    '/mcp': accessApp.basePath('/mcp').all(async (c): Promise<Response> => {
      return c.env.MCP_BACKEND.handleMCP(c.req.raw, await extractAuthContext(c));
    }),
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
  resolveExternalToken: async ({ token, request: _, env }: { token: string; request: Request; env: Env }) => {
    if (!token || !env.SIYUAN_KERNEL_TOKEN || token !== env.SIYUAN_KERNEL_TOKEN) return null;

    return { props: {
      email: 'siyuan-key-auth',
      login: 'siyuan-key-user',
      name: 'SiYuan Key Auth',
    } };
  },
});
