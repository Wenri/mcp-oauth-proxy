/**
 * API Key Auth Worker
 *
 * This lightweight worker authenticates requests using X-SiYuan-Key header
 * and forwards MCP requests to the backend via service binding.
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { AuthApiKeyEnv } from '../../index';
import { initKernel, getFileAPIv2, normalizePath } from '../mcp-backend/syapi';
import { decryptGrant } from '../mcp-backend/utils/fakeEncrypt';

type HonoEnv = { Bindings: AuthApiKeyEnv };

const app = new Hono<HonoEnv>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-SiYuan-Key', 'mcp-session-id', 'MCP-Protocol-Version'],
  maxAge: 86400,
}));

// Download route — token-based validation, no API key required
app.get('/download/:token/*', async (c) => {
  const token = c.req.param('token');
  const filePath = normalizePath(c.req.path.split('/').slice(3).join('/'));

  let secret: string;
  try {
    secret = await decryptGrant(token, filePath, c.env.COOKIE_ENCRYPTION_KEY);
  } catch {
    return c.text('Invalid token', 401);
  }

  if (secret !== c.env.SIYUAN_KERNEL_TOKEN) {
    return c.text('Invalid token', 401);
  }

  const kernelUrl = c.env.SIYUAN_KERNEL_URL || new URL(c.req.url).origin;
  initKernel(kernelUrl, c.env.SIYUAN_KERNEL_TOKEN, c.env.CF_ACCESS_SERVICE_CLIENT_ID, c.env.CF_ACCESS_SERVICE_CLIENT_SECRET);

  const response = await getFileAPIv2(filePath.slice(1), 3600);
  if (!response) return c.text('File not found', 404);

  const filename = filePath.split('/').pop() || 'download';
  const headers = new Headers(response.headers);
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  return new Response(response.body, { status: response.status, headers });
});

// MCP routes: auth + forward via RPC
function buildAuthContext(c: Context<HonoEnv>) {
  const apiKey = c.req.header('X-SiYuan-Key');
  if (!apiKey || apiKey !== c.env.SIYUAN_KERNEL_TOKEN) {
    throw new HTTPException(401, {
      res: Response.json({
        jsonrpc: '2.0', error: {
          code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Invalid or missing X-SiYuan-Key'
        }, id: null
      }, {status: 401})
    });
  }
  const origin = new URL(c.req.url).origin;
  return {
    email: 'api-key-auth', login: 'api-key-user', name: 'API Key Auth',
    label: 'API Key', fetchBaseUrl: origin, kernelUrl: c.env.SIYUAN_KERNEL_URL || origin,
    secret: c.env.SIYUAN_KERNEL_TOKEN,
  };
}

app.all('/sse', async (c): Promise<Response> => {
  return c.env.MCP_BACKEND.handleSSE(c.req.raw, buildAuthContext(c));
});

app.all('/mcp', async (c): Promise<Response> => {
  return c.env.MCP_BACKEND.handleMCP(c.req.raw, buildAuthContext(c));
});

export default app;
