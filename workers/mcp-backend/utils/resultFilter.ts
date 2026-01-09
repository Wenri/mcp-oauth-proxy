/**
 * Result and block filtering utilities
 */

import { isValidStr } from './commonCheck';
import { getBlockDBItem, getDocDBitem, resolveIdOrHPath, isValidIdFormat } from '../syapi/custom';
import { getConfig } from '../server';
import { logPush } from '../logger';

// ============================================================================
// Block/Document Filter Utilities
// ============================================================================

/** Parse newline-separated filter IDs */
function parseFilterIds(filterString: string): string[] {
  return filterString
    .split('\n')
    .map((id: string) => id.trim())
    .filter((id: string) => id);
}

function getFilterSettings() {
  const config = getConfig();
  return {
    filterNotebooks: config.filterNotebooks || '',
    filterDocuments: config.filterDocuments || '',
  };
}

/**
 * Validate block/doc access: checks ID format, existence, and filter settings.
 * Accepts both block IDs and human-readable paths (hpath).
 * Throws on error, returns dbItem on success.
 *
 * @param input - Block ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/Notebook/Doc")
 * @param requireDoc - If true, validates that the ID refers to a document
 * @returns The block database item
 */
export async function validateBlockAccess(
  input: string,
  requireDoc?: boolean
): Promise<Block> {
  // Try to resolve hpath to ID if needed
  let id: BlockId;
  if (isValidIdFormat(input)) {
    id = input;
  } else {
    const resolved = await resolveIdOrHPath(input);
    if (!resolved) {
      throw new Error(`Invalid ID or path: "${input}". Provide a valid block ID or hpath like "/NotebookName/Doc".`);
    }
    id = resolved;
  }

  const dbItem = requireDoc
    ? await getDocDBitem(id)
    : await getBlockDBItem(id);

  if (dbItem == null) {
    const type = requireDoc ? 'document' : 'block';
    throw new Error(`Invalid ${type} ID. Please check if the ID exists.`);
  }

  if (await filterBlock(id, dbItem)) {
    throw new Error('The specified block is excluded by user settings.');
  }

  return dbItem;
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

// ============================================================================
// Search Result Filtering
// ============================================================================

/**
 * Filter grouped search results
 */
export function filterGroupSearchBlocksResult(inputDataList: any[]) {
    if (inputDataList == null) {
        return [];
    }
    let result = inputDataList.map((item) => {
        let children = item['children']
            ? item.children.map((childItem: any) => getSearchResultString(childItem))
            : [];
        return {
            notebookId: item['box'],
            path: item['path'],
            docId: item['rootID'],
            docName: item['content'],
            hPath: item['hPath'],
            tag: item['tag'],
            memo: item['memo'],
            children: children,
        };
    });
    return result;
}

/**
 * Get search result string from block result
 */
export function getSearchResultString(inputData: any): string {
    if (!isValidStr(inputData['markdown'])) {
        return inputData['fcontent'] ?? '';
    }
    return inputData['markdown'];
}

export function filterSearchBlocksResult(inputDataList: any[]) {
    if (inputDataList == null) {
        return [];
    }
    return inputDataList.map((item) => {
        return {
            notebookId: item['box'],
            path: item['path'],
            docId: item['rootID'],
            blockId: item['id'],
            content: item['markdown'],
            docHumanPath: item['hPath'],
            tag: item['tag'],
            memo: item['memo'],
            alias: item['alias'],
        };
    });
}
