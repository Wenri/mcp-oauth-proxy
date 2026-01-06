/**
 * Base tool provider and shared functions
 */

import type { z } from 'zod';
import { generateNodeID } from '..';
import { createDocWithMdAPI, createDocWithPath } from '../syapi';
import { getDocDBitem, resolveIdOrHPath, isValidIdFormat } from '../syapi/custom';
import { isValidNotebookId, isValidStr } from '../utils/commonCheck';
import { generateToolSignature, generateToolTypeDoc } from '../utils/schemaDoc';

/**
 * Helper function to define a tool with type inference.
 * Automatically infers handler args type from inputSchema.
 *
 * @example
 * defineTool({
 *   name: 'get_block',
 *   description: 'Get a block by ID',
 *   inputSchema: z.object({ id: z.string() }),
 *   handler: async (args) => {
 *     // args.id is inferred as string
 *   }
 * })
 */
export function defineTool<
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodType
>(tool: McpTool<TInput, TOutput>): McpTool<TInput, TOutput> {
  return tool;
}

export abstract class McpToolsProvider {
  abstract getTools(): Promise<McpTool[]>;

  /** Generate signatures for all tools in this provider */
  async getSignatures(): Promise<string[]> {
    const tools = await this.getTools();
    return tools.map(tool => generateToolSignature(tool));
  }

  /** Generate full type documentation for all tools in this provider */
  async getTypeDocs(): Promise<string[]> {
    const tools = await this.getTools();
    return tools.map(tool => generateToolTypeDoc(tool));
  }
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
  if (isValidIdFormat(parentId) && await isValidNotebookId(parentId)) {
    createParams.notebook = parentId;
  }
  // Case 2: Valid ID format but not a notebook - must be a document ID
  else if (isValidIdFormat(parentId)) {
    const docInfo = await getDocDBitem(parentId);
    if (docInfo) {
      createParams.notebook = docInfo['box'];
      createParams.path = docInfo['path'].replace('.sy', '') + createParams.path;
    } else {
      throw new Error(
        `Invalid parentId "${parentId}". Not found as document or notebook.`
      );
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
    if (await isValidNotebookId(resolvedId)) {
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
