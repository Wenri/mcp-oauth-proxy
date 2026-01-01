/**
 * Shared functions for tools
 */

import { generateNodeID } from '..';
import { createDocWithMdAPI, createDocWithPath } from '../syapi';
import { checkIdValid, getDocDBitem } from '../syapi/custom';
import { isValidNotebookId, isValidStr } from '../utils/commonCheck';

export async function createNewDoc(
  notebookId: string,
  parentDocId: string,
  title: string,
  content: string
): Promise<string | null> {
  const hpath = `/${parentDocId}/${title}`;
  const docId = await createDocWithMdAPI(notebookId, hpath, content);
  return docId;
}

export async function createNewDocWithParentId(
  parentId: string,
  title: string,
  markdownContent: string
): Promise<{ result: boolean; newDocId: string }> {
  checkIdValid(parentId);

  const notebookIdFlag = isValidNotebookId(parentId);
  const newDocId = generateNodeID();

  const createParams: {
    notebook: string;
    path: string;
    title: string;
    md: string;
    listDocTree: boolean;
  } = {
    notebook: parentId,
    path: `/${newDocId}.sy`,
    title: title,
    md: markdownContent,
    listDocTree: false,
  };

  if (!isValidStr(title)) {
    createParams.title = 'Untitled';
  }

  if (!notebookIdFlag) {
    const docInfo = await getDocDBitem(parentId);
    if (docInfo == null) {
      throw new Error(
        'Invalid input parameter `parentId`. parentId should be a notebook ID or document ID. Please check the ID.'
      );
    }
    createParams.path = docInfo['path'].replace('.sy', '') + createParams.path;
    createParams.notebook = docInfo['box'];
  }

  const result = await createDocWithPath(
    createParams.notebook,
    createParams.path,
    createParams.title,
    createParams.md
  );

  return { result: result !== null, newDocId };
}
