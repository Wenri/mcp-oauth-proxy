/**
 * MCP Handler for Cloudflare Workers
 *
 * Handles MCP JSON-RPC requests using the siyuan-mcp library.
 * Routes:
 *   /mcp - MCP JSON-RPC endpoint (POST)
 *   /sse - Server-Sent Events transport
 */

import { createSiyuanMCPServer } from '../siyuan-mcp/server';
import { setPlatformContext, createCloudflareContext } from '../siyuan-mcp/platform';
import type { Env } from '../index';

// Extended environment for SiYuan MCP
export interface SiyuanEnv extends Env {
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
}

// Cached server instance
let cachedServer: Awaited<ReturnType<typeof createSiyuanMCPServer>> | null = null;

/**
 * Initialize the MCP server (lazy, cached)
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
      ? { baseUrl: env.RAG_BASE_URL, apiKey: env.RAG_API_KEY }
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
 * Get list of available tools
 */
async function getToolsList(_env: SiyuanEnv) {
  const { getAllToolProviders } = await import('../siyuan-mcp/tools');
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
async function callTool(_env: SiyuanEnv, toolName: string, args: any) {
  const { getAllToolProviders } = await import('../siyuan-mcp/tools');
  const providers = getAllToolProviders();

  for (const provider of providers) {
    const tools = await provider.getTools();
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      try {
        return await tool.handler(args, {});
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message || 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  }

  return {
    content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
    isError: true,
  };
}

// JSON-RPC request body type
interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: {
    name?: string;
    arguments?: any;
    [key: string]: any;
  };
}

/**
 * Handle MCP JSON-RPC requests
 */
export async function handleMCPRequest(
  request: Request,
  env: SiyuanEnv,
  _authContext?: { claims: any; accessToken: string }
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as JsonRpcRequest;
    await getMCPServer(env);

    // Handle initialize
    if (body.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'siyuan-mcp', version: '1.0.0' },
        },
      });
    }

    // Handle tools/list
    if (body.method === 'tools/list') {
      const tools = await getToolsList(env);
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools },
      });
    }

    // Handle tools/call
    if (body.method === 'tools/call') {
      const result = await callTool(env, body.params?.name ?? '', body.params?.arguments ?? {});
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result,
      });
    }

    return jsonResponse({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: `Method not found: ${body.method}` },
    });
  } catch (error: any) {
    return jsonResponse(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: error.message || 'Parse error' },
      },
      400
    );
  }
}

/**
 * Handle SSE transport for streaming MCP
 */
export async function handleSSERequest(
  _request: Request,
  _env: SiyuanEnv,
  _authContext?: { claims: any; accessToken: string }
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial connection event
  writer.write(encoder.encode('event: open\ndata: {}\n\n'));

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle MCP routes
 * Returns Response if handled, null otherwise
 */
export async function handleMCPRoute(
  request: Request,
  env: SiyuanEnv,
  url: URL,
  authContext?: { claims: any; accessToken: string }
): Promise<Response | null> {
  if (url.pathname === '/mcp') {
    return handleMCPRequest(request, env, authContext);
  }

  if (url.pathname === '/sse') {
    return handleSSERequest(request, env, authContext);
  }

  return null;
}
