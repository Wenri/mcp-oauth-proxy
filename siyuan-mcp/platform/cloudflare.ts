/**
 * Cloudflare Workers platform implementation
 */

import type { PlatformContext, SiyuanConfig } from './types';

/**
 * Generate a SiYuan-compatible node ID
 * Format: yyyyMMddHHmmss-7alphanumeric (e.g., 20240101120000-abc1234)
 */
function generateNodeID(): string {
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
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

export interface CloudflareContextOptions {
  /** SiYuan kernel URL (e.g., https://siyuan.example.com) */
  kernelBaseUrl: string;
  /** SiYuan API token for authentication */
  kernelToken?: string;
  /** RAG server config */
  ragConfig?: {
    baseUrl: string;
    apiKey?: string;
  };
  /** Newline-separated notebook IDs to exclude */
  filterNotebooks?: string;
  /** Newline-separated document IDs to exclude */
  filterDocuments?: string;
  /** App ID for dailynote creation */
  appId?: string;
  /** Auto-approve local changes */
  autoApproveLocalChange?: boolean;
}

/**
 * Create a platform context for Cloudflare Workers
 * Fetches config from kernel API on initialization
 */
export async function createCloudflareContext(
  options: CloudflareContextOptions
): Promise<PlatformContext> {
  const { kernelBaseUrl, kernelToken, ragConfig, filterNotebooks, filterDocuments, appId, autoApproveLocalChange } = options;

  // Normalize kernel URL (remove trailing slash)
  const baseUrl = kernelBaseUrl.replace(/\/$/, '');

  // Create authenticated fetch function
  const kernelFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
    const headers: Record<string, string> = {
      ...init?.headers as Record<string, string>,
      'Content-Type': 'application/json',
    };
    if (kernelToken) {
      headers['Authorization'] = `Token ${kernelToken}`;
    }
    return fetch(fullUrl, {
      ...init,
      headers,
    });
  };

  // Fetch SiYuan config from kernel
  let config: SiyuanConfig;
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
  if (ragConfig) {
    config.rag = ragConfig;
  }

  return {
    config,
    generateNodeID,
    kernelFetch,
    platform: 'cloudflare',
  };
}
