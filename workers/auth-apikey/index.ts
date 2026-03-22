/**
 * API Key Auth Worker
 *
 * This lightweight worker authenticates requests using X-SiYuan-Key header
 * and forwards MCP requests to the backend via service binding.
 */

import type { AuthApiKeyEnv, Props } from '../../index';
import { initKernel, getFileAPIv2, normalizePath } from '../mcp-backend/syapi';
import { decryptGrant } from '../mcp-backend/utils/fakeEncrypt';

type Env = AuthApiKeyEnv;

/**
 * Validate X-SiYuan-Key header
 */
function validateApiKey(request: Request, env: Env): Props | null {
  const apiKey = request.headers.get('X-SiYuan-Key');
  if (!apiKey || apiKey !== env.SIYUAN_KERNEL_TOKEN) {
    return null;
  }
  const origin = new URL(request.url).origin;
  return {
    email: 'api-key-auth',
    login: 'api-key-user',
    name: 'API Key Auth',
    workerBaseUrl: origin,
    kernelUrl: env.SIYUAN_KERNEL_URL || origin,
  };
}

/**
 * Handle download requests with stateless key validation
 */
async function handleDownload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  // /download/{token}/path/to/file
  const token = pathParts[2];
  const filePath = normalizePath(pathParts.slice(3).join('/'));

  // Decrypt token to get the secret (API key in this case)
  let secret: string;
  try {
    secret = await decryptGrant(token, filePath, env.COOKIE_ENCRYPTION_KEY);
  } catch {
    return new Response('Invalid token', { status: 401 });
  }

  // Validate the secret matches the API key
  if (secret !== env.SIYUAN_KERNEL_TOKEN) {
    return new Response('Invalid token', { status: 401 });
  }

  // Initialize kernel and fetch file
  const kernelUrl = env.SIYUAN_KERNEL_URL || url.origin;
  initKernel(
    kernelUrl,
    env.SIYUAN_KERNEL_TOKEN,
    env.CF_ACCESS_SERVICE_CLIENT_ID,
    env.CF_ACCESS_SERVICE_CLIENT_SECRET
  );

  const response = await getFileAPIv2(filePath.slice(1), 3600);
  if (!response) {
    return new Response('File not found', { status: 404 });
  }

  const filename = filePath.split('/').pop() || 'download';
  const headers = new Headers(response.headers);
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

/**
 * Forward MCP requests to backend with auth context
 */
async function forwardToBackend(
  request: Request,
  env: Env,
  props: Props
): Promise<Response> {
  // Use API key as the secret for download URL generation
  const secret = env.SIYUAN_KERNEL_TOKEN;

  // Build forwarded request with auth context headers
  const headers = new Headers(request.headers);
  headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
  headers.set('X-Auth-Secret', secret);

  // Forward to MCP backend via service binding
  return env.MCP_BACKEND.fetch(new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
  }));
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-SiYuan-Key, mcp-session-id, MCP-Protocol-Version',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Handle download requests
    if (url.pathname.startsWith('/download/')) {
      return handleDownload(request, env);
    }

    // Validate API key for MCP requests
    const props = validateApiKey(request, env);
    if (!props) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized: Invalid or missing X-SiYuan-Key' },
        id: null,
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Forward MCP requests to backend
    if (url.pathname.startsWith('/sse') || url.pathname.startsWith('/mcp')) {
      return forwardToBackend(request, env, props);
    }

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Not Found' },
      id: null,
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
