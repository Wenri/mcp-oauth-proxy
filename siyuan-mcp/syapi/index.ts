/**
 * SiYuan Kernel API wrapper
 *
 * Uses kernelFetch from context for authenticated API calls.
 */

import { kernelFetch } from '..';

/**
 * Send POST request to SiYuan kernel API
 * @param data Request body
 * @param url API endpoint (e.g., /api/query/sql)
 */
export async function postRequest(data: any, url: string): Promise<any> {
  const response = await kernelFetch(url, {
    body: JSON.stringify(data),
    method: 'POST',
  });
  return response.json();
}

export async function getResponseData(promiseResponse: Promise<any>): Promise<any> {
  const response = await promiseResponse;
  if (response.code !== 0 || response.data == null) {
    return null;
  }
  return response.data;
}

export async function checkResponse(response: any): Promise<number> {
  if (response.code === 0) {
    return 0;
  }
  return -1;
}

/** SQL query API */
export async function queryAPI(sqlstmt: string): Promise<any[]> {
  const url = '/api/query/sql';
  const response = await postRequest({ stmt: sqlstmt }, url);
  if (response.code === 0 && response.data != null) {
    return response.data;
  }
  if (response.msg !== '') {
    throw new Error(`SQL ERROR: ${response.msg}`);
  }
  return [];
}

/** List documents by path */
export async function listDocsByPathT({
  notebook,
  path,
  maxListCount = undefined,
  sort = undefined,
  ignore = true,
  showHidden = null,
}: {
  notebook: string;
  path: string;
  maxListCount?: number;
  sort?: number;
  ignore?: boolean;
  showHidden?: boolean | null;
}): Promise<any[]> {
  const url = '/api/filetree/listDocsByPath';
  const body: any = { notebook, path };
  if (maxListCount !== undefined && maxListCount >= 0) {
    body.maxListCount = maxListCount;
  }
  if (sort !== undefined && sort !== DOC_SORT_TYPES.FOLLOW_DOC_TREE) {
    body.sort = sort;
  }
  if (ignore !== undefined) {
    body.ignoreMaxListHint = ignore;
  }
  if (showHidden !== null) {
    body.showHidden = showHidden;
  }
  const response = await postRequest(body, url);
  if (response.code !== 0 || response.data == null) {
    console.warn('listDocsByPath error:', response.msg);
    return [];
  }
  return response.data.files;
}

/** Get block attributes */
export async function getblockAttr(blockid: string): Promise<any> {
  const url = '/api/attr/getBlockAttrs';
  const response = await postRequest({ id: blockid }, url);
  if (response.code !== 0) {
    throw new Error('Failed to get block attributes');
  }
  return response.data;
}

/** Set block attributes */
export async function addblockAttrAPI(attrs: Record<string, string>, blockid: string): Promise<number> {
  const url = '/api/attr/setBlockAttrs';
  const result = await postRequest({ id: blockid, attrs }, url);
  return checkResponse(result);
}

