/**
 * Unified content resolver for file uploads
 * Handles content conversion (text, base64, hex, json) and URL fetching
 */

import isPlainObject from 'lodash-es/isPlainObject';
import isArray from 'lodash-es/isArray';

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size for URL fetch: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Fetch timeout: 30 seconds (aligned with CF Workers limits) */
const FETCH_TIMEOUT_MS = 30_000;

/** Export configuration constants for reference */
export const CONTENT_RESOLVER_CONFIG = {
  MAX_FILE_SIZE,
  FETCH_TIMEOUT_MS,
} as const;

// ============================================================================
// Types
// ============================================================================

/** Supported content types */
export type ContentType = 'text' | 'base64' | 'hex' | 'json' | 'url';

/** Result of content resolution */
export interface ResolvedContent {
  blob: Blob;         // Contains data + mimeType (access via blob.type)
  fileName?: string;  // For URL type, auto-detected filename
  size?: number;      // Actual size in bytes
  remote?: boolean;   // True if fetched from URL (for LLM preview)
}

/** Options for content resolution */
export interface ResolveOptions {
  /** File name (used for MIME type detection) */
  fileName?: string;
  /** Default type if not specified and can't be inferred */
  defaultType?: ContentType;
}

/** URL fetch error codes */
export type UrlFetchErrorCode = 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK' | 'INVALID_URL' | 'HTTP_ERROR';

/** Error class for URL fetch failures */
export class UrlFetchError extends Error {
  constructor(
    message: string,
    public readonly code: UrlFetchErrorCode,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'UrlFetchError';
  }
}

// ============================================================================
// MIME Type Mappings
// ============================================================================

/** Extension to MIME type mapping */
const EXT_TO_MIME: Record<string, string> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text/Config
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'text/typescript',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  ini: 'text/plain',
  cfg: 'text/plain',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  // Archives
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

/** MIME type to extension mapping (for URL fetch fallback filename) */
const MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_TO_MIME).map(([ext, mime]) => [mime, ext])
);

/**
 * Get MIME type from file name
 */
export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
  const baseMime = mimeType.split(';')[0].trim();
  return MIME_TO_EXT[baseMime] || 'bin';
}

// ============================================================================
// Binary Decoders
// ============================================================================

/**
 * Decode hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  // Remove optional 0x prefix and whitespace
  const cleaned = hex.replace(/^0x/i, '').replace(/\s/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error('Invalid hex string: contains non-hex characters');
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Decode base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  // Handle data URL format
  const data = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// URL Fetch
// ============================================================================

/**
 * Extract filename from URL or Content-Disposition header
 */
function extractFileName(url: string, headers: Headers): string | null {
  // Try Content-Disposition header first (RFC 6266)
  const contentDisposition = headers.get('Content-Disposition');
  if (contentDisposition) {
    // Match filename*= (RFC 5987 encoded) or filename= (quoted or unquoted)
    const filenameMatch = contentDisposition.match(
      /filename\*?=['"]?(?:UTF-8'')?([^;\s"']+)['"]?/i
    );
    if (filenameMatch) {
      try {
        return decodeURIComponent(filenameMatch[1]);
      } catch {
        return filenameMatch[1];
      }
    }
  }

  // Fall back to URL path
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments.pop();
    if (lastSegment && lastSegment.includes('.')) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // Invalid URL - handled elsewhere
  }

  return null;
}

/**
 * Fetch file from URL with size limit and timeout
 *
 * @param url - URL to fetch from (http/https only)
 * @param providedFileName - Optional filename override
 * @returns ResolvedContent with blob, filename, mimeType, and size
 * @throws UrlFetchError on failure
 */
