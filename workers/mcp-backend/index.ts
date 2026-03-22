/**
 * MCP Backend Worker - Entry Point
 *
 * This worker handles MCP protocol requests from auth workers.
 * It's internal-only, accessed via service binding from auth workers.
 *
 * The auth workers validate authentication and pass auth context
 * via HTTP headers (X-Auth-Props, X-Auth-Secret, etc.).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { MCPBackendEnv, AuthContext } from '../../index';
import { SiyuanMCP, extractAuthContext } from './server/agent';

// Re-export for wrangler DO binding
export { SiyuanMCP };

type HonoEnv = { Bindings: MCPBackendEnv; Variables: { authContext: AuthContext } };

const app = new Hono<HonoEnv>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'mcp-session-id', 'MCP-Protocol-Version', 'X-Auth-Props', 'X-Auth-Secret'],
  maxAge: 86400,
}));

app.use('*', async (c, next) => {
  const authContext = extractAuthContext(c.req.raw);
  if (!authContext) {
    return c.json({ jsonrpc: '2.0', error: { code: ErrorCode.ConnectionClosed, message: 'Unauthorized: Missing auth context' }, id: null }, 401);
  }
  c.set('authContext', authContext);
  return next();
});

app.all('/sse', async (c) => {
  const ctxWithProps = { ...c.executionCtx, props: c.get('authContext') };
  return SiyuanMCP.serveSSE('/sse', { binding: 'MCP_OBJECT' }).fetch(c.req.raw, c.env, ctxWithProps as ExecutionContext);
});

app.all('/sse/*', async (c) => {
  const ctxWithProps = { ...c.executionCtx, props: c.get('authContext') };
  return SiyuanMCP.serveSSE('/sse', { binding: 'MCP_OBJECT' }).fetch(c.req.raw, c.env, ctxWithProps as ExecutionContext);
});

app.all('/mcp', async (c) => {
  const ctxWithProps = { ...c.executionCtx, props: c.get('authContext') };
  return SiyuanMCP.serve('/mcp', { binding: 'MCP_OBJECT' }).fetch(c.req.raw, c.env, ctxWithProps as ExecutionContext);
});

app.all('/mcp/*', async (c) => {
  const ctxWithProps = { ...c.executionCtx, props: c.get('authContext') };
  return SiyuanMCP.serve('/mcp', { binding: 'MCP_OBJECT' }).fetch(c.req.raw, c.env, ctxWithProps as ExecutionContext);
});

export default app;
