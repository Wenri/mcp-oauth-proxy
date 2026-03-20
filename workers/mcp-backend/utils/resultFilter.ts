/**
 * Result and block filtering utilities
 */

import { isValidStr } from './commonCheck';
import { getBlockDBItem, getDocDBitem, resolveIdOrHPath, isValidIdFormat } from '../syapi/custom';
import { logPush } from '../logger';
import { filterBlock } from './filterCheck';


// ============================================================================
// Block/Document Access Validation
// ============================================================================

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

  logPush('Block access validated for', id);
  return dbItem;
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
    const anyResult = responseObj['blocks'] == null || responseObj['blocks'].length == 0 ? null : responseObj['blocks'][0];
    if (requestObj.groupBy == 1 || anyResult?.children) {
        data = filterGroupSearchBlocksResult(responseObj['blocks']);
    } else {
        data = filterSearchBlocksResult(responseObj['blocks']);
    }
    return `${pageDesp}
Search Result:
${JSON.stringify(data)}`;
}
