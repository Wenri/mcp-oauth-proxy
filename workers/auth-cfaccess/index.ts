/**
 * CF Access Auth Worker
 *
 * This worker handles OAuth authentication via Cloudflare Access and forwards
 * MCP requests to the MCP backend worker via service binding.
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import type { Context } from 'hono';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { accessApp, type HonoEnv, extractAuthContext } from './access-handler';
import type { AuthCfAccessEnv } from '../../index';

type Env = AuthCfAccessEnv;

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 * Also supports X-SiYuan-Key header auth using SIYUAN_KERNEL_TOKEN.
 */
export default new OAuthProvider({
  apiHandlers: {
    '/sse': accessApp.basePath('/sse').all(async (c: Context<HonoEnv>): Promise<Response> => {
      const auth = extractAuthContext(c);
      if (!auth) return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized' }, id: null }, 401);
      return c.env.MCP_BACKEND.handleSSE(c.req.raw, auth);
    }),
    '/mcp': accessApp.basePath('/mcp').all(async (c: Context<HonoEnv>): Promise<Response> => {
      const auth = extractAuthContext(c);
      if (!auth) return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized' }, id: null }, 401);
      return c.env.MCP_BACKEND.handleMCP(c.req.raw, auth);
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
  resolveExternalToken: async ({ token, request, env }: { token: string; request: Request; env: unknown }) => {
    if (!token) return null;

    const e = env as Env;
    if (!e.SIYUAN_KERNEL_TOKEN || token !== e.SIYUAN_KERNEL_TOKEN) return null;

    const origin = new URL(request.url).origin;
    return { props: {
      email: 'siyuan-key-auth',
      login: 'siyuan-key-user',
      name: 'SiYuan Key Auth',
      workerBaseUrl: origin,
      kernelUrl: e.SIYUAN_KERNEL_URL || origin,
    } };
  },
});
