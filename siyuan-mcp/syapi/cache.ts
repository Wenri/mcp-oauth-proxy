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

/** All API endpoints that use caching */
export const CACHED_ENDPOINTS = [
  '/api/attr/getBlockAttrs',
  '/api/notebook/lsNotebooks',
  '/api/notebook/getNotebookConf',
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
 * Supports arrays as repeated keys (e.g., paths=a&paths=b).
 */
export function getCacheKey(path: string, params?: Record<string, string | number | boolean | string[]>): string {
  const cacheUrl = new URL(path, getBaseUrl());
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        // Repeated keys for arrays
        for (const item of value) {
          searchParams.append(key, item);
        }
      } else {
        searchParams.append(key, String(value));
      }
    }
    cacheUrl.search = searchParams.toString();
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
// Cache invalidation
// ============================================================================

/**
 * Invalidate all cached API responses.
 * Called after database transactions are flushed.
 */
export function invalidateCache(): void {
  const cache = caches.default;
  const baseUrl = getBaseUrl();
  const deletePromises = CACHED_ENDPOINTS.map((endpoint) =>
    cache.delete(`${baseUrl}${endpoint}`, { ignoreSearch: true } as CacheQueryOptions)
  );
  waitUntil(Promise.all(deletePromises));
}