async function fetchFromUrl(
  url: string,
  providedFileName?: string
): Promise<ResolvedContent> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new UrlFetchError(`Invalid URL: ${url}`, 'INVALID_URL');
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new UrlFetchError(
      `Unsupported protocol: ${parsedUrl.protocol}. Only http/https allowed.`,
      'INVALID_URL'
    );
  }

  // Fetch with timeout
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'SiYuan-MCP/1.0',
        'Accept': '*/*',
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new UrlFetchError(
          `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
          'TIMEOUT'
        );
      }
      throw new UrlFetchError(`Network error: ${error.message}`, 'NETWORK');
    }
    throw new UrlFetchError('Unknown network error', 'NETWORK');
  }

  if (!response.ok) {
    throw new UrlFetchError(
      `HTTP ${response.status}: ${response.statusText}`,
      'HTTP_ERROR',
      response.status
    );
  }

  // Check Content-Length if available (early rejection for large files)
  const contentLength = response.headers.get('Content-Length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > MAX_FILE_SIZE) {
      throw new UrlFetchError(
        `File too large: ${(size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        'TOO_LARGE'
      );
    }
  }

  // Read response body with streaming size check
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const reader = response.body?.getReader();

  if (!reader) {
    throw new UrlFetchError('Response body is empty', 'NETWORK');
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > MAX_FILE_SIZE) {
        throw new UrlFetchError(
          `File too large: exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
          'TOO_LARGE'
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Combine chunks into single array
  const data = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }

  // Determine MIME type from response headers
  const mimeType = response.headers.get('Content-Type')?.split(';')[0].trim()
    || 'application/octet-stream';

  // Determine filename (priority: provided > header > URL > generated)
  let fileName = providedFileName || extractFileName(url, response.headers);
  if (!fileName) {
    const ext = getExtensionFromMime(mimeType);
    fileName = `download-${Date.now()}.${ext}`;
  }

  // Create blob with detected MIME type
  const blob = new Blob([data], { type: mimeType });

  return {
    blob,
    fileName,
    size: totalSize,
    remote: true,
  };
}

// ============================================================================
// Content Resolution
// ============================================================================

/**
 * Infer content type from content value
 */
export function inferContentType(
  content: string | object,
  defaultType: ContentType = 'text'
): ContentType {
  if (isPlainObject(content) || isArray(content)) {
    return 'json';
  }
  return defaultType;
}

/**
 * Resolve content to a binary blob
 *
 * @param content - The content to resolve (string or object)
 * @param type - Content type (text, base64, hex, json, url)
 * @param options - Resolution options
 * @returns Resolved content with blob and MIME type
 *
 * @example
 * // Text content
 * resolveContent("Hello, World!", 'text', { fileName: 'hello.txt' })
 *
 * // Base64 binary
 * resolveContent("iVBORw0KGgo...", 'base64', { fileName: 'image.png' })
 *
 * // Hex binary
 * resolveContent("89504e470d0a1a0a", 'hex', { fileName: 'image.png' })
 *
 * // JSON object (auto-serialized)
 * resolveContent({ key: "value" }, 'json', { fileName: 'config.json' })
 *
 * // URL fetch
 * resolveContent("https://example.com/file.pdf", 'url')
 */
export async function resolveContent(
  content: string | object,
  type: ContentType,
  options: ResolveOptions = {}
): Promise<ResolvedContent> {
  const { fileName } = options;

  switch (type) {
    case 'url': {
      if (typeof content !== 'string') {
        throw new Error('URL content must be a string');
      }
      return fetchFromUrl(content, fileName);
    }

    case 'hex': {
      if (typeof content !== 'string') {
        throw new Error('Hex content must be a string');
      }
      const hexMime = fileName ? getMimeType(fileName) : 'application/octet-stream';
      return { blob: new Blob([hexToBytes(content)], { type: hexMime }) };
    }

    case 'base64': {
      if (typeof content !== 'string') {
        throw new Error('Base64 content must be a string');
      }
      const b64Mime = fileName ? getMimeType(fileName) : 'application/octet-stream';
      return { blob: new Blob([base64ToBytes(content)], { type: b64Mime }) };
    }

    case 'json': {
      const jsonString = typeof content === 'string'
        ? content
        : JSON.stringify(content, null, 2);
      return { blob: new Blob([jsonString], { type: 'application/json' }) };
    }

    case 'text':
    default: {
      if (typeof content !== 'string') {
        throw new Error('Text content must be a string');
      }
      const textMime = fileName ? getMimeType(fileName) : 'text/plain';
      return { blob: new Blob([content], { type: textMime }) };
    }
  }
}

/**
 * Convenience function that auto-infers type
 */
export async function resolveContentAuto(
  content: string | object,
  type: ContentType | undefined,
  options: ResolveOptions = {}
): Promise<ResolvedContent> {
  const resolvedType = type ?? inferContentType(content, options.defaultType);
  return resolveContent(content, resolvedType, options);
}
