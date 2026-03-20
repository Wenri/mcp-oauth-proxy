/**
 * SiYuan Kernel API wrapper
 */

import { warnPush, errorPush } from '../logger';
import {
  getCacheKey,
  cacheResponse,
  cachedPostRequest,
  writePostRequest,
  invalidateCache,
  DEFAULT_FILE_CACHE_TTL,
  DEFAULT_API_CACHE_TTL,
} from './cache';
import { initKernel, buildKernelHeaders, kernelFetch, postRequest, getBaseUrl, getResponseData } from './http';

// Re-export cache utilities for backwards compatibility
export { getCacheKey, cacheResponse, cachedPostRequest, writePostRequest, DEFAULT_FILE_CACHE_TTL, DEFAULT_API_CACHE_TTL };

// Re-export HTTP utilities for backwards compatibility
export { initKernel, buildKernelHeaders, kernelFetch, postRequest, getResponseData };

/** SQL query API - returns array of Block or other row types */
export async function queryAPI(sqlstmt: string): Promise<Block[]> {
  const url = '/api/query/sql';
  const response = await postRequest({ stmt: sqlstmt }, url) as APIResponse<Block[]>;
  if (response.code === 0 && response.data != null) {
    return response.data;
  }
  if (response.msg !== '') {
    throw new Error(`SQL ERROR: ${response.msg}`);
  }
  return [];
}

/** List documents by path (cached) */
export async function listDocsByPathT({
  notebook,
  path,
  maxListCount = undefined,
  sort = undefined,
  ignore = true,
  showHidden = null,
}: {
  notebook: NotebookId;
  path: string;
  maxListCount?: number;
  sort?: number;
  ignore?: boolean;
  showHidden?: boolean | null;
}): Promise<IFile[]> {
  const url = '/api/filetree/listDocsByPath';
  const body: Record<string, string | number | boolean> = { notebook, path };
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
  const response = await cachedPostRequest(body, url);
  if (response.code !== 0 || response.data == null) {
    warnPush('listDocsByPath error:', response.msg);
    return [];
  }
  // Defensive handling - files may be undefined, null, or empty
  return response.data.files ?? [];
}

/** Get block attributes (cached) */
export async function getblockAttr(blockid: BlockId): Promise<BlockAttrs> {
  const url = '/api/attr/getBlockAttrs';
  const response = await cachedPostRequest({ id: blockid }, url) as APIResponse<BlockAttrs>;
  if (response.code !== 0) {
    throw new Error('Failed to get block attributes');
  }
  return response.data;
}

/** Set block attributes */
export async function addblockAttrAPI(attrs: BlockAttrs, blockid: BlockId): Promise<number> {
  const url = '/api/attr/setBlockAttrs';
  const result = await writePostRequest({ id: blockid, attrs }, url);
  return result.code === 0 ? 0 : -1;
}

/** Batch set block attributes */
export async function batchSetBlockAttrs(blockAttrs: { id: BlockId; attrs: BlockAttrs }[]): Promise<void> {
  const url = '/api/attr/batchSetBlockAttrs';
  const response = await writePostRequest({ blockAttrs }, url) as APIResponse<null> & { msg?: string };
  if (response.code !== 0) {
    throw new Error(response.msg || `Batch set attrs failed with code ${response.code}`);
  }
}

