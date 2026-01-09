/**
 * MCP Backend Worker - Entry Point
 *
 * This worker handles MCP protocol requests from auth workers.
 * It's internal-only, accessed via service binding from auth workers.
 *
 * The auth workers validate authentication and pass auth context
 * via HTTP headers (X-Auth-Props, X-Auth-Secret, etc.).
 */

import type { MCPBackendEnv } from '../../index';
import { SiyuanMCP, extractAuthContext, buildMCPProps } from './agent';

// Re-export for wrangler DO binding
export { SiyuanMCP };

export default {
  async fetch(request: Request, env: MCPBackendEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, X-Auth-Props, X-Auth-Secret, X-Auth-Worker-Base-Url, X-Auth-Encryption-Key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Extract auth context from headers (set by auth workers)
    const authContext = extractAuthContext(request);
    if (!authContext) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized: Missing auth context' },
        id: null,
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build props from auth context
    const props = buildMCPProps(authContext);

    // Create execution context with props for McpAgent.serve()
    const ctxWithProps = { ...ctx, props };

    // Route to appropriate MCP transport
    if (url.pathname === '/sse' || url.pathname.startsWith('/sse/')) {
      return SiyuanMCP.serveSSE('/sse', { binding: 'MCP_OBJECT' }).fetch(
        request,
        env,
        ctxWithProps as ExecutionContext
      );
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return SiyuanMCP.serve('/mcp', { binding: 'MCP_OBJECT' }).fetch(
        request,
        env,
        ctxWithProps as ExecutionContext
      );
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
