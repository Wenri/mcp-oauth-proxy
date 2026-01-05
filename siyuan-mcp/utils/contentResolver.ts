/**
 * Unified content resolver for file uploads
 * Converts various content types to binary blobs
 */

import { fetchFromUrl } from './urlFetch';

/** Supported content types */
export type ContentType = 'text' | 'base64' | 'hex' | 'json' | 'url';

/** Result of content resolution */
export interface ResolvedContent {
  blob: Blob;
  mimeType: string;
  fileName?: string; // For URL type, auto-detected filename
}

/** Options for content resolution */
export interface ResolveOptions {
  /** File name (used for MIME type detection) */
  fileName?: string;
  /** Default type if not specified and can't be inferred */
  defaultType?: ContentType;
}

/**
 * MIME type detection from file extension
 */
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

/**
 * Get MIME type from file name
 */
export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

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

/**
 * Infer content type from content value
 */
export function inferContentType(
  content: string | object,
  defaultType: ContentType = 'text'
): ContentType {
  if (typeof content === 'object') {
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
      const result = await fetchFromUrl(content, fileName);
      return {
        blob: result.blob,
        mimeType: result.mimeType,
        fileName: result.fileName,
      };
    }

    case 'hex': {
      if (typeof content !== 'string') {
        throw new Error('Hex content must be a string');
      }
      const bytes = hexToBytes(content);
      const mimeType = fileName ? getMimeType(fileName) : 'application/octet-stream';
      return {
        blob: new Blob([bytes], { type: mimeType }),
        mimeType,
      };
    }

    case 'base64': {
      if (typeof content !== 'string') {
        throw new Error('Base64 content must be a string');
      }
      const bytes = base64ToBytes(content);
      const mimeType = fileName ? getMimeType(fileName) : 'application/octet-stream';
      return {
        blob: new Blob([bytes], { type: mimeType }),
        mimeType,
      };
    }

    case 'json': {
      const jsonString = typeof content === 'string'
        ? content
        : JSON.stringify(content, null, 2);
      return {
        blob: new Blob([jsonString], { type: 'application/json' }),
        mimeType: 'application/json',
      };
    }

    case 'text':
    default: {
      if (typeof content !== 'string') {
        throw new Error('Text content must be a string');
      }
      const mimeType = fileName ? getMimeType(fileName) : 'text/plain';
      return {
        blob: new Blob([content], { type: mimeType }),
        mimeType,
      };
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
