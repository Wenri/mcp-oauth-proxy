/**
 * Common validation utilities
 * Adapted from upstream to use platform abstraction
 */

import { getPlatformContext, hasPlatformContext } from '../platform';

export function isValidStr(s: any): boolean {
  if (s == undefined || s == null || s === '') {
    return false;
  }
  return true;
}

export function isBlankStr(s: any): boolean {
  if (!isValidStr(s)) return true;
  const clearBlankStr = s.replace(/\s+/g, '');
  return clearBlankStr === '';
}

export function isValidNotebookId(id: string): boolean {
  // In CF Worker, we check against config notebooks if available
  // Otherwise just validate string format
  if (!isValidStr(id)) return false;

  if (hasPlatformContext()) {
    const ctx = getPlatformContext();
    const notebooks = ctx.config.notebooks;
    if (notebooks && Array.isArray(notebooks)) {
      return notebooks.some((nb: any) => nb.id === id);
    }
  }

  // Notebook ID format: typically 20-char alphanumeric
  return /^[a-zA-Z0-9\-]+$/.test(id) && id.length >= 14;
}

export function isMobile(): boolean {
  // CF Worker is never mobile
  if (hasPlatformContext() && getPlatformContext().platform === 'cloudflare') {
    return false;
  }
  // Browser check
  if (typeof window !== 'undefined' && window.document) {
    return !!window.document.getElementById('sidebar');
  }
  return false;
}

export function isMacOs(): boolean {
  if (hasPlatformContext()) {
    const ctx = getPlatformContext();
    const os = ctx.config.system?.os?.toUpperCase() || '';
    return (
      os.includes('DARWIN') ||
      os.includes('MAC') ||
      os.includes('IPAD') ||
      os.includes('IPHONE') ||
      os.includes('IOS')
    );
  }
  return false;
}

export function isEventCtrlKey(event: { ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (isMacOs()) {
    return !!event.metaKey;
  }
  return !!event.ctrlKey;
}

export function isSelectQuery(sql: string): boolean {
  return sql.trim().toUpperCase().startsWith('SELECT');
}

export function isNonContainerBlockType(type: string): boolean {
  const nonContainerTypes = [
    'audio',
    'av',
    'c',
    'html',
    'iframe',
    'm',
    'p',
    't',
    'tb',
    'video',
    'widget',
    'h',
    'query_embed',
  ];
  return nonContainerTypes.includes(type);
}

export function isNonParentBlockType(type: string): boolean {
  const nonContainerTypes = [
    'audio',
    'av',
    'c',
    'html',
    'iframe',
    'm',
    'p',
    't',
    'tb',
    'video',
    'widget',
    'query_embed',
  ];
  return nonContainerTypes.includes(type);
}

/**
 * Parse version string into number array
 */
const parseVersion = (version: string): number[] => {
  if (!version || typeof version !== 'string') {
    return [];
  }
  return version
    .replace(/[^0-9.]/g, '')
    .split('.')
    .map(Number);
};

export function isCurrentVersionLessThan(version: string): boolean {
  if (!hasPlatformContext()) return false;

  const ctx = getPlatformContext();
  const currentVersion = ctx.config.system?.kernelVersion || '0.0.0';

  const parsedInputVersion = parseVersion(version);
  const parsedCurrentVersion = parseVersion(currentVersion);

  const len = Math.max(parsedCurrentVersion.length, parsedInputVersion.length);

  for (let i = 0; i < len; i++) {
    const currentPart = parsedCurrentVersion[i] || 0;
    const inputPart = parsedInputVersion[i] || 0;

    if (currentPart < inputPart) {
      return true;
    }
    if (currentPart > inputPart) {
      return false;
    }
  }
  return false;
}
