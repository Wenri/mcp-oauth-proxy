/**
 * URL fetch utility for file upload tools
 * Fetches files from URLs with size limits and timeout handling
 */

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Fetch timeout: 30 seconds (aligned with CF Workers limits) */
const FETCH_TIMEOUT_MS = 30_000;

export interface FetchResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  size: number;
}

export type UrlFetchErrorCode = 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK' | 'INVALID_URL' | 'HTTP_ERROR';

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
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // Images
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/bmp': 'bmp',
    // Documents
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    // Text
    'application/json': 'json',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/markdown': 'md',
    'application/javascript': 'js',
    'application/xml': 'xml',
    // Audio
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    // Video
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    // Archives
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/gzip': 'gz',
  };
  return mimeToExt[mimeType.split(';')[0].trim()] || 'bin';
}

/**
 * Fetch file from URL with size limit and timeout
 *
 * @param url - URL to fetch from (http/https only)
 * @param providedFileName - Optional filename override
 * @returns FetchResult with blob, filename, mimeType, and size
 * @throws UrlFetchError on failure
 */
export async function fetchFromUrl(
  url: string,
  providedFileName?: string
): Promise<FetchResult> {
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
    mimeType,
    size: totalSize,
  };
}

/** Export configuration constants for reference */
export const URL_FETCH_CONFIG = {
  MAX_FILE_SIZE,
  FETCH_TIMEOUT_MS,
} as const;
