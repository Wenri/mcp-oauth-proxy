/**
 * SiYuan Kernel API wrapper
 */

import { warnPush, errorPush } from '../logger';

// ============================================================================
// Kernel connection state
// ============================================================================

let baseUrl: string = '';
let authToken: string | undefined;
let cfServiceClientId: string | undefined;
let cfServiceClientSecret: string | undefined;

/**
 * Initialize kernel connection
 * @param url - Kernel base URL
 * @param token - SiYuan API token
 * @param serviceClientId - CF Access Service Token client ID
 * @param serviceClientSecret - CF Access Service Token client secret
 */
export function initKernel(
  url: string,
  token?: string,
  serviceClientId?: string,
  serviceClientSecret?: string
): void {
  baseUrl = url.replace(/\/$/, '');
  authToken = token;
  cfServiceClientId = serviceClientId;
  cfServiceClientSecret = serviceClientSecret;
}

/**
 * Build auth headers for SiYuan kernel requests.
 */
export function buildKernelHeaders(
  token?: string,
  serviceClientId?: string,
  serviceClientSecret?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  if (serviceClientId && serviceClientSecret) {
    headers['CF-Access-Client-Id'] = serviceClientId;
    headers['CF-Access-Client-Secret'] = serviceClientSecret;
  }
  return headers;
}

/**
 * Fetch from SiYuan kernel with authentication.
 */
export async function kernelFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!baseUrl && !url.startsWith('http')) {
    throw new Error('Kernel not initialized. Call initKernel first.');
  }
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const headers = buildKernelHeaders(authToken, cfServiceClientId, cfServiceClientSecret);
  return fetch(fullUrl, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  });
}

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
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }
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
    warnPush('listDocsByPath error:', response.msg);
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

/** Batch set block attributes */
export async function batchSetBlockAttrs(blockAttrs: string): Promise<any> {
  const url = '/api/attr/batchSetBlockAttrs';
  const response = await postRequest({ blockAttrs }, url);
  if (response.code === 0 && response.data != null) {
    return response.data;
  }
  return null;
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
      warnPush('Update block failed:', response.msg);
      return null;
    }
  } catch (err) {
    errorPush(err);
    warnPush(response.msg);
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
      warnPush('Insert block failed:', response.msg);
      return null;
    }
  } catch (err) {
    errorPush(err);
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
    errorPush(err);
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
    errorPush(err);
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
  warnPush('Delete block failed:', response);
  return false;
}

