/**
 * Handlers - Cloudflare Workers integration
 *
 * Provides OAuthProvider configuration with SiyuanMCP agent.
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { handleOAuthRoute } from './oauth';
import {
  setPlatformContext,
  createCloudflareContext,
  getAllToolProviders,
  logPush,
  debugPush,
  lang,
} from '../siyuan-mcp';

// Import prompts
import promptCreateCardsSystemCN from '../siyuan-mcp/static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from '../siyuan-mcp/static/prompt_dynamic_query_system_CN.md';

// Environment interface
export interface Env {
  OAUTH_KV: KVNamespace;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  COOKIE_ENCRYPTION_KEY: string;
  DOWNSTREAM_MCP_URL: string;
  SIYUAN_KERNEL_URL: string;
  SIYUAN_KERNEL_TOKEN?: string;
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  FILTER_NOTEBOOKS?: string;
  FILTER_DOCUMENTS?: string;
  READ_ONLY_MODE?: 'allow_all' | 'allow_non_destructive' | 'deny_all';
}

/**
 * SiYuan MCP Agent for Cloudflare Workers
 */
export class SiyuanMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'siyuan-mcp',
    version: '1.0.0',
  });

  async init() {
    const env = this.env;

    if (!env.SIYUAN_KERNEL_URL) {
      logPush('Warning: SIYUAN_KERNEL_URL not configured');
      return;
    }

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

    await this.loadTools(env.READ_ONLY_MODE || 'allow_all');
    await this.loadPrompts();

    logPush('SiYuan MCP agent initialized');
  }

  private async loadTools(
    readOnlyMode: 'allow_all' | 'allow_non_destructive' | 'deny_all'
  ): Promise<void> {
    const providers = getAllToolProviders();

    for (const provider of providers) {
      const tools = await provider.getTools();
      for (const tool of tools) {
        if (
          readOnlyMode === 'deny_all' &&
          (tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint === true)
        ) {
          continue;
        }
        if (readOnlyMode === 'allow_non_destructive' && tool.annotations?.destructiveHint === true) {
          continue;
        }

        this.server.tool(tool.name, tool.schema || {}, async (params: any) => {
          debugPush(`Tool ${tool.name} called`, params);
          try {
            return await tool.handler(params, {});
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true,
            };
          }
        });
      }
    }
  }

  private async loadPrompts(): Promise<void> {
    this.server.prompt(
      'create_flashcards_system_cn',
      { title: lang('prompt_flashcards'), description: 'Create flash cards' },
      () => ({
        messages: [
          { role: 'user', content: { type: 'text', text: promptCreateCardsSystemCN } },
        ],
      })
    );

    this.server.prompt(
      'sql_query_prompt_cn',
      { title: lang('prompt_sql'), description: 'SQL Query System Prompt' },
      () => ({
        messages: [
          { role: 'assistant', content: { type: 'text', text: promptQuerySystemCN } },
        ],
      })
    );
  }
}

/**
 * Default handler for non-API requests
 */
const defaultHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const oauthResponse = await handleOAuthRoute(request, env, url);
    if (oauthResponse) {
      return oauthResponse;
    }

    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          name: 'siyuan-mcp',
          version: '1.0.0',
          endpoints: { sse: '/sse', mcp: '/mcp', authorize: '/authorize', token: '/token' },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  },
};

/**
 * OAuthProvider with SiyuanMCP agent
 */
export default new OAuthProvider({
  apiRoute: ['/sse', '/mcp'],
  // @ts-expect-error - McpAgent.mount returns compatible handler
  apiHandler: SiyuanMCP.mount('/sse'),
  // @ts-expect-error - Handler type mismatch
  defaultHandler: defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
  scopesSupported: ['openid', 'email', 'profile', 'offline_access'],
});
