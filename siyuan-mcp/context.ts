/**
 * SiYuan MCP Context
 *
 * Simplified context management for Cloudflare Workers.
 * Call initializeContext() before using any API functions.
 */

import type { SiyuanConfig, SiyuanMCPConfig } from './types/context';

// Module-level state
let config: SiyuanConfig | null = null;
let baseUrl: string = '';
let authToken: string | undefined;

/**
 * Initialize the SiYuan context
 * Fetches config from kernel API on initialization
 */
export async function initializeContext(options: SiyuanMCPConfig): Promise<void> {
  const { kernelBaseUrl, kernelToken, ragBaseUrl, ragApiKey, filterNotebooks, filterDocuments, appId, autoApproveLocalChange } = options;

  // Normalize kernel URL (remove trailing slash)
  baseUrl = kernelBaseUrl.replace(/\/$/, '');
  authToken = kernelToken;

  // Fetch SiYuan config from kernel
  try {
    const response = await kernelFetch('/api/system/getConf', { method: 'POST', body: '{}' });
    const result = await response.json() as { code: number; data: { conf: SiyuanConfig } };
    if (result.code !== 0) {
      throw new Error('Failed to get SiYuan config');
    }
    config = result.data.conf;
  } catch (error) {
    // Provide sensible defaults if config fetch fails
    console.error('Failed to fetch SiYuan config, using defaults:', error);
    config = {
      system: { id: 'unknown', os: 'unknown', kernelVersion: '0.0.0' },
      editor: { markdown: { inlineMath: true } },
      export: { addTitle: false },
      flashcard: { deck: true },
      fileTree: { sort: 0 },
    };
  }

  // Merge extended config from options
  config.filterNotebooks = filterNotebooks;
  config.filterDocuments = filterDocuments;
  config.appId = appId;
  config.autoApproveLocalChange = autoApproveLocalChange;
  if (ragBaseUrl) {
    config.rag = { baseUrl: ragBaseUrl, apiKey: ragApiKey };
  }
}

/**
 * Get the current SiYuan config
 */
export function getConfig(): SiyuanConfig {
  if (!config) {
    throw new Error('Context not initialized. Call initializeContext first.');
  }
  return config;
}

/**
 * Check if context is initialized
 */
export function hasContext(): boolean {
  return config !== null;
}

/**
 * Fetch from SiYuan kernel with authentication
 */
export async function kernelFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!baseUrl && !url.startsWith('http')) {
    throw new Error('Context not initialized. Call initializeContext first.');
  }

  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (authToken) {
    headers['Authorization'] = `Token ${authToken}`;
  }
  return fetch(fullUrl, { ...init, headers });
}

/**
 * Generate a SiYuan-compatible node ID
 * Format: yyyyMMddHHmmss-7alphanumeric (e.g., 20240101120000-abc1234)
 */
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

/**
 * Get the app ID for dailynote creation
 */
export function getAppId(): string {
  return config?.appId || 'siyuan-mcp-worker';
}
