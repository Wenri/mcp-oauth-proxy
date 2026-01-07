/**
 * Custom SiYuan API functions
 * Adapted from upstream to use platform abstraction
 *
 * CHANGE FROM UPSTREAM: Removed DOM-dependent functions (getActiveEditorIds, etc.)
 */

import { queryAPI, listDocsByPathT, getTreeStat, listDocTree, getRiffDecks, getNodebookList, getDocIDByHPath } from './index';
import { getCacheKey, cacheResponse } from './cache';
import { isValidStr } from '../utils/commonCheck';
import { debugPush, logPush } from '../logger';

/** Cache TTL for SQL query results (3 minutes) */
export const SQL_CACHE_TTL = 180;

/** Aggregate query result types */
type CountResult = { count: number };
type AvCountResult = { avcount: number };
type BlockCountResult = { bcount: number };

/**
 * Cache helper for SQL query results.
 * Uses CF Cache API with custom cache keys.
 */
export async function cachedQuery<T = Block>(
  path: string,
  params: Record<string, string | number | boolean>,
  stmt: string,
  ttl: number = SQL_CACHE_TTL
): Promise<T[]> {
  const cacheKey = getCacheKey(path, params);

  // Check cache first
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  // Use queryAPI - cast result since SQL can return different row structures
  const result = await queryAPI(stmt) as unknown as T[];

  // Cache using cacheResponse helper
  if (ttl > 0) {
    cacheResponse(result, new Headers(), cacheKey, ttl);
  }

  return result;
}

/**
 * Get word count for child documents (cached)
 */
export async function getChildDocumentsWordCount(docId: DocumentId): Promise<number> {
  const stmt = `
    SELECT SUM(length) AS count
    FROM blocks
    WHERE
      path like "%/${docId}/%"
      AND
      type in ("p", "h", "c", "t")
  `;
  const sqlResult = await cachedQuery<CountResult>('/custom/childWordCount', { docId }, stmt);
  if (sqlResult[0]?.count) {
    return sqlResult[0].count;
  }
  return 0;
}

export async function getChildDocuments(sqlResult: Block, maxListCount: number): Promise<IFile[]> {
  const childDocs = await listDocsByPathT({
    path: sqlResult.path,
    notebook: sqlResult.box,
    maxListCount: maxListCount,
  });
  return childDocs;
}

export async function getChildDocumentIds(sqlResult: Block, maxListCount: number): Promise<DocumentId[]> {
  const childDocs = await listDocsByPathT({
    path: sqlResult.path,
    notebook: sqlResult.box,
    maxListCount: maxListCount,
  });
  return childDocs.map((item) => item.id);
}

export async function isChildDocExist(id: BlockId): Promise<boolean> {
  const stmt = `SELECT * FROM blocks WHERE path like '%${id}/%' LIMIT 3`;
  const sqlResponse = await cachedQuery('/custom/childDocExist', { id }, stmt);
  return sqlResponse && sqlResponse.length > 0;
}

export async function isDocHasAv(docId: DocumentId): Promise<boolean> {
  const stmt = `SELECT count(*) as avcount FROM blocks WHERE root_id = '${docId}' AND type = 'av'`;
  const sqlResult = await cachedQuery<AvCountResult>('/custom/docHasAv', { docId }, stmt);
  return sqlResult.length > 0 && sqlResult[0].avcount > 0;
}

