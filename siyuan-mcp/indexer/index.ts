/**
 * RAG Indexer for Cloudflare Workers
 *
 * This module provides document indexing for RAG (Retrieval-Augmented Generation).
 * It can be triggered by CF Cron or called manually to index documents.
 */

import { initializeContext } from '../context';
import type { SiyuanMCPConfig } from '../../types';
import { queryAPI, exportMdContent } from '../syapi';
import { isValidStr } from '../utils/commonCheck';
import { debugPush, logPush, errorPush } from '../logger';

export interface IndexerConfig
  extends Pick<SiyuanMCPConfig, 'SIYUAN_KERNEL_URL' | 'SIYUAN_KERNEL_TOKEN' | 'RAG_BASE_URL' | 'RAG_API_KEY'> {
  batchSize?: number;
  maxDocuments?: number;
}

export interface RAGProvider {
  update(id: string, content: string): Promise<void>;
  delete(id: string): Promise<void>;
  health(): Promise<any>;
}

/**
 * Create RAG provider from config
 */
function createRAGProvider(config: IndexerConfig): RAGProvider {
  const ragUrl = config.RAG_BASE_URL!;
  const baseUrl = ragUrl.endsWith('/') ? ragUrl + 'api/v1' : ragUrl + '/api/v1';

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.RAG_API_KEY || '',
  };

  return {
    async update(id: string, content: string): Promise<void> {
      const resp = await fetch(`${baseUrl}/index`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, content }),
      });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(`Index update failed: ${resp.status} - ${msg}`);
      }
    },

    async delete(id: string): Promise<void> {
      const resp = await fetch(`${baseUrl}/index/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(`Index delete failed: ${resp.status} - ${msg}`);
      }
    },

    async health(): Promise<any> {
      try {
        const resp = await fetch(`${baseUrl}/health`, {
          method: 'GET',
          headers,
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch {
        return null;
      }
    },
  };
}

/**
 * Queue for managing document indexing
 */
export class IndexQueue {
  private kv: KVNamespace;
  private prefix: string;

  constructor(kv: KVNamespace, prefix = 'idx_queue') {
    this.kv = kv;
    this.prefix = prefix;
  }

  /**
   * Add document IDs to the queue
   */
  async enqueue(ids: string[]): Promise<void> {
    const timestamp = Date.now();
    for (const id of ids) {
      await this.kv.put(`${this.prefix}:${id}`, JSON.stringify({ id, timestamp }), {
        expirationTtl: 86400 * 7, // 7 days TTL
      });
    }
  }

  /**
   * Get and remove items from queue
   */
  async dequeue(limit: number): Promise<string[]> {
    const list = await this.kv.list({ prefix: `${this.prefix}:`, limit });
    const ids: string[] = [];

    for (const key of list.keys) {
      const id = key.name.replace(`${this.prefix}:`, '');
      ids.push(id);
      await this.kv.delete(key.name);
    }

    return ids;
  }

  /**
   * Get queue size
   */
  async size(): Promise<number> {
    const list = await this.kv.list({ prefix: `${this.prefix}:` });
    return list.keys.length;
  }
}

/**
 * Index documents from queue
 */
export async function processIndexQueue(config: IndexerConfig, kv: KVNamespace): Promise<{
  processed: number;
  errors: number;
}> {
  // Initialize context
  await initializeContext(config);

  const provider = createRAGProvider(config);
  const queue = new IndexQueue(kv);
  const batchSize = config.batchSize || 5;

  // Check RAG backend health
  const health = await provider.health();
  if (!health) {
    errorPush('RAG backend is not healthy, skipping indexing');
    return { processed: 0, errors: 0 };
  }

  // Get items from queue
  const ids = await queue.dequeue(batchSize);
  if (ids.length === 0) {
    debugPush('Queue is empty, nothing to index');
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  // Process each document
  for (const id of ids) {
    try {
      // Get document content
      const markdown = await exportMdContent({ id, refMode: 4, embedMode: 1, yfm: false });
      const content = markdown?.content;

      if (!isValidStr(content)) {
        debugPush(`Document ${id} has no content, skipping`);
        continue;
      }

      // Send to RAG backend
      await provider.update(id, content);
      processed++;
      logPush(`Indexed document: ${id}`);
    } catch (err) {
      errors++;
      errorPush(`Failed to index document ${id}:`, err);
      // Re-queue for retry
      await queue.enqueue([id]);
    }
  }

  return { processed, errors };
}

/**
 * Queue recently updated documents for indexing
 */
export async function queueRecentDocuments(
  config: IndexerConfig,
  kv: KVNamespace,
  sinceMinutes: number = 60
): Promise<number> {
  // Initialize context
  await initializeContext(config);

  // Calculate timestamp for query
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const sinceStr = since
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);

  // Query for recently updated documents
  const sql = `SELECT id FROM blocks WHERE type = 'd' AND updated >= '${sinceStr}' LIMIT ${config.maxDocuments || 100}`;
  const result = await queryAPI(sql);

  if (!result || result.length === 0) {
    debugPush('No recently updated documents found');
    return 0;
  }

  // Add to queue
  const queue = new IndexQueue(kv);
  const ids = result.map((row: any) => row.id);
  await queue.enqueue(ids);

  logPush(`Queued ${ids.length} documents for indexing`);
  return ids.length;
}

/**
 * Full reindex of all documents
 */
export async function queueAllDocuments(
  config: IndexerConfig,
  kv: KVNamespace,
  maxDocuments: number = 1000
): Promise<number> {
  // Initialize context
  await initializeContext(config);

  // Query for all documents
  const sql = `SELECT id FROM blocks WHERE type = 'd' LIMIT ${maxDocuments}`;
  const result = await queryAPI(sql);

  if (!result || result.length === 0) {
    debugPush('No documents found');
    return 0;
  }

  // Add to queue
  const queue = new IndexQueue(kv);
  const ids = result.map((row: any) => row.id);
  await queue.enqueue(ids);

  logPush(`Queued ${ids.length} documents for full reindex`);
  return ids.length;
}
