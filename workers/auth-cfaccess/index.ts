/**
 * CF Access Auth Worker
 *
 * This worker handles OAuth authentication via Cloudflare Access and forwards
 * MCP requests to the MCP backend worker via service binding.
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { accessApp } from './access-handler';
import type { AuthCfAccessEnv, Props } from '../../index';

type Env = AuthCfAccessEnv;

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
 * Create MCP request handler that forwards to backend via service binding
 */
function createMcpHandler(_path: string) {
  return {
    async fetch(
      request: Request,
      env: unknown,
      ctx: unknown
    ): Promise<Response> {
      const typedEnv = env as Env;
      const typedCtx = ctx as ExecutionContext & { props?: Props };
      const props = typedCtx.props;
      if (!props) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Unauthorized' },
          id: null,
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Extract grant info from Bearer token for download URL generation
      const authHeader = request.headers.get('Authorization');
      let secret = '';
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const parts = token.split(':');
        if (parts.length >= 2) {
          const userId = parts[0];
          const grantId = parts[1];
          secret = `${userId}:${grantId}`;
        }
      }

      // Build forwarded request with auth context headers
      const headers = new Headers(request.headers);
      headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
      headers.set('X-Auth-Secret', secret);
      headers.set('X-Auth-Worker-Base-Url', new URL(request.url).origin);
      headers.set('X-Auth-Encryption-Key', typedEnv.COOKIE_ENCRYPTION_KEY || '');

      // Forward to MCP backend via service binding
      return typedEnv.MCP_BACKEND.fetch(new Request(request.url, {
        method: request.method,
        headers,
        body: request.body,
      }));
    },
  };
}

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 * Also supports X-SiYuan-Key header auth using SIYUAN_KERNEL_TOKEN.
 */
export default new OAuthProvider({
  // MCP handlers - forward to backend via service binding
  apiHandlers: {
    '/sse': createMcpHandler('/sse'),
    '/mcp': createMcpHandler('/mcp'),
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
