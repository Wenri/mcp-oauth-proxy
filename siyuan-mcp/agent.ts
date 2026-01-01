/**
 * SiYuan MCP Agent for Cloudflare Workers
 *
 * Extends McpAgent from the agents package to provide a Workers-compatible
 * MCP server with all SiYuan tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { setPlatformContext, createCloudflareContext } from './platform';
import { getAllToolProviders } from './tools';
import { logPush, debugPush } from './logger';
import { lang } from './utils/lang';

// Import prompts
import promptCreateCardsSystemCN from './static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from './static/prompt_dynamic_query_system_CN.md';

// Environment interface for SiYuan MCP
export interface SiyuanEnv {
  OAUTH_KV: KVNamespace;
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
}

/**
 * SiYuan MCP Agent
 *
 * Provides MCP tools for interacting with SiYuan Note.
 */
export class SiyuanMCP extends McpAgent<SiyuanEnv> {
  server = new McpServer({
    name: 'siyuan-mcp',
    version: '1.0.0',
  });

  /**
   * Initialize the MCP server with tools and prompts
   */
  async init() {
    // Initialize platform context from environment
    const env = this.env;

    if (!env.SIYUAN_KERNEL_URL) {
      logPush('Warning: SIYUAN_KERNEL_URL not configured');
      return;
    }

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

    // Load tools
    await this.loadTools(env.READ_ONLY_MODE || 'allow_all');

    // Load prompts
    await this.loadPrompts();

    logPush('SiYuan MCP agent initialized');
  }

  /**
   * Load and register all tools with the MCP server
   */
  private async loadTools(
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

        logPush('Registering tool:', tool.name);

        // Register tool with Zod schema
        this.server.tool(
          tool.name,
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
  private async loadPrompts(): Promise<void> {
    this.server.prompt(
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

    this.server.prompt(
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
}
