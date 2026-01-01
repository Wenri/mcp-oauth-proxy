/**
 * SiYuan MCP Handler for Cloudflare Workers
 *
 * This handler provides a built-in MCP server that directly talks to SiYuan kernel,
 * eliminating the need for a separate downstream MCP server.
 *
 * Routes:
 *   /mcp - MCP JSON-RPC endpoint
 *   /sse - Server-Sent Events transport (for Claude Desktop)
 */

import { createSiyuanMCPServer } from './siyuan-mcp/server';
import { setPlatformContext, createCloudflareContext } from './siyuan-mcp/platform';
import { Env } from './index';

// Extended environment for SiYuan MCP
export interface SiyuanEnv extends Env {
  SIYUAN_KERNEL_URL: string;      // e.g., "https://siyuan.example.com"
  SIYUAN_KERNEL_TOKEN?: string;   // Optional API token
  RAG_BASE_URL?: string;          // Optional RAG backend URL
  RAG_API_KEY?: string;           // Optional RAG API key
  FILTER_NOTEBOOKS?: string;      // Notebook IDs to filter (newline-separated)
  FILTER_DOCUMENTS?: string;      // Document IDs to filter (newline-separated)
}

let cachedServer: any = null;

/**
 * Get or create the MCP server instance
 */
async function getMCPServer(env: SiyuanEnv) {
  if (cachedServer) {
    return cachedServer;
  }

  // Initialize platform context
  const ctx = await createCloudflareContext({
    kernelBaseUrl: env.SIYUAN_KERNEL_URL,
    kernelToken: env.SIYUAN_KERNEL_TOKEN,
    ragConfig: env.RAG_BASE_URL
      ? {
          baseUrl: env.RAG_BASE_URL,
          apiKey: env.RAG_API_KEY,
        }
      : undefined,
    filterNotebooks: env.FILTER_NOTEBOOKS,
    filterDocuments: env.FILTER_DOCUMENTS,
  });
  setPlatformContext(ctx);

  cachedServer = await createSiyuanMCPServer({
    kernelBaseUrl: env.SIYUAN_KERNEL_URL,
    kernelToken: env.SIYUAN_KERNEL_TOKEN,
    ragBaseUrl: env.RAG_BASE_URL,
    ragApiKey: env.RAG_API_KEY,
    filterNotebooks: env.FILTER_NOTEBOOKS,
    filterDocuments: env.FILTER_DOCUMENTS,
  });

  return cachedServer;
}

/**
 * Handle MCP JSON-RPC requests
 */
export async function handleMCPRequest(
  request: Request,
  env: SiyuanEnv,
  authContext?: { claims: any; accessToken: string }
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    const server = await getMCPServer(env);

    // TODO: Process JSON-RPC request through MCP server
    // For now, return a basic response indicating the server is ready
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: 'siyuan-mcp',
              version: '1.0.0',
            },
          },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Handle tools/list
    if (body.method === 'tools/list') {
      const tools = await getToolsList(env);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools },
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Handle tools/call
    if (body.method === 'tools/call') {
      const result = await callTool(env, body.params.name, body.params.arguments);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32601,
          message: `Method not found: ${body.method}`,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: error.message || 'Parse error',
        },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Get list of available tools
 */
async function getToolsList(env: SiyuanEnv) {
  const { getAllToolProviders } = await import('./siyuan-mcp/tools');

  const providers = getAllToolProviders();
  const allTools: any[] = [];

  for (const provider of providers) {
    const tools = await provider.getTools();
    for (const tool of tools) {
      allTools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: convertSchemaToJsonSchema(tool.schema || {}),
      });
    }
  }

  return allTools;
}

/**
 * Call a specific tool
 */
async function callTool(env: SiyuanEnv, toolName: string, args: any) {
  const { getAllToolProviders } = await import('./siyuan-mcp/tools');

  const providers = getAllToolProviders();

  for (const provider of providers) {
    const tools = await provider.getTools();
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      try {
        const result = await tool.handler(args, {});
        return result;
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Tool not found: ${toolName}`,
      },
    ],
    isError: true,
  };
}

/**
 * Convert Zod schema to JSON Schema
 */
function convertSchemaToJsonSchema(schema: Record<string, any>): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, zodType] of Object.entries(schema)) {
    if (!zodType || !zodType._def) continue;

    const typeName = zodType._def.typeName;
    let propSchema: any = { description: zodType.description };

    switch (typeName) {
      case 'ZodString':
        propSchema.type = 'string';
        break;
      case 'ZodNumber':
        propSchema.type = 'number';
        break;
      case 'ZodBoolean':
        propSchema.type = 'boolean';
        break;
      case 'ZodArray':
        propSchema.type = 'array';
        break;
      case 'ZodOptional':
        propSchema = convertSchemaToJsonSchema({ [key]: zodType._def.innerType })[key];
        break;
      case 'ZodDefault':
        propSchema = convertSchemaToJsonSchema({ [key]: zodType._def.innerType })[key];
        propSchema.default = zodType._def.defaultValue?.();
        break;
      case 'ZodEnum':
        propSchema.type = 'string';
        propSchema.enum = zodType._def.values;
        break;
      default:
        propSchema.type = 'string';
    }

    properties[key] = propSchema;

    if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/**
 * Handle SSE transport for streaming MCP
 */
export async function handleSSERequest(
  request: Request,
  env: SiyuanEnv,
  authContext?: { claims: any; accessToken: string }
): Promise<Response> {
  // SSE implementation for Claude Desktop compatibility
  // This would need to maintain a persistent connection and stream responses

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial connection event
  writer.write(encoder.encode('event: open\ndata: {}\n\n'));

  // For now, just keep the connection open
  // Full SSE implementation would handle incoming messages via query params or POST

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  handleMCPRequest,
  handleSSERequest,
};