export async function isDocEmpty(docId: DocumentId, blockCountThreshold = 0): Promise<boolean> {
  const treeStat = await getTreeStat(docId);
  if (blockCountThreshold == 0 && treeStat.wordCount != 0 && treeStat.imageCount != 0) {
    debugPush('treeStat判定文档非空');
    return false;
  }
  if (blockCountThreshold != 0) {
    const stmt = `SELECT count(*) as bcount FROM blocks WHERE root_id like '${docId}' AND type in ('p', 'c', 'iframe', 'html', 'video', 'audio', 'widget', 'query_embed', 't')`;
    const blockCountSqlResult = await cachedQuery<BlockCountResult>('/custom/docBlockCount', { docId }, stmt);
    if (blockCountSqlResult.length > 0) {
      return blockCountSqlResult[0].bcount <= blockCountThreshold;
    }
  }

  const stmt = `SELECT markdown FROM blocks WHERE root_id like '${docId}' AND type != 'd' AND (type != 'p' OR (type = 'p' AND length != 0)) LIMIT 5`;
  const sqlResult = await cachedQuery('/custom/docEmpty', { docId }, stmt);
  if (sqlResult.length <= 0) {
    return true;
  } else {
    debugPush('sql判定文档非空');
    return false;
  }
}

/**
 * Generate update timestamp string
 */
export function getUpdateString(): string {
  const nowDate = new Date();
  let hours: string | number = nowDate.getHours();
  let minutes: string | number = nowDate.getMinutes();
  let seconds: string | number = nowDate.getSeconds();

  const formatTime = (num: number) => (num < 10 ? '0' + num : num);
  hours = formatTime(hours as number);
  minutes = formatTime(minutes as number);
  seconds = formatTime(seconds as number);

  const timeStr =
    nowDate
      .toJSON()
      .replace(new RegExp('-', 'g'), '')
      .substring(0, 8) +
    hours +
    minutes +
    seconds;
  return timeStr;
}

/**
 * Generate a random block ID
 * Note: In CF Worker, we don't have window.Lute, so we generate our own
 */