/** Move block to new position */
export async function moveBlockAPI(
  id: string,
  parentID?: string,
  previousID?: string
): Promise<boolean> {
  const url = '/api/block/moveBlock';
  const response = await postRequest({ id, parentID, previousID }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Move block failed:', response);
  return false;
}

/** Fold block */
export async function foldBlockAPI(id: string): Promise<boolean> {
  const url = '/api/block/foldBlock';
  const response = await postRequest({ id }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Fold block failed:', response);
  return false;
}

/** Unfold block */
export async function unfoldBlockAPI(id: string): Promise<boolean> {
  const url = '/api/block/unfoldBlock';
  const response = await postRequest({ id }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Unfold block failed:', response);
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

/** Get document content (HTML/DOM) */
export async function getDoc(blockid: string, size: number = 5, mode: number = 0): Promise<any> {
  const url = '/api/filetree/getDoc';
  const response = await postRequest({ id: blockid, mode, size }, url);
  if (response.code === 0 && response.data != null) {
    return response.data;
  }
  return undefined;
}

/** Get document outline */
export async function getDocOutlineAPI(docid: string): Promise<any[] | null> {
  const url = '/api/outline/getDocOutline';
  const response = await postRequest({ id: docid }, url);
  if (response.code === 0) {
    return response.data;
  }
  return null;
}

/** Get document preview (exported HTML) */
export async function getDocPreview(docid: string): Promise<string> {
  const url = '/api/export/preview';
  const response = await postRequest({ id: docid }, url);
  if (response.code === 0 && response.data != null) {
    return response.data.html;
  }
  return '';
}

/** Push notification message to SiYuan UI */
export async function pushMsgAPI(msgText: string, timeout: number = 7000): Promise<number> {
  const url = '/api/notification/pushMsg';
  const response = await postRequest({ msg: msgText, timeout }, url);
  if (response.code !== 0 || response.data == null || !response.data.id) {
    return -1;
  }
  return 0;
}

/** Reindex document tree */
export async function reindexDoc(docpath: string): Promise<number> {
  const url = '/api/filetree/reindexTree';
  await postRequest({ path: docpath }, url);
  return 0;
}

/** Flush pending database transactions */
export async function flushTransaction(): Promise<number> {
  const url = '/api/sqlite/flushTransaction';
  const response = await postRequest({}, url);
  if (response.code === 0) {
    return 0;
  }
  return -1;
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

/** Rename document */
export async function renameDocAPI(
  notebook: string,
  path: string,
  title: string
): Promise<boolean> {
  const url = '/api/filetree/renameDoc';
  const response = await postRequest({ notebook, path, title }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Rename doc failed:', response);
  return false;
}

/** Remove document */
export async function removeDocAPI(
  notebook: string,
  path: string
): Promise<boolean> {
  const url = '/api/filetree/removeDoc';
  const response = await postRequest({ notebook, path }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Remove doc failed:', response);
  return false;
}

/** Move documents to new location */
export async function moveDocsAPI(
  fromPaths: string[],
  toNotebook: string,
  toPath: string
): Promise<boolean> {
  const url = '/api/filetree/moveDocs';
  const response = await postRequest({ fromPaths, toNotebook, toPath }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Move docs failed:', response);
  return false;
}

/** Get human-readable path by ID */
export async function getHPathByIDAPI(id: string): Promise<string | null> {
  const url = '/api/filetree/getHPathByID';
  const response = await postRequest({ id }, url);
  if (response.code === 0 && response.data) {
    return response.data;
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
  warnPush('Add flashcard error:', response);
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
  warnPush('Remove flashcard error:', response);
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
  errorPush('createDocWithPath error:', response);
  throw new Error(response.msg);
}

/** Response type for getFileAPIv2 */
export type FileAPIResult = { response: Response; contentType: string } | null;

/** Check if MIME type indicates text content */
export function isTextMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  const baseType = mimeType.split(';')[0].trim().toLowerCase();
  if (baseType.startsWith('text/')) return true;
  const textTypes = [
    'application/json', 'application/xml', 'application/javascript',
    'application/x-javascript', 'application/ecmascript', 'application/xhtml+xml',
    'application/ld+json', 'application/manifest+json', 'application/sql',
    'application/graphql', 'application/x-sh', 'application/x-yaml',
  ];
  return textTypes.includes(baseType);
}

/** Check if file extension indicates text content */
export function isTextExtension(path: string): boolean {
  const textExtensions = [
    'txt', 'md', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
    'sql', 'graphql', 'vue', 'svelte', 'astro', 'php', 'pl', 'lua',
    'r', 'R', 'scala', 'kt', 'swift', 'dart', 'elm', 'clj', 'ex', 'exs',
    'sy', 'csv', 'log', 'env', 'gitignore', 'dockerignore', 'editorconfig',
  ];
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return textExtensions.includes(ext);
}

/** Get file from workspace - returns Response directly for efficient streaming */
export async function getFileAPIv2(path: string): Promise<FileAPIResult> {
  const url = '/api/file/getFile';

  const response = await kernelFetch(url, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }

  const contentType = response.headers.get('Content-Type') || '';

  // Check for JSON error response (404)
  if (contentType.includes('application/json')) {
    const cloned = response.clone();
    const json = (await cloned.json()) as { code?: number };
    if (json.code === 404) {
      return null;
    }
  }

  return { response, contentType };
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
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }
  return response.json();
}

/** Remove file from workspace */
export async function removeFileAPI(path: string): Promise<boolean> {
  const url = '/api/file/removeFile';
  const response = await postRequest({ path }, url);
  return response.code === 0;
}

/** Rename file in workspace */
export async function renameFileAPI(path: string, newPath: string): Promise<boolean> {
  const url = '/api/file/renameFile';
  const response = await postRequest({ path, newPath }, url);
  return response.code === 0;
}

/** Read directory contents */
export async function readDirAPI(path: string): Promise<any[] | null> {
  const url = '/api/file/readDir';
  const response = await postRequest({ path }, url);
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return null;
}

/** Put file to workspace (general purpose) */
export async function putFileAPI(
  path: string,
  file: Blob | string,
  isDir: boolean = false
): Promise<boolean> {
  const url = '/api/file/putFile';
  const pathParts = path.split('/');
  const fileName = pathParts[pathParts.length - 1];

  const fileBlob = typeof file === 'string'
    ? new Blob([file], { type: 'text/plain' })
    : file;

  const formData = new FormData();
  formData.append('path', path);
  formData.append('isDir', isDir.toString());
  formData.append('modTime', Date.now().toString());
  formData.append('file', fileBlob, fileName);

  const response = await kernelFetch(url, {
    method: 'POST',
    body: formData,
    headers: {},
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }
  const result = await response.json() as { code: number };
  return result.code === 0;
}

/** Upload assets (images, files) to SiYuan */
export async function uploadAPI(
  assetsDirPath: string,
  files: { name: string; data: Blob }[]
): Promise<{ succMap: Record<string, string>; errFiles: string[] } | null> {
  const url = '/api/asset/upload';

  const formData = new FormData();
  formData.append('assetsDirPath', assetsDirPath);

  for (const file of files) {
    formData.append('file[]', file.data, file.name);
  }

  const response = await kernelFetch(url, {
    method: 'POST',
    body: formData,
    headers: {},
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }
  const result = await response.json() as {
    code: number;
    data?: { succMap: Record<string, string>; errFiles: string[] };
  };

  if (result.code === 0 && result.data) {
    return result.data;
  }
  warnPush('Upload failed:', result);
  return null;
}

/** Export resources (files/folders) as zip */
export async function exportResourcesAPI(paths: string[], name?: string): Promise<{ path: string } | null> {
  const url = '/api/export/exportResources';
  const response = await postRequest({ paths, name }, url);
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return null;
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
