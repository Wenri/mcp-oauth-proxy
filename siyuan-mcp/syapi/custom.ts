/**
 * Custom SiYuan API functions
 * Adapted from upstream to use platform abstraction
 *
 * CHANGE FROM UPSTREAM: Removed DOM-dependent functions (getActiveEditorIds, etc.)
 */

import { queryAPI, listDocsByPathT, getTreeStat, listDocTree, getRiffDecks } from './index';
import { isValidStr } from '../utils/commonCheck';
import { debugPush, logPush } from '../logger';

/**
 * Get word count for child documents
 */
export async function getChildDocumentsWordCount(docId: string) {
  const sqlResult = await queryAPI(`
    SELECT SUM(length) AS count
    FROM blocks
    WHERE
      path like "%/${docId}/%"
      AND
      type in ("p", "h", "c", "t")
  `);
  if (sqlResult[0]?.count) {
    return sqlResult[0].count;
  }
  return 0;
}

export async function getChildDocuments(sqlResult: any, maxListCount: number): Promise<any[]> {
  const childDocs = await listDocsByPathT({
    path: sqlResult.path,
    notebook: sqlResult.box,
    maxListCount: maxListCount,
  });
  return childDocs;
}

export async function getChildDocumentIds(sqlResult: any, maxListCount: number): Promise<string[]> {
  const childDocs = await listDocsByPathT({
    path: sqlResult.path,
    notebook: sqlResult.box,
    maxListCount: maxListCount,
  });
  return childDocs.map((item: any) => item.id);
}

export async function isChildDocExist(id: string) {
  const sqlResponse = await queryAPI(`
    SELECT * FROM blocks WHERE path like '%${id}/%' LIMIT 3
  `);
  if (sqlResponse && sqlResponse.length > 0) {
    return true;
  }
  return false;
}

export async function isDocHasAv(docId: string) {
  const sqlResult = await queryAPI(`
    SELECT count(*) as avcount FROM blocks WHERE root_id = '${docId}'
    AND type = 'av'
  `);
  if (sqlResult.length > 0 && sqlResult[0].avcount > 0) {
    return true;
  }
  return false;
}

export async function isDocEmpty(docId: string, blockCountThreshold = 0) {
  const treeStat = await getTreeStat(docId);
  if (blockCountThreshold == 0 && treeStat.wordCount != 0 && treeStat.imageCount != 0) {
    debugPush('treeStat判定文档非空');
    return false;
  }
  if (blockCountThreshold != 0) {
    const blockCountSqlResult = await queryAPI(
      `SELECT count(*) as bcount FROM blocks WHERE root_id like '${docId}' AND type in ('p', 'c', 'iframe', 'html', 'video', 'audio', 'widget', 'query_embed', 't')`
    );
    if (blockCountSqlResult.length > 0) {
      if (blockCountSqlResult[0].bcount > blockCountThreshold) {
        return false;
      } else {
        return true;
      }
    }
  }

  const sqlResult = await queryAPI(`SELECT markdown FROM blocks WHERE
    root_id like '${docId}'
    AND type != 'd'
    AND (type != 'p'
       OR (type = 'p' AND length != 0)
       )
    LIMIT 5`);
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

export function checkIdValid(id: string): void {
  if (!isValidIdFormat(id)) {
    throw new Error("The `id` format is incorrect, please check if it is a valid `id`.");
  }
}

export async function isADocId(id: string): Promise<boolean> {
  if (!isValidStr(id)) return false;
  if (!isValidIdFormat(id)) {
    return false;
  }
  const queryResponse = await queryAPI(`SELECT type FROM blocks WHERE id = '${id}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return false;
  }
  if (queryResponse[0].type == 'd') {
    return true;
  }
  return false;
}

export async function getDocDBitem(id: string) {
  if (!isValidStr(id)) return null;
  checkIdValid(id);
  const safeId = id.replace(/'/g, "''");
  const queryResponse = await queryAPI(`SELECT * FROM blocks WHERE id = '${safeId}' and type = 'd'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return null;
  }
  return queryResponse[0];
}

/**
 * Get block item from database by ID
 */
export async function getBlockDBItem(id: string) {
  if (!isValidStr(id)) return null;
  checkIdValid(id);
  const safeId = id.replace(/'/g, "''");
  const queryResponse = await queryAPI(`SELECT * FROM blocks WHERE id = '${safeId}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return null;
  }
  return queryResponse[0];
}

export interface IAssetsDBItem {
  id: string;
  block_id: string;
  root_id: string;
  box: string;
  docpath: string;
  path: string;
  name: string;
  title: string;
  hash: string;
}

/**
 * Get block assets
 */
export async function getBlockAssets(id: string): Promise<IAssetsDBItem[]> {
  const queryResponse = await queryAPI(`SELECT * FROM assets WHERE block_id = '${id}'`);
  if (queryResponse == null || queryResponse.length == 0) {
    return [];
  }
  return queryResponse;
}

/**
 * Get all sub-document IDs recursively
 */
export async function getSubDocIds(id: string): Promise<string[]> {
  const docInfo = await getDocDBitem(id);
  if (!docInfo) return [];

  const treeList = await listDocTree(docInfo['box'], docInfo['path'].replace('.sy', ''));
  const subIdsSet = new Set<string>();

  function addToSet(obj: any) {
    if (obj instanceof Array) {
      obj.forEach((item) => addToSet(item));
      return;
    }
    if (obj == null) {
      return;
    }
    if (isValidStr(obj['id'])) {
      subIdsSet.add(obj['id']);
    }
    if (obj['children'] != undefined) {
      for (const item of obj['children']) {
        addToSet(item);
      }
    }
  }
  addToSet(treeList);
  logPush('subIdsSet', subIdsSet);
  return Array.from(subIdsSet);
}

export const QUICK_DECK_ID = '20230218211946-2kw8jgx';

export async function isValidDeck(deckId: string) {
  if (deckId === QUICK_DECK_ID) return true;
  const deckResponse = await getRiffDecks();
  return !!deckResponse.find((item: any) => item.id == deckId);
}
