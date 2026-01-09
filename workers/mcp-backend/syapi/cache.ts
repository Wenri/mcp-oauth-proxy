/**
 * Cache utilities for SiYuan API requests
 * Uses Cloudflare Cache API for caching responses
 */

import { waitUntil } from 'cloudflare:workers';
import isPlainObject from 'lodash-es/isPlainObject';
import { getBaseUrl, postRequest } from './http';

// ============================================================================
// Cache configuration
// ============================================================================

/** Default cache TTL: 1 hour for files, 180s for API responses */
export const DEFAULT_FILE_CACHE_TTL = 3600;
export const DEFAULT_API_CACHE_TTL = 180;

/** Cache version for invalidation. Incrementing this orphans all existing cache entries.
 *  Initialized to startup timestamp to ensure uniqueness across worker restarts. */
let cacheVersion = Date.now();

/** Write endpoints that can cause cache to become outdated */
export const WRITE_ENDPOINTS = [
  // Block modifications
  '/api/attr/setBlockAttrs',
  '/api/attr/batchSetBlockAttrs',
  '/api/block/updateBlock',
  '/api/block/insertBlock',
  '/api/block/prependBlock',
  '/api/block/appendBlock',
  '/api/block/deleteBlock',
  '/api/block/moveBlock',
  '/api/block/foldBlock',
  '/api/block/unfoldBlock',
  // Document operations
  '/api/filetree/createDailyNote',
  '/api/filetree/createDocWithMd',
  '/api/filetree/createDoc',
  '/api/filetree/renameDoc',
  '/api/filetree/removeDoc',
  '/api/filetree/moveDocs',
  '/api/filetree/reindexTree',
  // Flashcards
  '/api/riff/addRiffCards',
  '/api/riff/removeRiffCards',
  // File operations
  '/api/file/putFile',
  '/api/file/removeFile',
  '/api/file/renameFile',
  // Assets
  '/api/asset/upload',
];

/** All API endpoints that use caching (read operations) */
export const CACHED_ENDPOINTS = [
  '/api/attr/getBlockAttrs',
  '/api/notebook/lsNotebooks',
  '/api/notebook/getNotebookConf',
  '/api/notebook/getNotebookInfo',
  '/api/block/getChildBlocks',
  '/api/block/getBlockKramdown',
  '/api/block/getDocInfo',
  '/api/block/getTreeStat',
  '/api/filetree/getDoc',
  '/api/filetree/listDocsByPath',
  '/api/filetree/listDocTree',
  '/api/filetree/getHPathByID',
  '/api/filetree/getIDsByHPath',
  '/api/outline/getDocOutline',
  '/api/export/preview',
  '/api/export/exportMdContent',
  '/api/ref/getBacklink2',
  '/api/riff/getRiffDecks',
  '/api/search/fullTextSearchBlock',
  '/api/file/getFile',
  '/api/file/readDir',
  // Custom SQL query cache paths (used by cachedQuery)
  '/custom/isDoc',
  '/custom/doc',
  '/custom/block',
  '/custom/assets',
  '/custom/fts',
  '/custom/childWordCount',
  '/custom/childDocExist',
  '/custom/docHasAv',
  '/custom/docBlockCount',
  '/custom/docEmpty',
  '/custom/headingIds',
  '/custom/superBlockIds',
  '/custom/highlightBlockIds',
  '/custom/recentDocs',
  '/custom/allDocs',
];

// ============================================================================
// Cache key utilities
// ============================================================================

/**
 * Build a cache key URL from path and optional params.
 * Uses URL object to ensure consistent key format.
 * Includes cache version for invalidation support.
 * Supports arrays as repeated keys (e.g., paths=a&paths=b).
 */
export function getCacheKey(path: string, params?: Record<string, string | number | boolean | string[]>): string {
  const cacheUrl = new URL(path, getBaseUrl());
  // Add cache version to all keys for invalidation support
  cacheUrl.searchParams.set('_v', String(cacheVersion));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        // Repeated keys for arrays
        for (const item of value) {
          cacheUrl.searchParams.append(key, item);
        }
      } else {
        cacheUrl.searchParams.append(key, String(value));
      }
    }
  }
  return cacheUrl.href;
}

