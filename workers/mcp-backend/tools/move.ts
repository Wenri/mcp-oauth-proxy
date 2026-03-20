import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { moveBlockAPI, moveDocsByIDAPI, foldBlockAPI, unfoldBlockAPI } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { getBlockDBItem, getDocDBitem } from '../syapi/custom';
import { validateBlockAccess } from '../utils/resultFilter';
import { debugPush } from '../logger';
import { isContainerBlockType, isValidNotebookId, isValidStr } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { filterBlock, filterNotebook } from '../utils/filterCheck';

export class MoveBlockToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_move_docs_by_ids',
        description: 'Move one or more documents to a target location. Documents can be moved under a parent document or to the root of a notebook.',
        inputSchema: z.object({
          ids: z.array(z.string()).min(1).describe('List of document IDs to move. Supports moving multiple documents at once.'),
          toId: z.string().describe('Target location ID. If this ID is a document, the selected documents become its children; if it is a notebook ID, they are moved to the root of that notebook.'),
        }),
        handler: moveDocsByIds,
        title: lang('tool_title_move_docs'),
        annotations: {
          destructiveHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_move_block_by_id',
        description: 'Move one or more blocks (paragraph, heading, superblock, table, etc.) to a target location. Blocks are moved in order, maintaining their relative sequence. Does not support moving document blocks — use siyuan_move_docs_by_ids for documents.',
        inputSchema: z.object({
          ids: z.array(z.string()).min(1).describe('Block ID(s) to move, in desired order. Supports batch moving.'),
          previousId: z.string().optional().describe('Reference block ID. Moved blocks are inserted after this block. Cannot be a document ID.'),
          parentId: z.string().optional().describe('Target parent block ID or hpath. Moved blocks become the first children of this block. Ignored if previousId is provided.'),
          moveWithSubBlocks: z.boolean().default(false).describe('When true and a block is a heading, the heading and all its sub-blocks are moved as a unit. The heading will be unfolded after the move.'),
        }),
        outputSchema: z.object({
          moved: z.array(z.string()).describe('Block IDs successfully moved'),
          failed: z.array(z.object({
            id: z.string().describe('Block ID that failed'),
            error: z.string().describe('Error reason'),
          })).optional().describe('Blocks that failed to move with error details'),
        }),
        handler: moveBlockById,
        title: lang('tool_title_move_block_by_id'),
        annotations: {
          destructiveHint: true,
        },
      }),
    ];
  }
}

async function moveDocsByIds(params: { ids: string[]; toId: string }) {
  const { ids, toId } = params;
  debugPush('Moving documents by IDs');

  if (await isValidNotebookId(toId)) {
    if (filterNotebook(toId)) {
      return createErrorResponse('The specified target notebook is excluded by the user settings. Cannot write or read.');
    }
  } else {
    const toDbItem = await getDocDBitem(toId);
    if (toDbItem == null) {
      return createErrorResponse('Invalid target document or notebook ID. Please check if the ID exists and is related to a document.');
    }
    if (await filterBlock(toId, toDbItem)) {
      return createErrorResponse('The specified target document or block is excluded by the user settings. Cannot write or read.');
    }
  }

  // Validate all source documents before moving
  for (const id of ids) {
    const dbItem = await getDocDBitem(id);
    if (dbItem == null) {
      return createErrorResponse(`Invalid document ID: ${id}. Please check if the ID exists and is related to a document.`);
    }
    if (await filterBlock(id, dbItem)) {
      return createErrorResponse('The specified document or block is excluded by the user settings. Cannot write or read.');
    }
  }

  await moveDocsByIDAPI(ids, toId);
  return createSuccessResponse('Move documents successfully.');
}

async function moveBlockById(params: { ids: string[]; previousId?: string; parentId?: string; moveWithSubBlocks: boolean }) {
  const { ids, previousId, parentId, moveWithSubBlocks } = params;

  if (!isValidStr(previousId) && !isValidStr(parentId)) {
    return createErrorResponse('Either previousId or parentId must be provided to specify the target location.');
  }

  // Resolve and validate the target once before the loop
  let resolvedParentId: BlockId | undefined;
  let currentPreviousId: BlockId | undefined;
  let parentBlockType: string | undefined;

  if (isValidStr(previousId)) {
    const prevDbItem = await getBlockDBItem(previousId!);
    if (prevDbItem == null) {
      return createErrorResponse('Invalid previousId. Please check if the ID exists and is correct.');
    }
    if (await filterBlock(previousId!, prevDbItem)) {
      return createErrorResponse('The specified previous sibling block is excluded by user settings. Cannot write or read.');
    }
    if (prevDbItem.type === 'd') {
      return createErrorResponse('Cannot move block after a document block. Please choose a valid block as the target previous sibling.');
    }
    currentPreviousId = prevDbItem.id;
  } else if (isValidStr(parentId)) {
    // validateBlockAccess supports hpath resolution
    const parentDbItem = await validateBlockAccess(parentId!);
    if (!isContainerBlockType(parentDbItem.type)) {
      return createErrorResponse('Cannot move block under a non-container block. Please choose a valid container block as the target parent.');
    }
    resolvedParentId = parentDbItem.id;
    parentBlockType = parentDbItem.type;
  }

  const moved: BlockId[] = [];
  const failed: { id: BlockId; error: string }[] = [];

  for (const id of ids) {
    try {
      const dbItem = await getBlockDBItem(id);
      if (dbItem == null) {
        throw new Error('Invalid block ID. Please check if the ID exists and is correct.');
      }
      if (dbItem.type === 'd') {
        throw new Error('Document blocks cannot be moved using this tool. Please use siyuan_move_docs_by_ids instead.');
      }
      if (await filterBlock(id, dbItem)) {
        throw new Error('This block is excluded by user settings. Cannot write or read.');
      }
      // List container check only applies when using parentId (first block only;
      // subsequent blocks chain via currentPreviousId so resolvedParentId becomes undefined)
      if (resolvedParentId && parentBlockType === 'l' && dbItem.type !== 'i') {
        throw new Error('Can only move list item blocks under a list block. Please choose a valid list item block to move.');
      }

      const needFold = moveWithSubBlocks && dbItem.type === 'h';
      if (needFold) await foldBlockAPI(id);
      try {
        await moveBlockAPI(id, resolvedParentId, currentPreviousId);
      } finally {
        if (needFold) await unfoldBlockAPI(id);
      }

      // Chain: subsequent blocks go after the just-moved block
      currentPreviousId = id;
      resolvedParentId = undefined;
      moved.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const result = { moved, ...(failed.length > 0 && { failed }) };
  if (failed.length > 0) {
    return createErrorResponse(`Failed to move ${failed.length} of ${ids.length} blocks`, result);
  }
  return createJsonResponse(result);
}
