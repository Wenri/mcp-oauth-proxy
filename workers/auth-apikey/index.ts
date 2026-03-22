/**
 * API Key Auth Worker
 *
 * This lightweight worker authenticates requests using X-SiYuan-Key header
 * and forwards MCP requests to the backend via service binding.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { AuthApiKeyEnv, Props } from '../../index';
import { initKernel, getFileAPIv2, normalizePath } from '../mcp-backend/syapi';
import { decryptGrant } from '../mcp-backend/utils/fakeEncrypt';

type HonoEnv = { Bindings: AuthApiKeyEnv; Variables: { props: Props } };

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

// Auth middleware — applies only to MCP routes
app.use('/sse', async (c, next) => {
  const apiKey = c.req.header('X-SiYuan-Key');
  if (!apiKey || apiKey !== c.env.SIYUAN_KERNEL_TOKEN) {
    return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Invalid or missing X-SiYuan-Key' }, id: null }, 401);
  }
  const origin = new URL(c.req.url).origin;
  c.set('props', { email: 'api-key-auth', login: 'api-key-user', name: 'API Key Auth', workerBaseUrl: origin, kernelUrl: c.env.SIYUAN_KERNEL_URL || origin });
  return next();
});
app.use('/sse/*', async (c, next) => {
  const apiKey = c.req.header('X-SiYuan-Key');
  if (!apiKey || apiKey !== c.env.SIYUAN_KERNEL_TOKEN) {
    return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Invalid or missing X-SiYuan-Key' }, id: null }, 401);
  }
  const origin = new URL(c.req.url).origin;
  c.set('props', { email: 'api-key-auth', login: 'api-key-user', name: 'API Key Auth', workerBaseUrl: origin, kernelUrl: c.env.SIYUAN_KERNEL_URL || origin });
  return next();
});
app.use('/mcp', async (c, next) => {
  const apiKey = c.req.header('X-SiYuan-Key');
  if (!apiKey || apiKey !== c.env.SIYUAN_KERNEL_TOKEN) {
    return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Invalid or missing X-SiYuan-Key' }, id: null }, 401);
  }
  const origin = new URL(c.req.url).origin;
  c.set('props', { email: 'api-key-auth', login: 'api-key-user', name: 'API Key Auth', workerBaseUrl: origin, kernelUrl: c.env.SIYUAN_KERNEL_URL || origin });
  return next();
});
app.use('/mcp/*', async (c, next) => {
  const apiKey = c.req.header('X-SiYuan-Key');
  if (!apiKey || apiKey !== c.env.SIYUAN_KERNEL_TOKEN) {
    return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Invalid or missing X-SiYuan-Key' }, id: null }, 401);
  }
  const origin = new URL(c.req.url).origin;
  c.set('props', { email: 'api-key-auth', login: 'api-key-user', name: 'API Key Auth', workerBaseUrl: origin, kernelUrl: c.env.SIYUAN_KERNEL_URL || origin });
  return next();
});

// Forward to MCP backend with auth context headers
app.all('/sse', async (c) => {
  const props = c.get('props');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
  headers.set('X-Auth-Secret', c.env.SIYUAN_KERNEL_TOKEN);
  return c.env.MCP_BACKEND.fetch(new Request(c.req.url, { method: c.req.method, headers, body: c.req.raw.body }));
});
app.all('/sse/*', async (c) => {
  const props = c.get('props');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
  headers.set('X-Auth-Secret', c.env.SIYUAN_KERNEL_TOKEN);
  return c.env.MCP_BACKEND.fetch(new Request(c.req.url, { method: c.req.method, headers, body: c.req.raw.body }));
});
app.all('/mcp', async (c) => {
  const props = c.get('props');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
  headers.set('X-Auth-Secret', c.env.SIYUAN_KERNEL_TOKEN);
  return c.env.MCP_BACKEND.fetch(new Request(c.req.url, { method: c.req.method, headers, body: c.req.raw.body }));
});
app.all('/mcp/*', async (c) => {
  const props = c.get('props');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Auth-Props', btoa(JSON.stringify(props)));
  headers.set('X-Auth-Secret', c.env.SIYUAN_KERNEL_TOKEN);
  return c.env.MCP_BACKEND.fetch(new Request(c.req.url, { method: c.req.method, headers, body: c.req.raw.body }));
});

export default app;
