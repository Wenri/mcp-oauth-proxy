/**
 * Block and notebook filter utilities
 * Canonical source - resultFilter.ts re-exports these functions.
 */

import { getBlockDBItem } from '../syapi/custom';
import { getConfig } from '../server';
import { logPush } from '../logger';

/** Parse newline-separated filter IDs */
export function parseFilterIds(filterString: string): string[] {
  return filterString
    .split('\n')
    .map((id: string) => id.trim())
    .filter((id: string) => id);
}

export function getFilterSettings() {
  const config = getConfig();
  return {
    filterNotebooks: config.filterNotebooks || '',
    filterDocuments: config.filterDocuments || '',
  };
}

export async function filterBlock(blockId: BlockId, dbItem: Block | null): Promise<boolean> {
  const settings = getFilterSettings();
  const filterNotebooks = parseFilterIds(settings.filterNotebooks);
  const filterDocuments = parseFilterIds(settings.filterDocuments);

  if (!dbItem) {
    dbItem = await getBlockDBItem(blockId);
  }
  logPush('Checking filter for', dbItem?.id);

  if (dbItem) {
    const notebookId = dbItem.box;
    const path = dbItem.path;

    if (filterNotebooks.length && filterNotebooks.includes(notebookId)) {
      return true;
    }
    if (filterDocuments.length) {
      for (const docId of filterDocuments) {
        if (notebookId === docId || path.includes(docId) || dbItem.id === docId) {
          return true;
        }
      }
    }
  }
  return false;
}

export function filterNotebook(notebookId: NotebookId): boolean {
  const settings = getFilterSettings();
  const filterNotebooks = parseFilterIds(settings.filterNotebooks);

  logPush('Checking notebook filter', filterNotebooks);
  if (filterNotebooks.length && filterNotebooks.includes(notebookId)) {
    return true;
  }
  return false;
}
