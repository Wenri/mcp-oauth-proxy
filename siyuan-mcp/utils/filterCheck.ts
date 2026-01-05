/**
 * Filter check utilities
 */

import { getBlockDBItem, getDocDBitem, checkIdValid } from '../syapi/custom';
import { getConfig } from '..';
import { logPush } from '../logger';

/**
 * Validate block/doc access: checks ID format, existence, and filter settings.
 * Throws on error, returns { dbItem } on success.
 */
export async function validateBlockAccess(
  id: string,
  opts?: { requireDoc?: boolean }
): Promise<{ dbItem: any }> {
  try {
    checkIdValid(id);
  } catch {
    throw new Error('Invalid ID format.');
  }

  const dbItem = opts?.requireDoc
    ? await getDocDBitem(id)
    : await getBlockDBItem(id);

  if (dbItem == null) {
    const type = opts?.requireDoc ? 'document' : 'block';
    throw new Error(`Invalid ${type} ID. Please check if the ID exists.`);
  }

  if (await filterBlock(id, dbItem)) {
    throw new Error('The specified block is excluded by user settings.');
  }

  return { dbItem };
}

function getFilterSettings() {
  const config = getConfig();
  return {
    filterNotebooks: config.filterNotebooks || '',
    filterDocuments: config.filterDocuments || '',
  };
}

export async function filterBlock(blockId: string, dbItem: any | null): Promise<boolean> {
  const settings = getFilterSettings();
  const filterNotebooks = settings.filterNotebooks
    .split('\n')
    .map((id: string) => id.trim())
    .filter((id: string) => id);
  const filterDocuments = settings.filterDocuments
    .split('\n')
    .map((id: string) => id.trim())
    .filter((id: string) => id);

  if (!dbItem) {
    dbItem = await getBlockDBItem(blockId);
  }
  logPush('Checking filter for', dbItem?.id);

  if (dbItem) {
    const notebookId = dbItem.box;
    const path = dbItem.path;

    if (filterNotebooks && filterNotebooks.includes(notebookId)) {
      return true;
    }
    if (filterDocuments) {
      for (const docId of filterDocuments) {
        if (notebookId === docId || path.includes(docId) || dbItem.id === docId) {
          return true;
        }
      }
    }
  }
  return false;
}

export function filterNotebook(notebookId: string): boolean {
  const settings = getFilterSettings();
  const filterNotebooks = settings.filterNotebooks
    .split('\n')
    .map((id: string) => id.trim())
    .filter((id: string) => id);

  logPush('Checking notebook filter', filterNotebooks);
  if (filterNotebooks && filterNotebooks.includes(notebookId)) {
    return true;
  }
  return false;
}
