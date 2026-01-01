/**
 * SiYuan MCP Server for Cloudflare Workers
 *
 * This server integrates directly with SiYuan kernel APIs and provides
 * MCP tools for note-taking, document management, and search.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { setPlatformContext, createCloudflareContext } from './platform';
import { getAllToolProviders } from './tools';
import { logPush, debugPush } from './logger';

export interface SiyuanMCPConfig {
  kernelBaseUrl: string;
  kernelToken?: string;
  ragBaseUrl?: string;
  ragApiKey?: string;
  filterNotebooks?: string;
  filterDocuments?: string;
  appId?: string;
}

/**
 * Create and configure the SiYuan MCP server
 */
export async function createSiyuanMCPServer(config: SiyuanMCPConfig): Promise<McpServer> {
  // Initialize platform context
  const ctx = await createCloudflareContext({
    kernelBaseUrl: config.kernelBaseUrl,
    kernelToken: config.kernelToken,
    ragConfig: config.ragBaseUrl
      ? {
          baseUrl: config.ragBaseUrl,
          apiKey: config.ragApiKey,
        }
      : undefined,
    filterNotebooks: config.filterNotebooks,
    filterDocuments: config.filterDocuments,
    appId: config.appId,
  });
  setPlatformContext(ctx);

  // Create MCP server
  const server = new McpServer({
    name: 'siyuan-mcp',
    version: '1.0.0',
  });

  // Get all tool providers and register their tools
  const providers = getAllToolProviders();
  for (const provider of providers) {
    const tools = await provider.getTools();
    for (const tool of tools) {
      await registerTool(server, tool);
    }
  }

  logPush('SiYuan MCP server initialized with tools');
  return server;
}

/**
 * Register a single tool with the MCP server
 */
async function registerTool(server: McpServer, tool: McpTool<any>): Promise<void> {
  // Convert Zod schema to JSON Schema for MCP
  const inputSchema = tool.schema
    ? convertZodToJsonSchema(tool.schema)
    : { type: 'object', properties: {} };

  server.tool(
    tool.name,
    tool.description,
    inputSchema,
    async (params) => {
      debugPush(`Tool ${tool.name} called with params:`, params);
      try {
        const result = await tool.handler(params, {});
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
  );
}

/**
 * Convert Zod schema object to JSON Schema format
 */
function convertZodToJsonSchema(schema: Record<string, z.ZodType>): {
  type: string;
  properties: Record<string, any>;
  required?: string[];
} {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, zodType] of Object.entries(schema)) {
    const propSchema = zodTypeToJsonSchema(zodType);
    properties[key] = propSchema;

    // Check if field is required (not optional)
    if (!zodType.isOptional()) {
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
 * Convert a Zod type to JSON Schema
 */
function zodTypeToJsonSchema(zodType: z.ZodType): any {
  const typeName = zodType._def.typeName;

  switch (typeName) {
    case 'ZodString':
      return {
        type: 'string',
        description: zodType.description,
      };
    case 'ZodNumber':
      return {
        type: 'number',
        description: zodType.description,
      };
    case 'ZodBoolean':
      return {
        type: 'boolean',
        description: zodType.description,
      };
    case 'ZodArray':
      const arrayDef = zodType._def as any;
      return {
        type: 'array',
        items: zodTypeToJsonSchema(arrayDef.type),
        description: zodType.description,
      };
    case 'ZodObject':
      const objectDef = zodType._def as any;
      const shape = objectDef.shape();
      const objProperties: Record<string, any> = {};
      for (const [key, value] of Object.entries(shape)) {
        objProperties[key] = zodTypeToJsonSchema(value as z.ZodType);
      }
      return {
        type: 'object',
        properties: objProperties,
        description: zodType.description,
      };
    case 'ZodOptional':
      const optionalDef = zodType._def as any;
      return zodTypeToJsonSchema(optionalDef.innerType);
    case 'ZodDefault':
      const defaultDef = zodType._def as any;
      const defaultSchema = zodTypeToJsonSchema(defaultDef.innerType);
      defaultSchema.default = defaultDef.defaultValue();
      return defaultSchema;
    case 'ZodEnum':
      const enumDef = zodType._def as any;
      return {
        type: 'string',
        enum: enumDef.values,
        description: zodType.description,
      };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: true,
        description: zodType.description,
      };
    default:
      // Fallback for unknown types
      return {
        type: 'string',
        description: zodType.description,
      };
  }
}

/**
 * Run the MCP server with stdio transport (for CLI usage)
 */
export async function runStdioServer(config: SiyuanMCPConfig): Promise<void> {
  const server = await createSiyuanMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
