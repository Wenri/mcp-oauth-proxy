/**
 * Common validation utilities
 */

import { isEmpty } from 'lodash-es';
import { getConfig } from '../server';
import { getNotebookInfo } from '../syapi';
import { isValidIdFormat } from '../syapi/custom';

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

/** Check if a string is a valid notebook ID by querying the kernel */
export async function isValidNotebookId(id: string): Promise<boolean> {
  if (!isValidStr(id)) return false;
  if (!isValidIdFormat(id)) return false;

  const notebook = await getNotebookInfo(id);
  return notebook !== null;
}

export function isMobile(): boolean {
  // CF Worker is never mobile
  return false;
}

export function isMacOs(): boolean {
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

export function isEventCtrlKey(event: { ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (isMacOs()) {
    return !!event.metaKey;
  }
  return !!event.ctrlKey;
}

export function isSelectQuery(sql: string): boolean {
  return sql.trim().toUpperCase().startsWith('SELECT');
}

/** Block types that cannot contain other blocks */
const NON_PARENT_BLOCK_TYPES = [
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
] as const;

/** Check if block type cannot be a parent (cannot contain children) */
export function isNonParentBlockType(type: string): boolean {
  return (NON_PARENT_BLOCK_TYPES as readonly string[]).includes(type);
}

/** Check if block type is not a container (non-parent + heading) */
export function isNonContainerBlockType(type: string): boolean {
  return isNonParentBlockType(type) || type === 'h';
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

// ============================================================================
// Assertion & Validation Utilities
// ============================================================================

/**
 * Assert that an API result is not null/undefined, throwing if it is.
 * Use this to reduce repetitive null checking after API calls.
 *
 * @param result - The API result to check
 * @param operation - Description of the operation (for error message)
 * @returns The result, guaranteed to be non-null
 * @throws Error if result is null or undefined
 *
 * @example
 * const result = assertApiResult(await appendBlockAPI(data, parentID), 'append block');
 */
export function assertApiResult<T>(result: T | null | undefined, operation: string): T {
  if (result == null) {
    throw new Error(`Failed to ${operation}.`);
  }
  return result;
}

/**
 * Assert that an array is not empty, throwing if it is.
 * Uses lodash's isEmpty for the check.
 *
 * @param arr - The array to check
 * @param itemType - Description of the item type (for error message)
 * @returns The array, guaranteed to be non-empty
 * @throws Error if array is empty or falsy
 */
export function assertNonEmptyArray<T>(arr: T[] | null | undefined, itemType: string): T[] {
  if (isEmpty(arr)) {
    throw new Error(`At least one ${itemType} is required.`);
  }
  return arr as T[];
}

/**
 * Extract the document ID from a block database item.
 * For document blocks, returns the block's own ID.
 * For other blocks, returns the root_id (parent document).
 *
 * @param dbItem - Block database item
 * @returns Document ID
 * @throws Error if document ID cannot be determined
 */
export function extractDocumentId(dbItem: Block): DocumentId {
  const docId = dbItem.type === 'd' ? dbItem.id : dbItem.root_id;
  if (!docId) {
    throw new Error('Could not determine the document ID.');
  }
  return docId;
}