export function generateBlockId(): string {
  const timeStr = getUpdateString();
  const alphabet: string[] = [];
  for (let i = 48; i <= 57; i++) alphabet.push(String.fromCharCode(i));
  for (let i = 97; i <= 122; i++) alphabet.push(String.fromCharCode(i));
  let randomStr = '';
  for (let i = 0; i < 7; i++) {
    randomStr += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return timeStr + '-' + randomStr;
}

/**
 * Transform block attributes to IAL string format
 */
export function transfromAttrToIAL(attrData: Record<string, string>): string | null {
  let result = '{:';
  for (const key in attrData) {
    result += ` ${key}="${attrData[key]}"`;
  }
  result += '}';
  if (result == '{:}') return null;
  return result;
}

export function isValidIdFormat(id: string): boolean {
  const idRegex = /^\d{14}-[a-zA-Z0-9]{7}$/gm;
  return idRegex.test(id);
}

/**
 * Escape a string for use in SQL queries.
 * Escapes single quotes by doubling them.
 *
 * @param value - The string to escape
 * @returns Escaped string safe for SQL
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function checkIdValid(id: string): void {
  if (!isValidIdFormat(id)) {
    throw new Error("The `id` format is incorrect, please check if it is a valid `id`.");
  }
}

export async function isADocId(id: BlockId): Promise<boolean> {
  if (!isValidStr(id)) return false;
  if (!isValidIdFormat(id)) {
    return false;
  }
  const queryResponse = await cachedQuery('/custom/isDoc', { id }, `SELECT type FROM blocks WHERE id = '${id}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return false;
  }
  return queryResponse[0].type === 'd';
}

export async function getDocDBitem(id: DocumentId): Promise<Block | null> {
  if (!isValidStr(id)) return null;
  checkIdValid(id);
  const safeId = escapeSqlString(id);
  const queryResponse = await cachedQuery('/custom/doc', { id }, `SELECT * FROM blocks WHERE id = '${safeId}' and type = 'd'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return null;
  }
  return queryResponse[0];
}

/**
 * Get block item from database by ID (cached)
 */
export async function getBlockDBItem(id: BlockId): Promise<Block | null> {
  if (!isValidStr(id)) return null;
  checkIdValid(id);
  const safeId = escapeSqlString(id);
  const queryResponse = await cachedQuery('/custom/block', { id }, `SELECT * FROM blocks WHERE id = '${safeId}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return null;
  }
  return queryResponse[0];
}

/**
 * @deprecated Use AssetDBItem from sytypes.d.ts instead
 */
export type IAssetsDBItem = AssetDBItem;

/**
 * Get block assets (cached)
 */
export async function getBlockAssets(id: BlockId): Promise<AssetDBItem[]> {
  const queryResponse = await cachedQuery<AssetDBItem>('/custom/assets', { id }, `SELECT * FROM assets WHERE block_id = '${id}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return [];
  }
  return queryResponse;
}

/**
 * Get all sub-document IDs recursively
 */
export async function getSubDocIds(id: DocumentId): Promise<DocumentId[]> {
  const docInfo = await getDocDBitem(id);
  if (!docInfo) return [];

  const treeList = await listDocTree(docInfo.box, docInfo.path.replace('.sy', ''));
  const subIdsSet = new Set<DocumentId>();

  function addToSet(obj: DocTreeNode | DocTreeNode[] | null): void {
    if (Array.isArray(obj)) {
      obj.forEach((item) => addToSet(item));
      return;
    }
    if (obj == null) {
      return;
    }
    if (isValidStr(obj.id)) {
      subIdsSet.add(obj.id);
    }
    if (obj.children && obj.children.length > 0) {
      for (const item of obj.children) {
        addToSet(item);
      }
    }
  }
  addToSet(treeList);
  logPush('subIdsSet', subIdsSet);
  return Array.from(subIdsSet);
}

export const QUICK_DECK_ID = '20230218211946-2kw8jgx';

export async function isValidDeck(deckId: string): Promise<boolean> {
  if (deckId === QUICK_DECK_ID) return true;
  const deckResponse = await getRiffDecks();
  return !!deckResponse.find((item) => item.id === deckId);
}

/**
 * Resolve an ID or human-readable path (hpath) to a block ID.
 *
 * @param input - Either a block ID (e.g., "20241231120000-abc1234") or
 *                an hpath (e.g., "/NotebookName/Doc/SubDoc")
 * @returns The resolved block ID, or null if not found
 *
 * @example
 * // ID input - returned as-is after format check
 * await resolveIdOrHPath("20241231120000-abc1234") // "20241231120000-abc1234"
 *
 * // hpath input - resolved to ID
 * await resolveIdOrHPath("/MyNotes/Projects/Todo") // "20241231120000-xyz7890"
 */
export async function resolveIdOrHPath(input: string): Promise<BlockId | null> {
  if (!isValidStr(input)) return null;

  // If it's a valid ID format, return as-is
  if (isValidIdFormat(input)) {
    return input;
  }

  // If it starts with /, treat as hpath
  if (input.startsWith('/')) {
    // Split path: /NotebookName/Doc/SubDoc -> ["", "NotebookName", "Doc", "SubDoc"]
    const segments = input.split('/').filter(s => s.length > 0);
    if (segments.length < 1) return null;

    const notebookName = segments[0];
    const docPath = '/' + segments.slice(1).join('/'); // e.g., "/Doc/SubDoc"

    // Look up notebook by name
    const notebooks = await getNodebookList();
    debugPush(`Resolving hpath: "${input}" -> notebook="${notebookName}", docPath="${docPath}"`);
    debugPush(`Available notebooks: ${notebooks.map(nb => nb.name).join(', ')}`);

    const notebook = notebooks.find(nb => nb.name === notebookName);
    if (!notebook) {
      debugPush(`Notebook not found: "${notebookName}"`);
      return null;
    }
    debugPush(`Found notebook: ${notebook.id} (${notebook.name})`);

    // Resolve document path within notebook
    if (segments.length === 1) {
      // Just notebook name, return notebook ID (though it's not a block ID)
      return notebook.id;
    }

    const docId = await getDocIDByHPath(notebook.id, docPath);
    debugPush(`getDocIDByHPath(${notebook.id}, "${docPath}") -> ${docId}`);
    return docId;
  }

  // Neither ID format nor hpath
  return null;
}
