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
    kernelUrl: '',
  };
}

/**
 * OAuthProvider configuration
 *
 * Acts as OAuth Provider to MCP clients, and as OAuth Client to CF Access.
 * Also supports X-SiYuan-Key header auth using SIYUAN_KERNEL_TOKEN.
 */
export default new OAuthProvider({
  // MCP handlers - reuse accessApp which includes /sse and /mcp routes
  apiHandlers: {
    '/sse': accessApp,
    '/mcp': accessApp,
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

    const origin = new URL(request.url).origin;
    props.workerBaseUrl = origin;
    props.kernelUrl = (env as Env).SIYUAN_KERNEL_URL || origin;
    return { props };
  },
});