/** Update block content */
export async function updateBlockAPI(
  text: string,
  blockid: BlockId,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<BlockOperation | null> {
  const url = '/api/block/updateBlock';
  const response = await writePostRequest({ dataType: textType, data: text, id: blockid }, url);
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
  blockid: BlockId,
  addType: 'previousID' | 'nextID' | 'parentID' | 'PREVIOUS' | 'NEXT' | 'PARENT' | 'previousId' | 'nextId' | 'parentId' | 'insertAfter' | 'insertBefore' = 'previousID',
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<BlockOperation | null> {
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

  const response = await writePostRequest(data, url);
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
  nextID?: BlockId;
  previousID?: BlockId;
  parentID?: BlockId;
}): Promise<Transaction[]> {
  const payload = { dataType, data, nextID, previousID, parentID };
  const response = await writePostRequest(payload, '/api/block/insertBlock');
  if (!response.data?.[0]?.doOperations?.[0]?.id) {
    throw new Error('Insert block failed: No operations returned');
  }
  return response.data;
}

/** Prepend block as first child */
export async function prependBlockAPI(
  text: string,
  parentId: BlockId,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<BlockOperation | null> {
  const url = '/api/block/prependBlock';
  const response = await writePostRequest({ dataType: textType, data: text, parentID: parentId }, url);
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
  parentId: BlockId,
  textType: 'markdown' | 'dom' = 'markdown'
): Promise<BlockOperation | null> {
  const url = '/api/block/appendBlock';
  const response = await writePostRequest({ dataType: textType, data: text, parentID: parentId }, url);
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
export async function removeBlockAPI(blockid: BlockId): Promise<boolean> {
  const url = '/api/block/deleteBlock';
  const response = await writePostRequest({ id: blockid }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Delete block failed:', response);
  return false;
}

/** Move block to new position */
export async function moveBlockAPI(
  id: BlockId,
  parentID?: BlockId,
  previousID?: BlockId
): Promise<true> {
  const url = '/api/block/moveBlock';
  const response = await writePostRequest({ id, parentID, previousID }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Move block failed:', response);
  throw new Error(response.msg || 'Move block failed');
}

/** Fold block */
export async function foldBlockAPI(id: BlockId): Promise<true> {
  const url = '/api/block/foldBlock';
  const response = await writePostRequest({ id }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Fold block failed:', response);
  throw new Error(response.msg || 'Fold block failed');
}

/** Unfold block */
export async function unfoldBlockAPI(id: BlockId): Promise<true> {
  const url = '/api/block/unfoldBlock';
  const response = await writePostRequest({ id }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Unfold block failed:', response);
  throw new Error(response.msg || 'Unfold block failed');
}

/** Get block Kramdown source (cached for 60s) */
export async function getKramdown(blockid: BlockId, throwError = false): Promise<KramdownResult | null> {
  const url = '/api/block/getBlockKramdown';
  const response = await cachedPostRequest({ id: blockid }, url) as APIResponse<KramdownResult>;
  if (response.code === 0 && response.data) {
    return response.data;
  }
  if (throwError) {
    throw new Error(`get kramdown failed: ${response.msg}`);
  }
  return null;
}

/** Get notebook list (cached) */
export async function getNodebookList(): Promise<Notebook[]> {
  const url = '/api/notebook/lsNotebooks';
  const response = await cachedPostRequest({}, url) as APIResponse<{ notebooks: Notebook[] }>;
  if (response.code === 0 && response.data?.notebooks) {
    return response.data.notebooks;
  }
  return [];
}

/** Get notebook config (cached) */
export async function getNotebookConf(notebookId: NotebookId): Promise<NotebookConfResponse | null> {
  const url = '/api/notebook/getNotebookConf';
  const response = await cachedPostRequest({ notebook: notebookId }, url) as APIResponse<NotebookConfResponse>;
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return null;
}

/** Check if a notebook exists by ID (cached). Returns BoxInfo with stats. */
export async function getNotebookInfo(notebookId: string): Promise<BoxInfo | null> {
  const url = '/api/notebook/getNotebookInfo';
  const response = await cachedPostRequest({ notebook: notebookId }, url) as APIResponse<{ boxInfo: BoxInfo }>;
  if (response.code === 0 && response.data?.boxInfo) {
    return response.data.boxInfo;
  }
  return null;
}

/** Get child blocks (cached) */
export async function getChildBlocks(id: BlockId): Promise<ChildBlock[]> {
  const url = '/api/block/getChildBlocks';
  const response = await cachedPostRequest({ id }, url) as APIResponse<ChildBlock[]>;
  if (response.code === 0) {
    return response.data;
  }
  throw new Error(`getChildBlocks Failed: ${response.msg}`);
}

/** Get document content (HTML/DOM, cached) */
export async function getDoc(blockid: BlockId, size: number = 5, mode: number = 0): Promise<{ content: string; [key: string]: unknown } | undefined> {
  const url = '/api/filetree/getDoc';
  const response = await cachedPostRequest({ id: blockid, mode, size }, url);
  if (response.code === 0 && response.data != null) {
    return response.data;
  }
  return undefined;
}

/** Get document outline (cached) */
export async function getDocOutlineAPI(docid: DocumentId): Promise<OutlinePath[] | null> {
  const url = '/api/outline/getDocOutline';
  const response = await cachedPostRequest({ id: docid }, url) as APIResponse<OutlinePath[]>;
  if (response.code === 0) {
    return response.data;
  }
  return null;
}

/** Get document preview (exported HTML, cached for 60s) */
export async function getDocPreview(docid: DocumentId): Promise<string> {
  const url = '/api/export/preview';
  const response = await cachedPostRequest({ id: docid }, url) as APIResponse<{ html: string }>;
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
  const response = await writePostRequest({ path: docpath }, url) as { code: number };
  return response.code === 0 ? 0 : -1;
}

/** Flush pending database transactions and invalidate API cache */
export async function flushTransaction(): Promise<number> {
  const url = '/api/sqlite/flushTransaction';
  const response = await postRequest({}, url);
  if (response.code === 0) {
    invalidateCache();
    return 0;
  }
  return -1;
}

/** Export markdown content (cached for 60s) */
export async function exportMdContent({
  id,
  refMode,
  embedMode,
  yfm,
}: {
  id: DocumentId;
  refMode: number;
  embedMode: number;
  yfm: boolean;
}): Promise<ExportMdResult> {
  const url = '/api/export/exportMdContent';
  const response = await cachedPostRequest({ id, refMode, embedMode, yfm }, url) as APIResponse<ExportMdResult>;
  if (response.code === 0) {
    return response.data;
  }
  throw new Error(`exportMdContent Failed: ${response.msg}`);
}

/** Create daily note */
export async function createDailyNote(notebook: NotebookId, app: string): Promise<DocumentId> {
  const url = '/api/filetree/createDailyNote';
  const response = await writePostRequest({ app, notebook }, url) as APIResponse<{ id: DocumentId }>;
  if (response.code === 0) {
    return response.data.id;
  }
  throw new Error(`Create Dailynote Failed: ${response.msg}`);
}

/** Base params for full text search (used for cache key type safety) */
type FtsBaseParams = {
  query: string;
  method: number;
  page: number;
  paths: string[];
  groupBy: number;
  orderBy: number;
};

// Compile-time check: ensure BlockTypeFilter keys don't conflict with FtsBaseParams
// If there's overlap, this line will fail to compile
type _AssertNoOverlap<T = keyof BlockTypeFilter & keyof FtsBaseParams> = T extends never ? true : { error: 'Key conflict between BlockTypeFilter and FtsBaseParams'; keys: T };
declare const _: _AssertNoOverlap;

/** Full text search (cached) */
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
  types?: BlockTypeFilter;
}): Promise<FullTextSearchResult> {
  const url = '/api/search/fullTextSearchBlock';
  // Cache key excludes reqId (timestamp) since it changes every request
  // Expand types into cache params (no key conflicts - verified by _AssertNoOverlap)
  const cacheParams = { query, method, page, paths, groupBy, orderBy, ...types };
  const cacheKey = getCacheKey(url, cacheParams);

  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return cached.json();
  }

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
    cacheResponse(response.data, new Headers(), cacheKey, DEFAULT_API_CACHE_TTL);
    return response.data;
  }
  throw new Error(`fullTextSearchBlock Failed: ${response.msg}`);
}

/** Get backlinks (cached) */
export async function getBackLink2T(
  id: BlockId,
  sort = '3',
  msort = '3',
  k = '',
  mk = ''
): Promise<BacklinkResult> {
  const url = '/api/ref/getBacklink2';
  return getResponseData(cachedPostRequest({ id, sort, msort, k, mk }, url));
}

/** List document tree (cached) */
export async function listDocTree(notebook: NotebookId, path: string): Promise<DocTreeNode[]> {
  const url = '/api/filetree/listDocTree';
  const response = await cachedPostRequest({ notebook, path }, url) as APIResponse<{ tree: DocTreeNode[] }>;
  if (response.code === 0) {
    return response.data.tree;
  }
  throw new Error(`listDocTree Failed: ${response.msg}`);
}

/** Create document with markdown */
export async function createDocWithMdAPI(
  notebookid: NotebookId,
  hpath: string,
  md: string
): Promise<DocumentId | null> {
  const url = '/api/filetree/createDocWithMd';
  const response = await writePostRequest({ notebook: notebookid, path: hpath, markdown: md }, url) as APIResponse<{ id: DocumentId }>;
  if (response.code === 0 && response.data?.id) {
    return response.data.id;
  }
  return null;
}

/** Rename document */
export async function renameDocAPI(
  notebook: NotebookId,
  path: string,
  title: string
): Promise<boolean> {
  const url = '/api/filetree/renameDoc';
  const response = await writePostRequest({ notebook, path, title }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Rename doc failed:', response);
  return false;
}

/** Remove document */
export async function removeDocAPI(
  notebook: NotebookId,
  path: string
): Promise<boolean> {
  const url = '/api/filetree/removeDoc';
  const response = await writePostRequest({ notebook, path }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Remove doc failed:', response);
  return false;
}

/** Move documents to new location */
export async function moveDocsAPI(
  fromPaths: string[],
  toNotebook: NotebookId,
  toPath: string
): Promise<boolean> {
  const url = '/api/filetree/moveDocs';
  const response = await writePostRequest({ fromPaths, toNotebook, toPath }, url);
  if (response.code === 0) {
    return true;
  }
  warnPush('Move docs failed:', response);
  return false;
}

/** Get human-readable path by ID (cached) */
export async function getHPathByIDAPI(id: BlockId): Promise<string | null> {
  const url = '/api/filetree/getHPathByID';
  const response = await cachedPostRequest({ id }, url) as APIResponse<string>;
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return null;
}

/** Get document ID by human-readable path (cached) */
export async function getDocIDByHPath(notebook: NotebookId, hpath: string): Promise<DocumentId | null> {
  const url = '/api/filetree/getIDsByHPath';
  const response = await cachedPostRequest({ notebook, path: hpath }, url) as APIResponse<DocumentId[]>;
  if (response.code === 0 && response.data?.length > 0) {
    return response.data[0]; // Return first matching ID
  }
  return null;
}

/** Add flashcards */
export async function addRiffCards(
  ids: BlockId[],
  deckId: string,
  oldCardsNum = -1
): Promise<number | null> {
  const url = '/api/riff/addRiffCards';
  const response = await writePostRequest({ deckID: deckId, blockIDs: ids }, url) as APIResponse<{ size: number }>;
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
  ids: BlockId[],
  deckId: string,
  oldCardsNum = -1
): Promise<number | null> {
  const url = '/api/riff/removeRiffCards';
  const response = await writePostRequest({ deckID: deckId, blockIDs: ids }, url) as APIResponse<{ size: number }>;
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

/** Get all decks (cached) */
export async function getRiffDecks(): Promise<RiffDeck[]> {
  const url = '/api/riff/getRiffDecks';
  const response = await cachedPostRequest({}, url) as APIResponse<RiffDeck[]>;
  if (response.code === 0 && response.data) {
    return response.data;
  }
  return [];
}

/** Get document info (cached) */
export async function getDocInfo(id: DocumentId): Promise<DocInfo | null> {
  return getResponseData(cachedPostRequest({ id }, '/api/block/getDocInfo'));
}

/** Get tree statistics (cached) */
export async function getTreeStat(id: DocumentId): Promise<TreeStat> {
  return getResponseData(cachedPostRequest({ id }, '/api/block/getTreeStat'));
}

/** Create document with path */
export async function createDocWithPath(
  notebookid: NotebookId,
  path: string,
  title = 'Untitled',
  contentMd = '',
  listDocTree = false
): Promise<boolean> {
  const url = '/api/filetree/createDoc';
  const response = await writePostRequest(
    { notebook: notebookid, path, md: contentMd, title, listDocTree },
    url
  );
  if (response.code === 0) {
    return true;
  }
  errorPush('createDocWithPath error:', response);
  throw new Error(response.msg);
}

/** Read stream with size limit. Returns null if exceeded, Uint8Array if complete. */
export async function limitedRead(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

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

/** Normalize file path: ensure leading slash, collapse double slashes, remove trailing slash */
export function normalizePath(path: string): string {
  return ('/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

/** Get file from workspace - returns Response directly for efficient streaming */
export async function getFileAPIv2(path: string, cacheTtl = DEFAULT_FILE_CACHE_TTL): Promise<Response | null> {
  const normalizedPath = normalizePath(path);
  const cacheKey = `${getBaseUrl()}/file${normalizedPath}`;

  // Always check cache first
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return cached;
  }

  const url = '/api/file/getFile';
  const response = await kernelFetch(url, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kernel ${url} returned ${response.status}: ${text.slice(0, 100)}`);
  }

  // Check for JSON error response (404) - skip for large or non-JSON files
  const contentType = response.headers.get('Content-Type') || '';
  const contentLength = response.headers.get('Content-Length');
  const MAX_ERROR_SIZE = 1024;
  const mayBeErrorJson = contentType.includes('application/json') &&
    (!contentLength || parseInt(contentLength, 10) <= MAX_ERROR_SIZE);

  if (mayBeErrorJson) {
    const [checkStream, returnStream] = response.body!.tee();
    const data = await limitedRead(checkStream, MAX_ERROR_SIZE);

    if (data) {
      // Small response - check if it's a 404 error
      try {
        const json = JSON.parse(new TextDecoder().decode(data)) as { code?: number };
        if (json.code === 404) {
          return null;
        }
      } catch {
        // Invalid JSON - treat as file content
      }
      // Cache and return the data we already read
      const headers = new Headers(response.headers);
      headers.set('Content-Length', data.length.toString());
      return cacheResponse(data, headers, cacheKey, cacheTtl);
    }

    // limitedRead returned null (exceeded size) - cache and return the stream
    return cacheResponse(returnStream, response.headers, cacheKey, cacheTtl);
  }

  // Non-JSON or large JSON - cache and return directly
  return cacheResponse(response.body!, response.headers, cacheKey, cacheTtl);
}

/** Get JSON file from workspace (cached) */
export async function getJSONFile(path: string): Promise<any> {
  const url = '/api/file/getFile';
  const response = await cachedPostRequest({ path }, url);
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
  const response = await writePostRequest({ path }, url);
  return response.code === 0;
}

/** Rename file in workspace */
export async function renameFileAPI(path: string, newPath: string): Promise<boolean> {
  const url = '/api/file/renameFile';
  const response = await writePostRequest({ path, newPath }, url);
  return response.code === 0;
}

/** Read directory contents (cached) */
export async function readDirAPI(path: string): Promise<any[] | null> {
  const url = '/api/file/readDir';
  const response = await cachedPostRequest({ path }, url);
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
  const result = await response.json() as { code: number; msg?: string };
  if (result.code !== 0) {
    throw new Error(result.msg || `File operation failed with code ${result.code}`);
  }
  invalidateCache();
  return true;
}

/** Upload assets (images, files) to SiYuan */
export async function uploadAPI(
  assetsDirPath: string,
  files: { name: string; data: Blob }[]
): Promise<{ succMap: Record<string, string>; errFiles: string[] }> {
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
    msg?: string;
    data?: { succMap: Record<string, string>; errFiles: string[] };
  };

  if (result.code !== 0) {
    throw new Error(result.msg || `Upload failed with code ${result.code}`);
  }
  if (!result.data) {
    throw new Error('Upload response missing data');
  }
  invalidateCache();
  return result.data;
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

// ===== Template APIs =====

interface SearchTemplateResult {
  content: string;
  path: string;
}

/** Search templates by keyword */
export async function searchTemplateAPI(k: string): Promise<SearchTemplateResult[]> {
  const url = '/api/search/searchTemplate';
  const response = await postRequest({ k }, url);
  if (response.code === 0) {
    return (response.data?.blocks ?? []) as SearchTemplateResult[];
  }
  throw new Error(`searchTemplate failed: ${response.msg}`);
}

/** Render template into DOM and return the rendered HTML string */
export async function renderTemplateAPI(id: DocumentId, path: string): Promise<string> {
  const url = '/api/template/render';
  const response = await writePostRequest({ id, path }, url);
  if (response.code === 0) {
    return response.data.content as string;
  }
  throw new Error(`renderTemplate failed: ${response.msg}`);
}

/** Render a Sprig template string */
export async function renderSprigAPI(template: string): Promise<string> {
  const url = '/api/template/renderSprig';
  const response = await postRequest({ template }, url);
  if (response.code === 0) {
    return response.data as string;
  }
  throw new Error(`renderSprig failed: ${response.msg}`);
}

// ===== Notebook APIs =====

/** Rename a notebook */
export async function renameNotebookAPI(notebookId: NotebookId, name: string): Promise<true> {
  const url = '/api/notebook/renameNotebook';
  const response = await writePostRequest({ notebook: notebookId, name }, url);
  if (response.code === 0) {
    return true;
  }
  throw new Error(`renameNotebook failed: ${response.msg}`);
}

// ===== Document APIs (additional) =====

/** Move documents by IDs (simpler interface than moveDocsAPI) */
export async function moveDocsByIDAPI(fromIDs: DocumentId[], toID: string): Promise<true> {
  const url = '/api/filetree/moveDocsByID';
  const response = await writePostRequest({ fromIDs, toID }, url);
  if (response.code === 0) {
    return true;
  }
  throw new Error(`moveDocsByID failed: ${response.msg}`);
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
