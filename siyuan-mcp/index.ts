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
import { encryptGrant } from './utils/crypto';
import { initKernel, postRequest } from './syapi';

// Import prompts
import promptCreateCardsSystemCN from './static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from './static/prompt_dynamic_query_system_CN.md';

// Re-export types for convenience (canonical source is ../types)
export type { Env, SiyuanConfig, SiyuanMCPConfig } from '../types';

// Re-export for external use (handlers)
export { logPush } from './logger';
export { buildKernelHeaders } from './syapi';

// ============================================================================
// Context - Module-level state
// ============================================================================

let config: SiyuanConfig | null = null;
let workerBaseUrl: string | undefined;
let oauthTokenExpiresAt: number | undefined;
let grantKey: string | undefined;
let encryptionKey: string | undefined;

/** Set the OAuth token expiry (captured from Authorization header) */
export function setOAuthTokenExpiry(expiresAt?: number): void {
  oauthTokenExpiresAt = expiresAt;
}

/** Set the grant key (userId:grantId) extracted from access token */
export function setGrantKey(key: string): void {
  grantKey = key;
}

/** Get remaining TTL for OAuth token in seconds */
export function getTokenTtl(): number {
  if (!oauthTokenExpiresAt) return 3600; // Default 1 hour if unknown
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, oauthTokenExpiresAt - now);
}

/** Get the current SiYuan config */
export function getConfig(): SiyuanConfig {
  if (!config) {
    throw new Error('MCP server not initialized.');
  }
  return config;
}

/** Check if context is initialized */
export function hasContext(): boolean {
  return config !== null;
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
 *
 * @param server - The MCP server instance to configure
 * @param mcpConfig - SiYuan configuration (kernel URL, tokens, etc.)
 * @param baseUrl - Optional worker base URL for constructing download URLs
 * @param cookieEncryptionKey - Optional encryption key for download URL tokens
 */
export async function initializeSiyuanMCPServer(
  server: McpServer,
  mcpConfig: SiyuanMCPConfig,
  baseUrl?: string,
  cookieEncryptionKey?: string
): Promise<void> {
  workerBaseUrl = baseUrl;
  encryptionKey = cookieEncryptionKey;

  // Initialize kernel connection
  const kernelUrl = (mcpConfig.SIYUAN_KERNEL_URL || baseUrl || '').replace(/\/$/, '');
  if (!kernelUrl) throw new Error('SIYUAN_KERNEL_URL or baseUrl required');

  initKernel(
    kernelUrl,
    mcpConfig.SIYUAN_KERNEL_TOKEN,
    mcpConfig.CF_ACCESS_SERVICE_CLIENT_ID,
    mcpConfig.CF_ACCESS_SERVICE_CLIENT_SECRET
  );

  // Fetch config from kernel
  const result = await postRequest({}, '/api/system/getConf') as { code: number; data: { conf: SiyuanConfig } };
  if (result.code !== 0 || !result.data?.conf) {
    throw new Error('Failed to get SiYuan config');
  }
  config = result.data.conf;

  // Apply local config overrides
  config.filterNotebooks = mcpConfig.FILTER_NOTEBOOKS;
  config.filterDocuments = mcpConfig.FILTER_DOCUMENTS;
  config.autoApproveLocalChange = mcpConfig.AUTO_APPROVE_LOCAL_CHANGE;
  if (mcpConfig.RAG_BASE_URL) {
    config.rag = { baseUrl: mcpConfig.RAG_BASE_URL, apiKey: mcpConfig.RAG_API_KEY };
  }

  // Load tools and prompts
  await loadTools(server, mcpConfig.READ_ONLY_MODE || 'allow_all');
  await loadPrompts(server);
  logPush('SiYuan MCP server initialized');
}

/**
 * Build a download URL for an export file using encrypted grant token
 */
export async function buildDownloadUrl(path: string): Promise<string> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (workerBaseUrl && grantKey && encryptionKey) {
    const token = await encryptGrant(grantKey, normalizedPath, encryptionKey);
    return `${workerBaseUrl}/download/${token}${normalizedPath}`;
  }
  debugPush('buildDownloadUrl fallback:', { workerBaseUrl: !!workerBaseUrl, grantKey: !!grantKey, encryptionKey: !!encryptionKey });
  return `/download/<token>${normalizedPath}`;
}

/**
 * Create a new SiYuan MCP server instance (sync)
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
