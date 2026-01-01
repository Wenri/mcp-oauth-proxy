/**
 * Filter check utilities
 */

import { getBlockDBItem } from '../syapi/custom';
import { getConfig } from '..';
import { logPush } from '../logger';

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
