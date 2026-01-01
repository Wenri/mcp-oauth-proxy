/**
 * SiYuan MCP Server for Cloudflare Workers
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initializeContext } from './context';
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
  // Initialize context
  await initializeContext({
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

  // Load tools and prompts
  await loadTools(server, config.readOnlyMode || 'allow_all');
  await loadPrompts(server);

  logPush('SiYuan MCP server initialized with tools');
}

/**
 * Create a new SiYuan MCP server instance (sync)
 * Call initializeSiyuanMCPServer() to configure it with tools and prompts
 */
export function createSiyuanMCPServer(): McpServer {
  return new McpServer(
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
}

/**
 * Load and register all tools with the MCP server
 */
async function loadTools(
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
async function loadPrompts(server: McpServer): Promise<void> {
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