/** Update block content */
export async function updateBlockAPI(
  text: string,
  blockid: string,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<any> {
  const url = '/api/block/updateBlock';
  const response = await postRequest({ dataType: textType, data: text, id: blockid }, url);
  try {
    if (response.code === 0 && response.data?.[0]?.doOperations?.[0]?.id) {
      return response.data[0].doOperations[0];
    }
    if (response.code === -1) {
      console.warn('Update block failed:', response.msg);
      return null;
    }
  } catch (err) {
    console.error(err);
    console.warn(response.msg);
  }
  return null;
}

/** Insert block */
export async function insertBlockAPI(
  text: string,
  blockid: string,
  addType: string = 'previousID',
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<any> {
  const url = '/api/block/insertBlock';
  const data: any = { dataType: textType, data: text };

  switch (addType) {
    case 'parentID':
    case 'PARENT':
    case 'parentId':
      data.parentID = blockid;
      break;
    case 'nextID':
    case 'NEXT':
    case 'nextId':
      data.nextID = blockid;
      break;
    default:
      data.previousID = blockid;
      break;
  }

  const response = await postRequest(data, url);
  try {
    if (response.code === 0 && response.data?.[0]?.doOperations?.[0]?.id) {
      return response.data[0].doOperations[0];
    }
    if (response.code === -1) {
      console.warn('Insert block failed:', response.msg);
      return null;
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

/** Insert block with full options */
export async function insertBlockOriginAPI({
  dataType,
  data,
  nextID,
  previousID,
  parentID,
}: {
  dataType: 'markdown' | 'dom';
  data: string;
  nextID?: string;
  previousID?: string;
  parentID?: string;
}): Promise<any> {
  const payload = { dataType, data, nextID, previousID, parentID };
  const response = await postRequest(payload, '/api/block/insertBlock');
  if (!response.data?.[0]?.doOperations?.[0]?.id) {
    throw new Error('Insert block failed: No operations returned');
  }
  return response.data;
}

/** Prepend block as first child */
export async function prependBlockAPI(
  text: string,
  parentId: string,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<any> {
  const url = '/api/block/prependBlock';
  const response = await postRequest({ dataType: textType, data: text, parentID: parentId }, url);
  try {
    if (response.code === 0 && response.data?.[0]?.doOperations?.[0]?.id) {
      return response.data[0].doOperations[0];
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

/** Append block as last child */
export async function appendBlockAPI(
  text: string,
  parentId: string,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<any> {
  const url = '/api/block/appendBlock';
  const response = await postRequest({ dataType: textType, data: text, parentID: parentId }, url);
  try {
    if (response.code === 0 && response.data?.[0]?.doOperations?.[0]?.id) {
      return response.data[0].doOperations[0];
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

/** Delete block */
export async function removeBlockAPI(blockid: string): Promise<boolean> {
  const url = '/api/block/deleteBlock';
  const response = await postRequest({ id: blockid }, url);
  if (response.code === 0) {
    return true;
  }
  console.warn('Delete block failed:', response);
  return false;
}

/** Get block Kramdown source */
export async function getKramdown(blockid: string, throwError = false): Promise<string | null> {
  const url = '/api/block/getBlockKramdown';
  const response = await postRequest({ id: blockid }, url);
  if (response.code === 0 && response.data?.kramdown) {
    return response.data.kramdown;
  }
  if (throwError) {
    throw new Error(`get kramdown failed: ${response.msg}`);
  }
  return null;
}

/** Get notebook list */
export async function getNodebookList(): Promise<any[]> {
  const url = '/api/notebook/lsNotebooks';
  const response = await postRequest({}, url);
  if (response.code === 0 && response.data?.notebooks) {
    return response.data.notebooks;
  }
  return [];
}

/** Get notebook config */
export async function getNotebookConf(notebookId: string): Promise<any> {
  const url = '/api/notebook/getNotebookConf';
  const response = await postRequest({ notebook: notebookId }, url);
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return null;
}

/** Get child blocks */
export async function getChildBlocks(id: string): Promise<any[]> {
  const url = '/api/block/getChildBlocks';
  const response = await postRequest({ id }, url);
  if (response.code === 0) {
    return response.data;
  }
  throw new Error(`getChildBlocks Failed: ${response.msg}`);
}

/** Export markdown content */
export async function exportMdContent({
  id,
  refMode,
  embedMode,
  yfm,
}: {
  id: string;
  refMode: number;
  embedMode: number;
  yfm: boolean;
}): Promise<any> {
  const url = '/api/export/exportMdContent';
  const response = await postRequest({ id, refMode, embedMode, yfm }, url);
  if (response.code === 0) {
    return response.data;
  }
  throw new Error(`exportMdContent Failed: ${response.msg}`);
}

/** Create daily note */
export async function createDailyNote(notebook: string, app: string): Promise<string> {
  const url = '/api/filetree/createDailyNote';
  const response = await postRequest({ app, notebook }, url);
  if (response.code === 0) {
    return response.data.id;
  }
  throw new Error(`Create Dailynote Failed: ${response.msg}`);
}

/** Full text search */
export async function fullTextSearchBlock({
  query,
  method = 0,
  paths = [],
  groupBy = 1,
  orderBy = 0,
  page = 1,
  types,
}: {
  query: string;
  method?: number;
  paths?: string[];
  groupBy?: number;
  orderBy?: number;
  page?: number;
  types?: any;
}): Promise<any> {
  const url = '/api/search/fullTextSearchBlock';
  const postBody = {
    query,
    method,
    page,
    paths,
    groupBy,
    orderBy,
    types,
    pageSize: 10,
    reqId: Date.now(),
  };
  const response = await postRequest(postBody, url);
  if (response.code === 0) {
    return response.data;
  }
  throw new Error(`fullTextSearchBlock Failed: ${response.msg}`);
}

/** Get backlinks */
export async function getBackLink2T(
  id: string,
  sort = '3',
  msort = '3',
  k = '',
  mk = ''
): Promise<any> {
  const url = '/api/ref/getBacklink2';
  return getResponseData(postRequest({ id, sort, msort, k, mk }, url));
}

/** List document tree */
export async function listDocTree(notebook: string, path: string): Promise<any> {
  const url = '/api/filetree/listDocTree';
  const response = await postRequest({ notebook, path }, url);
  if (response.code === 0) {
    return response.data.tree;
  }
  throw new Error(`listDocTree Failed: ${response.msg}`);
}

/** Create document with markdown */
export async function createDocWithMdAPI(
  notebookid: string,
  hpath: string,
  md: string
): Promise<string | null> {
  const url = '/api/filetree/createDocWithMd';
  const response = await postRequest({ notebook: notebookid, path: hpath, markdown: md }, url);
  if (response.code === 0 && response.data?.id) {
    return response.data.id;
  }
  return null;
}

/** Add flashcards */
export async function addRiffCards(
  ids: string[],
  deckId: string,
  oldCardsNum = -1
): Promise<number | null> {
  const url = '/api/riff/addRiffCards';
  const response = await postRequest({ deckID: deckId, blockIDs: ids }, url);
  if (response.code === 0 && response.data?.size !== undefined) {
    if (oldCardsNum < 0) {
      return response.data.size;
    }
    return response.data.size - oldCardsNum;
  }
  console.warn('Add flashcard error:', response);
  return null;
}

/** Remove flashcards */
export async function removeRiffCards(
  ids: string[],
  deckId: string,
  oldCardsNum = -1
): Promise<number | null> {
  const url = '/api/riff/removeRiffCards';
  const response = await postRequest({ deckID: deckId, blockIDs: ids }, url);
  if (response.code === 0 && response.data?.size !== undefined) {
    if (oldCardsNum < 0) {
      return response.data.size;
    }
    return oldCardsNum - response.data.size;
  }
  if (response.code === 0) {
    return ids.length;
  }
  console.warn('Remove flashcard error:', response);
  return null;
}

/** Get all decks */
export async function getRiffDecks(): Promise<any[]> {
  const url = '/api/riff/getRiffDecks';
  const response = await postRequest({}, url);
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return [];
}

/** Get document info */
export async function getDocInfo(id: string): Promise<any> {
  return getResponseData(postRequest({ id }, '/api/block/getDocInfo'));
}

/** Get tree statistics */
export async function getTreeStat(id: string): Promise<any> {
  return getResponseData(postRequest({ id }, '/api/block/getTreeStat'));
}

/** Create document with path */
export async function createDocWithPath(
  notebookid: string,
  path: string,
  title = 'Untitled',
  contentMd = '',
  listDocTree = false
): Promise<boolean> {
  const url = '/api/filetree/createDoc';
  const response = await postRequest(
    { notebook: notebookid, path, md: contentMd, title, listDocTree },
    url
  );
  if (response.code === 0) {
    return true;
  }
  console.error('createDocWithPath error:', response);
  throw new Error(response.msg);
}

/** Get file from workspace (returns blob for binary files) */
export async function getFileAPIv2(path: string): Promise<Blob | any | null> {
  const url = '/api/file/getFile';

  const response = await kernelFetch(url, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    const json = (await response.json()) as { code?: number; [key: string]: unknown };
    if (json.code === 404) {
      return null;
    }
    return json;
  } else {
    // Binary file - return as blob
    return response.blob();
  }
}

/** Get JSON file from workspace */
export async function getJSONFile(path: string): Promise<any> {
  const url = '/api/file/getFile';
  const response = await postRequest({ path }, url);
  if (response.code === 404) {
    return null;
  }
  return response;
}

/** Put JSON file to workspace */
export async function putJSONFile(path: string, object: any, format = false): Promise<any> {
  const url = '/api/file/putFile';
  const pathSplited = path.split('/');
  const fileContent = format ? JSON.stringify(object, null, 4) : JSON.stringify(object);
  const file = new Blob([fileContent], { type: 'text/plain' });

  const formData = new FormData();
  formData.append('path', path);
  formData.append('isDir', 'false');
  formData.append('modTime', Date.now().toString());
  formData.append('file', file, pathSplited[pathSplited.length - 1]);

  // Use kernelFetch with FormData (no Content-Type header - let browser set it)
  const response = await kernelFetch(url, {
    method: 'POST',
    body: formData,
    headers: {}, // Clear Content-Type to let FormData set boundary
  });
  return response.json();
}

/** Remove file from workspace */
export async function removeFileAPI(path: string): Promise<boolean> {
  const url = '/api/file/removeFile';
  const response = await postRequest({ path }, url);
  return response.code === 0;
}

// Document sort types
export const DOC_SORT_TYPES = {
  FILE_NAME_ASC: 0,
  FILE_NAME_DESC: 1,
  NAME_NAT_ASC: 4,
  NAME_NAT_DESC: 5,
  CREATED_TIME_ASC: 9,
  CREATED_TIME_DESC: 10,
  MODIFIED_TIME_ASC: 2,
  MODIFIED_TIME_DESC: 3,
  REF_COUNT_ASC: 7,
  REF_COUNT_DESC: 8,
  DOC_SIZE_ASC: 11,
  DOC_SIZE_DESC: 12,
  SUB_DOC_COUNT_ASC: 13,
  SUB_DOC_COUNT_DESC: 14,
  CUSTOM_SORT: 6,
  FOLLOW_DOC_TREE: 255,
  FOLLOW_DOC_TREE_ORI: 15,
  UNASSIGNED: 256,
};

// Default block type filter for search
export const DEFAULT_FILTER = {
  audioBlock: false,
  blockquote: false,
  codeBlock: true,
  databaseBlock: false,
  document: true,
  embedBlock: false,
  heading: true,
  htmlBlock: true,
  iframeBlock: false,
  list: false,
  listItem: false,
  mathBlock: true,
  paragraph: true,
  superBlock: false,
  table: true,
  videoBlock: false,
  widgetBlock: false,
};
