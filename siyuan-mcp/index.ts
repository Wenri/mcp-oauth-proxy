/**
 * SiYuan MCP - Main entry point
 *
 * This module provides a Model Context Protocol (MCP) server for SiYuan Note
 * running on Cloudflare Workers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SiyuanConfig, SiyuanMCPConfig } from '../types';
import { getAllToolProviders } from './tools';
import { logPush, debugPush } from './logger';

// Import prompts
import promptCreateCardsSystemCN from './static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from './static/prompt_dynamic_query_system_CN.md';

// Re-export types for convenience (canonical source is ../types)
export type { Env, SiyuanConfig, SiyuanMCPConfig } from '../types';

// Re-export logger (used by handlers)
export { logPush } from './logger';

// ============================================================================
// Context - Module-level state and kernel communication
// ============================================================================

let config: SiyuanConfig | null = null;
let baseUrl: string = '';
let authToken: string | undefined;
let cfAccessToken: string | undefined;
let cfServiceClientId: string | undefined;
let cfServiceClientSecret: string | undefined;

/**
 * Initialize the SiYuan context
 * Fetches config from kernel API on initialization
 */
export async function initializeContext(options: SiyuanMCPConfig): Promise<void> {
  baseUrl = options.SIYUAN_KERNEL_URL.replace(/\/$/, '');
  authToken = options.SIYUAN_KERNEL_TOKEN;
  cfServiceClientId = options.CF_ACCESS_SERVICE_CLIENT_ID;
  cfServiceClientSecret = options.CF_ACCESS_SERVICE_CLIENT_SECRET;

  try {
    const response = await kernelFetch('/api/system/getConf', { method: 'POST', body: '{}' });
    const result = (await response.json()) as { code: number; data: { conf: SiyuanConfig } };
    if (result.code !== 0) {
      throw new Error('Failed to get SiYuan config');
    }
    config = result.data.conf;
  } catch (error) {
    console.error('Failed to fetch SiYuan config, using defaults:', error);
    config = {
      system: { id: 'unknown', os: 'unknown', kernelVersion: '0.0.0' },
      editor: { markdown: { inlineMath: true } },
      export: { addTitle: false },
      flashcard: { deck: true },
      fileTree: { sort: 0 },
    };
  }

  config.filterNotebooks = options.FILTER_NOTEBOOKS;
  config.filterDocuments = options.FILTER_DOCUMENTS;
  config.autoApproveLocalChange = options.AUTO_APPROVE_LOCAL_CHANGE;
  if (options.RAG_BASE_URL) {
    config.rag = { baseUrl: options.RAG_BASE_URL, apiKey: options.RAG_API_KEY };
  }
}

/** Get the current SiYuan config */
export function getConfig(): SiyuanConfig {
  if (!config) {
    throw new Error('Context not initialized. Call initializeContext first.');
  }
  return config;
}

/** Check if context is initialized */
export function hasContext(): boolean {
  return config !== null;
}

/**
 * Build auth headers for SiYuan kernel requests.
 * @param token - SiYuan API token
 * @param cfAccessToken - CF Access token for linked app authentication
 * @param cfServiceClientId - CF Access Service Token client ID
 * @param cfServiceClientSecret - CF Access Service Token client secret
 */
export function buildKernelHeaders(
  token?: string,
  cfAccessToken?: string,
  cfServiceClientId?: string,
  cfServiceClientSecret?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  // Add CF Access token for linked app authentication
  // See: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/
  if (cfAccessToken) {
    headers['cf-access-token'] = cfAccessToken;
  }
  // Add CF Access Service Token for API authentication
  // See: https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/
  if (cfServiceClientId && cfServiceClientSecret) {
    headers['CF-Access-Client-Id'] = cfServiceClientId;
    headers['CF-Access-Client-Secret'] = cfServiceClientSecret;
  }
  return headers;
}

/**
 * Fetch from SiYuan kernel with authentication using module-level context.
 * Use this inside MCP tools where initializeContext() has been called.
 */
export async function kernelFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!baseUrl && !url.startsWith('http')) {
    throw new Error('Context not initialized. Call initializeContext first.');
  }

  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const headers = buildKernelHeaders(authToken, cfAccessToken, cfServiceClientId, cfServiceClientSecret);

  return fetch(fullUrl, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  });
}

/** Generate a SiYuan-compatible node ID */
export function generateNodeID(): string {
  const now = new Date();
  const timestamp =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let random = '';
  for (let i = 0; i < 7; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `${timestamp}-${random}`;
}

/** Get the app ID for dailynote creation */
export function getAppId(): string {
  return config?.appId || 'siyuan-mcp-worker';
}

// ============================================================================
// Server - MCP server initialization
// ============================================================================

/**
 * Initialize an existing MCP server with SiYuan tools and prompts
 * Use this when you already have a server instance (e.g., from McpAgent)
 *
 * @param server - The MCP server instance to configure
 * @param mcpConfig - SiYuan configuration (kernel URL, tokens, etc.)
 * @param accessToken - Optional CF Access token for linked app authentication
 */
export async function initializeSiyuanMCPServer(
  server: McpServer,
  mcpConfig: SiyuanMCPConfig,
  accessToken?: string
): Promise<void> {
  cfAccessToken = accessToken;
  await initializeContext(mcpConfig);
  await loadTools(server, mcpConfig.READ_ONLY_MODE || 'allow_all');
  await loadPrompts(server);
  logPush('SiYuan MCP server initialized with tools');
}

/**
 * Create a new SiYuan MCP server instance (sync)
 * Call initializeSiyuanMCPServer() to configure it with tools and prompts
 */
export function createSiyuanMCPServer(): McpServer {
  return new McpServer(
    { name: 'siyuan-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {} } }
  );
}

/** Load and register all tools with the MCP server */
async function loadTools(
  server: McpServer,
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
        logPush(`Skipping tool in read-only mode (deny_all): ${tool.name}`);
        continue;
      }
      if (readOnlyMode === 'allow_non_destructive' && tool.annotations?.destructiveHint === true) {
        logPush(`Skipping destructive tool in non-destructive mode: ${tool.name}`);
        continue;
      }

      logPush('Registering tool:', tool.name, tool.title);

      server.tool(tool.name, tool.description, tool.schema || {}, async (params: any) => {
        debugPush(`Tool ${tool.name} called with params:`, params);
        try {
          return await tool.handler(params, {});
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Error: ${error.message || 'Unknown error'}` }],
            isError: true,
          };
        }
      });
    }
  }
}

/** Load and register prompts with the MCP server */
async function loadPrompts(server: McpServer): Promise<void> {
  server.prompt('create_flashcards_system_cn', 'Create flash cards for SiYuan', () => ({
    messages: [
      { role: 'user', content: { type: 'text', text: promptCreateCardsSystemCN } },
    ],
  }));

  server.prompt('sql_query_prompt_cn', 'SQL Query System Prompt for SiYuan', () => ({
    messages: [
      { role: 'assistant', content: { type: 'text', text: promptQuerySystemCN } },
    ],
  }));
}