// ============================================================================
// Cache response utilities
// ============================================================================

/**
 * Check if a value is a valid BodyInit type that can be passed to Response constructor.
 * Valid types: string, Blob, ArrayBuffer, TypedArray, DataView, ReadableStream, FormData, URLSearchParams
 */
function isValidBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === 'string' ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) || // Covers all TypedArrays and DataView
    value instanceof ReadableStream ||
    value instanceof FormData ||
    value instanceof URLSearchParams
  );
}

/**
 * Cache a response body and return a Response object.
 * Handles both Uint8Array (already buffered) and ReadableStream (uses tee()).
 * @param body - Response body to cache
 * @param headers - Response headers (Cache-Control will be added for caching)
 * @param cacheKey - Cache key URL
 * @param cacheTtl - Cache TTL in seconds (0 = no caching)
 * @returns Response object for the caller
 */
export function cacheResponse(
  body: BodyInit | object,
  headers: Headers,
  cacheKey: string,
  cacheTtl: number
): Response {
  // Auto-stringify objects and arrays to JSON
  // Note: isPlainObject returns false for arrays, so we need to check both
  let data: BodyInit;
  if (isPlainObject(body) || Array.isArray(body)) {
    headers.set('Content-Type', 'application/json');
    data = JSON.stringify(body);
  } else if (isValidBodyInit(body)) {
    data = body;
  } else {
    // Throw for non-cacheable types like Date, Map, Set, class instances
    const typeName = (body as object)?.constructor?.name ?? typeof body;
    throw new Error(
      `cacheResponse: unsupported body type "${typeName}". ` +
        `Expected plain object, array, or BodyInit (string, Blob, ArrayBuffer, ReadableStream, etc.)`
    );
  }

  if (cacheTtl > 0) {
    const cache = caches.default;
    const cacheHeaders = new Headers(headers);
    cacheHeaders.set('Cache-Control', `public, max-age=${cacheTtl}`);

    // ReadableStream needs tee() to split for cache vs return
    if (data instanceof ReadableStream) {
      const [cacheStream, returnStream] = data.tee();
      waitUntil(cache.put(cacheKey, new Response(cacheStream, { status: 200, headers: cacheHeaders })));
      return new Response(returnStream, { status: 200, headers });
    }

    waitUntil(cache.put(cacheKey, new Response(data, { status: 200, headers: cacheHeaders })));
  }

  return new Response(data, { status: 200, headers });
}

// ============================================================================
// Cached request functions
// ============================================================================

/**
 * Cached POST request for JSON APIs.
 * Caches successful responses (code === 0) for the specified TTL.
 * @param data - Request body (must be flat object with primitive values)
 * @param url - API endpoint
 * @param cacheTtl - Cache TTL in seconds (0 = no caching)
 * @returns Parsed JSON response
 */
export async function cachedPostRequest(data: Record<string, string | number | boolean>, url: string, cacheTtl: number = DEFAULT_API_CACHE_TTL): Promise<any> {
  const cacheKey = getCacheKey(url, data);

  // Check cache first
  if (cacheTtl > 0) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return cached.json();
    }
  }

  // Fetch from kernel
  const response = await postRequest(data, url);

  // Cache using cacheResponse helper
  if (cacheTtl > 0 && response.code === 0) {
    cacheResponse(response, new Headers(), cacheKey, cacheTtl);
  }

  return response;
}

// ============================================================================
// Write request with cache invalidation
// ============================================================================

/**
 * POST request for write operations that invalidates cache on success.
 * Use this for any endpoint in WRITE_ENDPOINTS.
 * @param data Request body
 * @param url API endpoint
 * @returns Parsed JSON response
 */
export async function writePostRequest(data: any, url: string): Promise<any> {
  const response = await postRequest(data, url);
  if (response.code === 0) {
    invalidateCache();
  }
  return response;
}

// ============================================================================
// Cache invalidation
// ============================================================================

/**
 * Invalidate all cached API responses by incrementing the cache version.
 * Old cache entries become orphaned and expire naturally based on their TTL.
 * Called after write operations or when flushing database transactions.
 */
export function invalidateCache(): void {
  cacheVersion++;
}
