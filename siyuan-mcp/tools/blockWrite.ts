/**
 * Block write tools
 */

import { z } from 'zod';
import { createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { appendBlockAPI, insertBlockOriginAPI, prependBlockAPI, updateBlockAPI, removeBlockAPI, moveBlockAPI, foldBlockAPI, unfoldBlockAPI } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { isCurrentVersionLessThan, isNonContainerBlockType, isValidNotebookId, isValidStr, assertApiResult } from '../utils/commonCheck';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { extractNodeParagraphIds } from '../utils/common';
import { validateBlockAccess } from '../utils/resultFilter';
import { getConfig } from '..';

export class BlockWriteToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_insert_block',
        description:
          'Insert a new block at a specified position. Content must be in markdown format. Position is anchored by one of: `nextID` (ID of block after), `previousID` (ID of block before), or `parentID` (parent block ID). `nextID` has highest priority.',
        inputSchema: {
          data: z.string().describe('The markdown content to insert'),
          nextID: z.string().optional().describe('Block ID of the block after the insertion point'),
          previousID: z.string().optional().describe('Block ID of the block before the insertion point'),
          parentID: z
            .string()
            .optional()
            .describe('Block ID or document hpath of the parent (must be a container like document or quote)'),
        },
        outputSchema: {
          id: z.string().describe('ID of the newly inserted block'),
          action: z.string().describe('The operation action performed'),
          data: z.string().describe('The block data/content'),
          parentID: z.string().optional().describe('ID of the parent block'),
        },
        handler: insertBlockHandler,
        title: lang('tool_title_insert_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_prepend_block',
        description:
          'Insert a new block at the beginning of a parent block\'s children. Content must be in markdown format.',
        inputSchema: {
          data: z.string().describe('The markdown content to insert'),
          parentID: z.string().describe('Block ID or hpath of the parent block (must be a container block)'),
        },
        outputSchema: {
          id: z.string().describe('ID of the newly inserted block'),
          action: z.string().describe('The operation action performed'),
          data: z.string().describe('The block data/content'),
          parentID: z.string().optional().describe('ID of the parent block'),
        },
        handler: prependBlockHandler,
        title: lang('tool_title_prepend_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_append_block',
        description:
          'Insert a new block at the end of a parent block\'s children. Content must be in markdown format.',
        inputSchema: {
          data: z.string().describe('The markdown content to insert'),
          parentID: z.string().describe('Block ID or hpath of the parent block (must be a container block)'),
        },
        outputSchema: {
          id: z.string().describe('ID of the newly inserted block'),
          action: z.string().describe('The operation action performed'),
          data: z.string().describe('The block data/content'),
          parentID: z.string().optional().describe('ID of the parent block'),
        },
        handler: appendBlockHandler,
        title: lang('tool_title_append_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_update_block',
        description:
          'Update an existing block\'s content by ID. Content should be in Kramdown format. Using markdown format will lose block attributes.',
        inputSchema: {
          data: z.string().describe('The new content in Kramdown format'),
          id: z.string().describe('Block ID of the block to update'),
        },
        handler: updateBlockHandler,
        title: lang('tool_title_update_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_delete_block',
        description: 'Delete a block by its ID. This action is irreversible.',
        inputSchema: {
          id: z.string().describe('Block ID of the block to delete'),
        },
        handler: deleteBlockHandler,
        title: lang('tool_title_delete_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_move_block',
        description:
          'Move a block to a new position. Specify either parentID (to move as child of a container) or previousID (to move after a specific block). If both are provided, previousID takes precedence.',
        inputSchema: {
          id: z.string().describe('Block ID of the block to move'),
          parentID: z.string().optional().describe('Block ID or document hpath of the new parent (must be a container)'),
          previousID: z.string().optional().describe('Block ID of the block after which to place the moved block'),
        },
        handler: moveBlockHandler,
        title: lang('tool_title_move_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_fold_block',
        description: 'Fold (collapse) a block to hide its children. Works on headings and other container blocks.',
        inputSchema: {
          id: z.string().describe('Block ID of the block to fold'),
        },
        handler: foldBlockHandler,
        title: lang('tool_title_fold_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_unfold_block',
        description: 'Unfold (expand) a block to show its children.',
        inputSchema: {
          id: z.string().describe('Block ID of the block to unfold'),
        },
        handler: unfoldBlockHandler,
        title: lang('tool_title_unfold_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    ];
  }
}

async function insertBlockHandler(params: {
  data: string;
  nextID?: BlockId;
  previousID?: BlockId;
  parentID?: BlockId;
}) {
  const { data, nextID, previousID, parentID } = params;
  debugPush('Insert block API called');

  if (
    (nextID && isValidNotebookId(nextID)) ||
    (previousID && isValidNotebookId(previousID)) ||
    (parentID && isValidNotebookId(parentID))
  ) {
    throw new Error('nextID, previousID, and parentID must be block IDs, not notebook IDs.');
  }

  let anchorID: BlockId | undefined;
  let anchorType: 'nextID' | 'previousID' | 'parentID' | undefined;

  if (isValidStr(nextID)) {
    anchorID = nextID;
    anchorType = 'nextID';
  } else if (isValidStr(previousID)) {
    anchorID = previousID;
    anchorType = 'previousID';
  } else if (isValidStr(parentID)) {
    anchorID = parentID;
    anchorType = 'parentID';
  }

  if (!anchorID) {
    throw new Error('Please provide one of nextID, previousID or parentID to anchor the insertion.');
  }

  const dbItem = await validateBlockAccess(anchorID);

  if (anchorType === 'parentID' && isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    throw new Error('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const response = assertApiResult(
    await insertBlockOriginAPI({ data, dataType: 'markdown', nextID, previousID, parentID }),
    'insert the block'
  );
  taskManager.insert(response[0].doOperations[0].id, data, 'insertBlock', { parentID }, TASK_STATUS.APPROVED);
  return createJsonResponse(response[0].doOperations[0]);
}

async function prependBlockHandler(params: { data: string; parentID: BlockId }) {
  const { data, parentID } = params;
  debugPush('Prepend block API called');

  if (isValidNotebookId(parentID)) {
    throw new Error('parentID must be a block ID, not a notebook ID.');
  }

  const dbItem = await validateBlockAccess(parentID);

  if (isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    throw new Error('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const response = assertApiResult(await prependBlockAPI(data, parentID), 'prepend the block');
  taskManager.insert(response.id, data, 'prependBlock', { parentID }, TASK_STATUS.APPROVED);
  return createJsonResponse(response);
}

async function appendBlockHandler(params: { data: string; parentID: BlockId }) {
  const { data, parentID } = params;
  debugPush('Append block API called');

  if (isValidNotebookId(parentID)) {
    throw new Error('parentID must be a block ID, not a notebook ID.');
  }

  const dbItem = await validateBlockAccess(parentID);

  if (isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    throw new Error('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const result = assertApiResult(await appendBlockAPI(data, parentID), 'append to the block');

  const paragraphIds: BlockId[] = [];
  if (dbItem.type === 'l') {
    const listItems = extractNodeParagraphIds(result.data);
    if (listItems.length > 0) {
      paragraphIds.push(...listItems);
    } else {
      paragraphIds.push(result.id);
    }
  } else {
    paragraphIds.push(result.id);
  }

  taskManager.insert(paragraphIds, data, 'appendBlock', { parentID }, TASK_STATUS.APPROVED);
  return createJsonResponse(result);
}

async function updateBlockHandler(params: { data: string; id: BlockId }) {
  const { data, id } = params;

  const blockDbItem = await validateBlockAccess(id);

  if (blockDbItem.type === 'av') {
    throw new Error('Cannot update attribute view (i.e. Database) blocks.');
  }

  // In CF Worker, we auto-approve changes (no plugin UI for review)
  const config = getConfig();
  const autoApprove = config.autoApproveLocalChange !== false;

  if (autoApprove) {
    assertApiResult(await updateBlockAPI(data, id), 'update the block');
    taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.APPROVED);
    return createSuccessResponse('Block updated');
  } else {
    taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.PENDING);
    return createSuccessResponse('Block update pending approval');
  }
}

async function deleteBlockHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Delete block API called');

  const blockDbItem = await validateBlockAccess(id);

  if (blockDbItem.type === 'd') {
    throw new Error('Cannot delete document blocks. Use siyuan_remove_doc instead.');
  }

  assertApiResult(await removeBlockAPI(id), 'delete the block');
  taskManager.insert(id, '', 'deleteBlock', {}, TASK_STATUS.APPROVED);
  return createSuccessResponse('Block deleted');
}

async function moveBlockHandler(params: { id: BlockId; parentID?: BlockId; previousID?: BlockId }) {
  const { id, parentID, previousID } = params;
  debugPush('Move block API called');

  if (!parentID && !previousID) {
    throw new Error('Please provide either parentID or previousID to specify the target position.');
  }

  await validateBlockAccess(id);

  // Validate target block exists
  if (previousID) {
    await validateBlockAccess(previousID);
  }
  if (parentID && !previousID) {
    await validateBlockAccess(parentID);
  }

  assertApiResult(await moveBlockAPI(id, parentID, previousID), 'move the block');
  return createSuccessResponse('Block moved');
}

async function foldBlockHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Fold block API called');

  await validateBlockAccess(id);
  assertApiResult(await foldBlockAPI(id), 'fold the block');
  return createSuccessResponse('Block folded');
}

async function unfoldBlockHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Unfold block API called');

  await validateBlockAccess(id);
  assertApiResult(await unfoldBlockAPI(id), 'unfold the block');
  return createSuccessResponse('Block unfolded');
}
