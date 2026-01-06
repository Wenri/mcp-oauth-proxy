/**
 * Base tool provider and shared functions
 */

import { generateNodeID } from '..';
import { createDocWithMdAPI, createDocWithPath, getNodebookList } from '../syapi';
import { getDocDBitem, resolveIdOrHPath, isValidIdFormat } from '../syapi/custom';
import { isValidNotebookId, isValidStr } from '../utils/commonCheck';

export abstract class McpToolsProvider {
    abstract getTools(): Promise<McpTool[]>;
}

export async function createNewDoc(
  notebookId: NotebookId,
  parentDocId: DocumentId,
  title: string,
  content: string
): Promise<DocumentId | null> {
  const hpath = `/${parentDocId}/${title}`;
  const docId = await createDocWithMdAPI(notebookId, hpath, content);
  return docId;
}

export async function createNewDocWithParentId(
  parentId: NotebookId | DocumentId | string,
  title: string,
  markdownContent: string
): Promise<{ result: boolean; newDocId: DocumentId }> {
  const newDocId = generateNodeID();

  const createParams = {
    notebook: '',
    path: `/${newDocId}.sy`,
    title: isValidStr(title) ? title : 'Untitled',
    md: markdownContent,
  };

  // Case 1: Check if it's a valid notebook ID
  if (isValidIdFormat(parentId) && isValidNotebookId(parentId)) {
    createParams.notebook = parentId;
  }
  // Case 2: Check if it's a valid ID format (could be document ID or notebook ID not in cache)
  else if (isValidIdFormat(parentId)) {
    // First try as document ID
    const docInfo = await getDocDBitem(parentId);
    if (docInfo) {
      createParams.notebook = docInfo['box'];
      createParams.path = docInfo['path'].replace('.sy', '') + createParams.path;
    } else {
      // Might be a notebook ID not in cache - verify against API
      const notebooks = await getNodebookList();
      const notebook = notebooks.find(nb => nb.id === parentId);
      if (notebook) {
        createParams.notebook = parentId;
      } else {
        throw new Error(
          `Invalid parentId "${parentId}". Not found as document or notebook. Please check the ID.`
        );
      }
    }
  }
  // Case 3: hpath like "/NotebookName" or "/NotebookName/Doc"
  else if (parentId.startsWith('/')) {
    const resolvedId = await resolveIdOrHPath(parentId);
    if (!resolvedId) {
      throw new Error(
        `Invalid hpath "${parentId}". Could not resolve to a notebook or document.`
      );
    }

    // Check if resolved to notebook or document
    const notebooks = await getNodebookList();
    const notebook = notebooks.find(nb => nb.id === resolvedId);
    if (notebook) {
      createParams.notebook = resolvedId;
    } else {
      const docInfo = await getDocDBitem(resolvedId);
      if (docInfo) {
        createParams.notebook = docInfo['box'];
        createParams.path = docInfo['path'].replace('.sy', '') + createParams.path;
      } else {
        throw new Error(
          `Resolved ID "${resolvedId}" from hpath "${parentId}" not found as document or notebook.`
        );
      }
    }
  }
  // Case 4: Invalid format
  else {
    throw new Error(
      `Invalid parentId format "${parentId}". Expected a document/notebook ID or hpath (e.g., "/NotebookName" or "/NotebookName/Doc").`
    );
  }

  const result = await createDocWithPath(
    createParams.notebook,
    createParams.path,
    createParams.title,
    createParams.md
  );

  return { result: result !== null, newDocId };
}
