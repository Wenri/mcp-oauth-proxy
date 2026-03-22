/**
 * MCP Backend Worker - Entry Point
 *
 * This worker handles MCP protocol requests from auth workers
 * via Workers RPC (Service Bindings). Auth workers call
 * handleSSE() or handleMCP() directly with auth context.
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MCPBackendEnv, AuthContext } from '../../index';
import { SiyuanMCP } from './server/agent';

// Re-export for wrangler DO binding
export { SiyuanMCP };

const sseHandler = SiyuanMCP.serveSSE('/sse', { binding: 'MCP_OBJECT' });
const mcpHandler = SiyuanMCP.serve('/mcp', { binding: 'MCP_OBJECT' });

export default class McpRpc extends WorkerEntrypoint<MCPBackendEnv> {
  async handleSSE(request: Request, authContext: AuthContext): Promise<Response> {
    return sseHandler.fetch(request, this.env, { ...this.ctx, props: authContext } as ExecutionContext);
  }

  async handleMCP(request: Request, authContext: AuthContext): Promise<Response> {
    return mcpHandler.fetch(request, this.env, { ...this.ctx, props: authContext } as ExecutionContext);
  }
}
