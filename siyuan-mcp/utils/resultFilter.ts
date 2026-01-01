/**
 * Result filtering utilities for search results
 * Unchanged from upstream - no browser dependencies
 */

import { isValidStr } from './commonCheck';

export interface BlockTypeFilter {
  audioBlock: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  databaseBlock: boolean;
  document: boolean;
  embedBlock: boolean;
  heading: boolean;
  htmlBlock: boolean;
  iframeBlock: boolean;
  list: boolean;
  listItem: boolean;
  mathBlock: boolean;
  paragraph: boolean;
  superBlock: boolean;
  table: boolean;
  videoBlock: boolean;
  widgetBlock: boolean;
}

export interface FullTextSearchQuery {
  query: string;
  method?: number;
  types?: BlockTypeFilter;
  paths?: string[];
  groupBy?: number;
  orderBy?: number;
  page?: number;
  reqId?: number;
  pageSize?: number;
}

/**
 * Filter grouped search results
 */
export function filterGroupSearchBlocksResult(inputDataList: any[]) {
  if (inputDataList == null) {
    return [];
  }
  const result = inputDataList.map((item) => {
    const children = item['children']
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
