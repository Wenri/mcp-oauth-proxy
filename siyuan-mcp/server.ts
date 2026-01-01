/**
 * SiYuan MCP Server for Cloudflare Workers
 *
 * Aligned with upstream server implementation using McpServer and
 * proper transport handling.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { setPlatformContext, createCloudflareContext } from './platform';
import { getAllToolProviders } from './tools';
import { logPush, debugPush } from './logger';
import { lang } from './utils/lang';

// Import prompts
import promptCreateCardsSystemCN from './static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from './static/prompt_dynamic_query_system_CN.md';

export interface SiyuanMCPConfig {
  kernelBaseUrl: string;
  kernelToken?: string;
  ragBaseUrl?: string;
  ragApiKey?: string;
  filterNotebooks?: string;
  filterDocuments?: string;
  appId?: string;
  readOnlyMode?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
}

/**
 * Initialize an existing MCP server with SiYuan tools and prompts
 * Use this when you already have a server instance (e.g., from McpAgent)
 */
export async function initializeSiyuanMCPServer(
  server: McpServer,
  config: SiyuanMCPConfig
): Promise<void> {
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

  // Load tools and prompts
  await loadTools(server, config.readOnlyMode || 'allow_all');
  await loadPrompts(server);

  logPush('SiYuan MCP server initialized with tools');
}

/**
 * Create and configure a new SiYuan MCP server
 * Use this for CLI/stdio usage where you need a new server instance
 */
export async function createSiyuanMCPServer(config: SiyuanMCPConfig): Promise<McpServer> {
  const server = new McpServer(
    {
      name: 'siyuan-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    }
  );

  await initializeSiyuanMCPServer(server, config);
  return server;
}

/**
 * Load and register all tools with the MCP server
 */
export async function loadTools(
  server: McpServer,
  readOnlyMode: 'allow_all' | 'allow_non_destructive' | 'deny_all'
): Promise<void> {
  const providers = getAllToolProviders();

  for (const provider of providers) {
    const tools = await provider.getTools();
    for (const tool of tools) {
      // Skip tools based on read-only mode
      if (
        readOnlyMode === 'deny_all' &&
        (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true)
      ) {
        logPush(`Skipping tool in read-only mode (deny_all): ${tool.name}`);
        continue;
      }
      if (readOnlyMode === 'allow_non_destructive' && tool.annotations?.destructiveHint === true) {
        logPush(`Skipping destructive tool in non-destructive mode: ${tool.name}`);
        continue;
      }

      logPush('Registering tool:', tool.name, tool.title);

      // Register tool using the correct API format
      // The schema from tools is already a Zod schema shape object
      server.tool(
        tool.name,
        tool.description,
        tool.schema || {},
        async (params: any) => {
          debugPush(`Tool ${tool.name} called with params:`, params);
          try {
            return await tool.handler(params, {});
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
  }
}

/**
 * Load and register prompts with the MCP server
 */
export async function loadPrompts(server: McpServer): Promise<void> {
  server.prompt(
    'create_flashcards_system_cn',
    {
      title: lang('prompt_flashcards'),
      description: 'Create flash cards',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: promptCreateCardsSystemCN,
          },
        },
      ],
    })
  );

  server.prompt(
    'sql_query_prompt_cn',
    {
      title: lang('prompt_sql'),
      description: 'SQL Query System Prompt',
    },
    () => ({
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: promptQuerySystemCN,
          },
        },
      ],
    })
  );
}

/**
 * Run the MCP server with stdio transport (for CLI usage)
 */
export async function runStdioServer(config: SiyuanMCPConfig): Promise<void> {
  const server = await createSiyuanMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Re-export SSEServerTransport for handlers
export { SSEServerTransport };
