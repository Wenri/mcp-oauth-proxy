/**
 * Content type detection utilities
 * Shared helpers for MIME type handling across tools
 */

import mime from 'mime-types';
import { isTextMimeType, isTextExtension } from '../syapi';

/** Content type categories */
export type ContentCategory = 'text' | 'image' | 'audio' | 'binary';

/** Check if MIME type is an image */
export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Check if MIME type is audio */
export function isAudioMime(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

/**
 * Determine content category from MIME type and path
 */
export function getContentCategory(mimeType: string, path: string): ContentCategory {
  if (isImageMime(mimeType)) return 'image';
  if (isAudioMime(mimeType)) return 'audio';
  if (isTextMimeType(mimeType) || isTextExtension(path)) return 'text';
  return 'binary';
}

/**
 * Get effective MIME type from response headers and file path.
 * Priority: response MIME (if not generic) > extension-based MIME > fallback
 */
export function getEffectiveMimeType(response: Response, path: string): string {
  const contentType = response.headers.get('Content-Type') || '';
  const responseMime = contentType.split(';')[0].trim().toLowerCase();

  // Trust response MIME if it's not generic
  if (responseMime && responseMime !== 'application/octet-stream') {
    return responseMime;
  }

  // Fall back to extension-based MIME using mime-types library
  const extMime = mime.lookup(path);
  if (extMime) {
    return extMime;
  }

  return 'application/octet-stream';
}
