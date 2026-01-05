/**
 * Document write tools
 * Adapted from upstream
 */

import { z } from 'zod';
import { createSuccessResponse } from '../utils/mcpResponse';
import { appendBlockAPI, renameDocAPI, removeDocAPI, moveDocsAPI } from '../syapi';
import { isADocId } from '../syapi/custom';
import { McpToolsProvider, createNewDocWithParentId } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { validateBlockAccess, filterBlock } from '../utils/resultFilter';

export class DocWriteToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_append_markdown_to_doc',
        description: 'Append Markdown content to the end of a document in SiYuan by its ID.',
        inputSchema: {
          id: z
            .string()
            .describe('The unique identifier of the document to which the Markdown content will be appended.'),
          markdownContent: z
            .string()
            .describe('The Markdown-formatted text to append to the end of the specified document.'),
        },
        handler: appendBlockHandler,
        title: lang('tool_title_append_markdown_to_doc'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_create_new_note_with_markdown_content',
        description:
          'Create a new note under a parent document in SiYuan with a specified title and Markdown content.',
        inputSchema: {
          parentId: z
            .string()
            .describe(
              'The unique identifier (ID) of the parent document or notebook where the new note will be created.'
            ),
          title: z.string().describe('The title of the new note to be created.'),
          markdownContent: z.string().describe('The Markdown content of the new note.'),
        },
        handler: createNewNoteUnder,
        title: lang('tool_title_create_new_note_with_markdown_content'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_rename_doc',
        description: 'Rename a document by its ID.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document to rename'),
          title: z.string().describe('The new title for the document'),
        },
        handler: renameDocHandler,
        title: lang('tool_title_rename_doc'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_remove_doc',
        description: 'Delete a document by its ID. This action moves the document to trash and is irreversible.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document to delete'),
        },
        handler: removeDocHandler,
        title: lang('tool_title_remove_doc'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_move_docs',
        description:
          'Move one or more documents to a new location. Accepts either document IDs or full paths (notebook/path format).',
        inputSchema: {
          fromDocs: z
            .array(z.string())
            .describe('Array of document IDs or full paths (e.g., "20210808180117-abc" or "notebook123/path/to/doc.sy")'),
          toNotebook: z.string().describe('Target notebook ID'),
          toPath: z.string().describe('Target path within the notebook (e.g., "/" for root, or "/Parent Doc" for subdoc)'),
        },
        handler: moveDocsHandler,
        title: lang('tool_title_move_docs'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    ];
  }
}

async function appendBlockHandler(params: { id: DocumentId; markdownContent: string }) {
  const { id, markdownContent } = params;
  debugPush('Append to document API called');

  if (!(await isADocId(id))) {
    throw new Error("Failed to append to document: The provided ID is not a document ID.");
  }
  await validateBlockAccess(id, true);

  const result = await appendBlockAPI(markdownContent, id);
  if (result == null) {
    throw new Error('Failed to append to the document');
  }

  taskManager.insert(result.id, markdownContent, 'appendToDocEnd', { docId: id }, TASK_STATUS.APPROVED);
  return createSuccessResponse(result.id);
}

async function createNewNoteUnder(params: { parentId: NotebookId | DocumentId; title: string; markdownContent: string }) {
  const { parentId, title, markdownContent } = params;

  if (await filterBlock(parentId, null)) {
    throw new Error(
      'The specified document or block is excluded by the user settings, so cannot create a new note under it.'
    );
  }

  debugPush('Create new note API called');
  const { result, newDocId } = await createNewDocWithParentId(parentId, title, markdownContent);

  if (result) {
    taskManager.insert(newDocId, markdownContent, 'createNewNoteUnder', {}, TASK_STATUS.APPROVED);
    return createSuccessResponse(newDocId);
  }

  throw new Error('An Error Occurred');
}

async function renameDocHandler(params: { id: DocumentId; title: string }) {
  const { id, title } = params;
  debugPush('Rename document API called');

  const docInfo = await validateBlockAccess(id, true);

  const result = await renameDocAPI(docInfo.box, docInfo.path, title);
  if (!result) {
    throw new Error('Failed to rename the document');
  }

  return createSuccessResponse(title);
}

async function removeDocHandler(params: { id: DocumentId }) {
  const { id } = params;
  debugPush('Remove document API called');

  const docInfo = await validateBlockAccess(id, true);

  const result = await removeDocAPI(docInfo.box, docInfo.path);
  if (!result) {
    throw new Error('Failed to remove the document');
  }

  taskManager.insert(id, '', 'removeDoc', {}, TASK_STATUS.APPROVED);
  return createSuccessResponse('Document removed');
}

async function moveDocsHandler(params: { fromDocs: (DocumentId | string)[]; toNotebook: NotebookId; toPath: string }) {
  const { fromDocs, toNotebook, toPath } = params;
  debugPush('Move documents API called');

  if (!fromDocs || fromDocs.length === 0) {
    throw new Error('Please provide at least one document ID or path to move.');
  }

  // Process each entry - could be an ID or a full path
  const fromPaths: string[] = [];
  for (const doc of fromDocs) {
    // Check if it looks like a full path (contains /) or an ID
    if (doc.includes('/')) {
      // It's already a full path (notebook/path format)
      fromPaths.push(doc);
    } else {
      // It's a document ID - look up the path
      const docInfo = await validateBlockAccess(doc, true);
      // Full path format: notebook/path
      fromPaths.push(`${docInfo.box}${docInfo.path}`);
    }
  }

  const result = await moveDocsAPI(fromPaths, toNotebook, toPath);
  if (!result) {
    throw new Error('Failed to move the documents');
  }

  return createSuccessResponse(`Moved ${fromDocs.length} documents`);
}
