/**
 * SiYuan MCP - Main entry point
 *
 * This module provides a Model Context Protocol (MCP) server for SiYuan Note
 * running on Cloudflare Workers.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SiyuanConfig, SiyuanMCPConfig } from '../types';
import { getAllToolProviders } from './tools';
import { logPush, debugPush } from './logger';
import { encryptGrant } from './utils/crypto';
import { initKernel, cachedPostRequest, normalizePath, getNodebookList, getDoc, getKramdown } from './syapi';
import { getDocDBitem, getBlockDBItem } from './syapi/custom';

// Import prompts
import promptCreateCardsSystemCN from './static/prompt_create_cards_system_CN.md';
import promptQuerySystemCN from './static/prompt_dynamic_query_system_CN.md';

// Import static resources
import databaseSchema from './static/siyuan-database-schema.md';
import sqlCheatsheet from './static/siyuan-sql-cheatsheet.md';
import querySyntax from './static/query_syntax.md';

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

// Re-export generateBlockId as generateNodeID for backward compatibility
export { generateBlockId as generateNodeID } from './syapi/custom';

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
  const result = await cachedPostRequest({}, '/api/system/getConf') as { code: number; data: { conf: SiyuanConfig } };
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

  // Load tools, prompts, and resources
  await loadTools(server, mcpConfig.READ_ONLY_MODE || 'allow_all');
  await loadPrompts(server);
  await loadResources(server);
  logPush('SiYuan MCP server initialized');
}

/**
 * Build a download URL for an export file using encrypted grant token
 */
export async function buildDownloadUrl(path: string): Promise<string> {
  const normalizedPath = normalizePath(path);
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
    { capabilities: { tools: {}, prompts: {}, resources: {} } }
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

      const { name, handler, ...options } = tool;
      server.registerTool(name, options, async (params: any, extra: any) => {
        debugPush(`Tool ${name} called with params:`, params);
        try {
          return await handler(params, extra);
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

/** Load and register resources with the MCP server */
async function loadResources(server: McpServer): Promise<void> {
  // ============================================================================
  // Static Resources - Documentation
  // ============================================================================

  server.registerResource(
    'database-schema',
    'siyuan://docs/database-schema',
    {
      title: 'SiYuan Database Schema',
      description: 'Database schema documentation including table names, field names, and relationships',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: databaseSchema, mimeType: 'text/markdown' }],
    })
  );

  server.registerResource(
    'sql-cheatsheet',
    'siyuan://docs/sql-cheatsheet',
    {
      title: 'SiYuan SQL Cheatsheet',
      description: 'SQL query examples for SiYuan database including FTS5 full-text search, window functions, and common patterns',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: sqlCheatsheet, mimeType: 'text/markdown' }],
    })
  );

  server.registerResource(
    'query-syntax',
    'siyuan://docs/query-syntax',
    {
      title: 'SiYuan Query Syntax',
      description: 'Full-text search query syntax reference for SiYuan',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: querySyntax, mimeType: 'text/markdown' }],
    })
  );

  // ============================================================================
  // Dynamic Resources - Notebooks
  // ============================================================================

  server.registerResource(
    'notebooks',
    new ResourceTemplate('siyuan://notebooks/{notebookId}', {
      list: async () => {
        const notebooks = await getNodebookList();
        return {
          resources: notebooks.map((nb: any) => ({
            uri: `siyuan://notebooks/${nb.id}`,
            name: nb.name,
            description: nb.closed ? '(closed)' : '(open)',
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'SiYuan Notebook',
      description: 'Notebook metadata by ID',
    },
    async (uri, params) => {
      const notebookId = Array.isArray(params.notebookId) ? params.notebookId[0] : params.notebookId;
      const notebooks = await getNodebookList();
      const notebook = notebooks.find((nb: any) => nb.id === notebookId);
      if (!notebook) {
        return { contents: [{ uri: uri.href, text: `Notebook not found: ${notebookId}` }] };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(notebook, null, 2),
        }],
      };
    }
  );

  // ============================================================================
  // Dynamic Resources - Documents
  // ============================================================================

  server.registerResource(
    'document',
    new ResourceTemplate('siyuan://doc/{docId}', {
      list: undefined, // Too many docs to list
    }),
    {
      title: 'SiYuan Document',
      description: 'Document content in Markdown format by ID',
    },
    async (uri, params) => {
      const docId = Array.isArray(params.docId) ? params.docId[0] : params.docId;
      const docInfo = await getDocDBitem(docId);
      if (!docInfo) {
        return { contents: [{ uri: uri.href, text: `Document not found: ${docId}` }] };
      }
      const doc = await getDoc(docId);
      if (!doc?.content) {
        return { contents: [{ uri: uri.href, text: `Failed to read document: ${docId}` }] };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: doc.content,
        }],
      };
    }
  );

  // ============================================================================
  // Dynamic Resources - Blocks
  // ============================================================================

  server.registerResource(
    'block',
    new ResourceTemplate('siyuan://block/{blockId}', {
      list: undefined, // Too many blocks to list
    }),
    {
      title: 'SiYuan Block',
      description: 'Block content in Kramdown format by ID',
    },
    async (uri, params) => {
      const blockId = Array.isArray(params.blockId) ? params.blockId[0] : params.blockId;
      const blockInfo = await getBlockDBItem(blockId);
      if (!blockInfo) {
        return { contents: [{ uri: uri.href, text: `Block not found: ${blockId}` }] };
      }
      const kramdown = await getKramdown(blockId);
      if (!kramdown) {
        return { contents: [{ uri: uri.href, text: `Failed to read block: ${blockId}` }] };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: kramdown,
        }],
      };
    }
  );

  logPush('Resources registered: 3 static, 3 dynamic');
}
