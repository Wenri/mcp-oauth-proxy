/**
 * Common validation utilities
 */

import { getConfig, hasContext } from '../context';

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
  if (!isValidStr(id)) return false;

  if (hasContext()) {
    const config = getConfig();
    const notebooks = config.notebooks;
    if (notebooks && Array.isArray(notebooks)) {
      return notebooks.some((nb: any) => nb.id === id);
    }
  }

  // Notebook ID format: typically 20-char alphanumeric
  return /^[a-zA-Z0-9\-]+$/.test(id) && id.length >= 14;
}

export function isMobile(): boolean {
  // CF Worker is never mobile
  return false;
}

export function isMacOs(): boolean {
  if (hasContext()) {
    const config = getConfig();
    const os = config.system?.os?.toUpperCase() || '';
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
  if (!hasContext()) return false;

  const config = getConfig();
  const currentVersion = config.system?.kernelVersion || '0.0.0';

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
