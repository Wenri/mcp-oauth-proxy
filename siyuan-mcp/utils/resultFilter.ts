/**
 * Result and block filtering utilities
 */

import { isValidStr } from './commonCheck';
import { getBlockDBItem, getDocDBitem, checkIdValid } from '../syapi/custom';
import { getConfig } from '..';
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
 * Throws on error, returns dbItem on success.
 */
export async function validateBlockAccess(
  id: BlockId,
  requireDoc?: boolean
): Promise<Block> {
  try {
    checkIdValid(id);
  } catch {
    throw new Error('Invalid ID format.');
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

export function formatSearchResult(responseObj: any, requestObj: FullTextSearchQuery): string {
    const pageDesp = `This is page ${requestObj['page'] ?? '1'} of a paginated API response.
${responseObj['matchedRootCount']} documents and ${responseObj['matchedBlockCount']} content blocks matched the search, across ${responseObj['pageCount']} total pages.`;

    let data = null;
    const anyResult =
        responseObj['blocks'] == null || responseObj['blocks'].length == 0
            ? null
            : responseObj['blocks'][0];

    if (requestObj.groupBy == 1 || anyResult?.children) {
        data = filterGroupSearchBlocksResult(responseObj['blocks']);
    } else {
        data = filterSearchBlocksResult(responseObj['blocks']);
    }

    return `${pageDesp}
Search Result:
${JSON.stringify(data)}`;
}
