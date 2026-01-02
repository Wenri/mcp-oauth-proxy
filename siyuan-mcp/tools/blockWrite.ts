/**
 * Block write tools
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { appendBlockAPI, insertBlockOriginAPI, prependBlockAPI, updateBlockAPI, removeBlockAPI, moveBlockAPI, foldBlockAPI, unfoldBlockAPI } from '../syapi';
import { checkIdValid, getBlockDBItem } from '../syapi/custom';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { isCurrentVersionLessThan, isNonContainerBlockType, isValidNotebookId, isValidStr } from '../utils/commonCheck';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { extractNodeParagraphIds } from '../utils/common';
import { filterBlock } from '../utils/filterCheck';
import { getConfig } from '..';

export class BlockWriteToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_insert_block',
        description:
          'Insert a new block at a specified position. Content must be in markdown format. Position is anchored by one of: `nextID` (ID of block after), `previousID` (ID of block before), or `parentID` (parent block ID). `nextID` has highest priority.',
        schema: {
          data: z.string().describe('The markdown content to insert'),
          nextID: z.string().optional().describe('ID of the block after the insertion point'),
          previousID: z.string().optional().describe('ID of the block before the insertion point'),
          parentID: z
            .string()
            .optional()
            .describe('ID of the parent block (must be a container block like quote or document)'),
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
        schema: {
          data: z.string().describe('The markdown content to insert'),
          parentID: z.string().describe('ID of the parent block (must be a container block)'),
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
        schema: {
          data: z.string().describe('The markdown content to insert'),
          parentID: z.string().describe('ID of the parent block (must be a container block)'),
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
        schema: {
          data: z.string().describe('The new content in Kramdown format'),
          id: z.string().describe('ID of the block to update'),
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
        schema: {
          id: z.string().describe('ID of the block to delete'),
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
        schema: {
          id: z.string().describe('ID of the block to move'),
          parentID: z.string().optional().describe('ID of the new parent block (must be a container block)'),
          previousID: z.string().optional().describe('ID of the block after which to place the moved block'),
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
        schema: {
          id: z.string().describe('ID of the block to fold'),
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
        schema: {
          id: z.string().describe('ID of the block to unfold'),
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
  nextID?: string;
  previousID?: string;
  parentID?: string;
}) {
  const { data, nextID, previousID, parentID } = params;
  debugPush('Insert block API called');

  if (
    (nextID && isValidNotebookId(nextID)) ||
    (previousID && isValidNotebookId(previousID)) ||
    (parentID && isValidNotebookId(parentID))
  ) {
    return createErrorResponse('nextID, previousID, and parentID must be block IDs, not notebook IDs.');
  }

  let anchorID: string | undefined;
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
    return createErrorResponse('Please provide one of nextID, previousID or parentID to anchor the insertion.');
  }

  checkIdValid(anchorID);
  const dbItem = await getBlockDBItem(anchorID);
  if (dbItem == null) {
    return createErrorResponse(`Invalid ${anchorType}: The specified block does not exist.`);
  }
  if (await filterBlock(anchorID, dbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }

  if (anchorType === 'parentID' && isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    return createErrorResponse('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const response = await insertBlockOriginAPI({ data, dataType: 'markdown', nextID, previousID, parentID });
  if (response == null) {
    return createErrorResponse('Failed to insert the block');
  }

  taskManager.insert(response[0].doOperations[0].id, data, 'insertBlock', { parentID }, TASK_STATUS.APPROVED);
  return createJsonResponse(response[0].doOperations[0]);
}

async function prependBlockHandler(params: { data: string; parentID: string }) {
  const { data, parentID } = params;
  debugPush('Prepend block API called');

  checkIdValid(parentID);
  if (isValidNotebookId(parentID)) {
    return createErrorResponse('parentID must be a block ID, not a notebook ID.');
  }

  const dbItem = await getBlockDBItem(parentID);
  if (dbItem == null) {
    return createErrorResponse('Invalid parentID: The specified parent block does not exist.');
  }
  if (await filterBlock(parentID, dbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }
  if (isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    return createErrorResponse('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const response = await prependBlockAPI(data, parentID);
  if (response == null) {
    return createErrorResponse('Failed to prepend the block');
  }

  taskManager.insert(response.id, data, 'prependBlock', { parentID }, TASK_STATUS.APPROVED);
  return createJsonResponse(response);
}

async function appendBlockHandler(params: { data: string; parentID: string }) {
  const { data, parentID } = params;
  debugPush('Append block API called');

  checkIdValid(parentID);
  if (isValidNotebookId(parentID)) {
    return createErrorResponse('parentID must be a block ID, not a notebook ID.');
  }

  const dbItem = await getBlockDBItem(parentID);
  if (dbItem == null) {
    return createErrorResponse('Invalid parentID: The specified parent block does not exist.');
  }
  if (await filterBlock(parentID, dbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }
  if (isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    return createErrorResponse('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  const result = await appendBlockAPI(data, parentID);
  if (result == null) {
    return createErrorResponse('Failed to append to the block');
  }

  const paragraphIds: string[] = [];
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

async function updateBlockHandler(params: { data: string; id: string }) {
  const { data, id } = params;

  checkIdValid(id);
  const blockDbItem = await getBlockDBItem(id);
  if (blockDbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, blockDbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }
  if (blockDbItem.type === 'av') {
    return createErrorResponse('Cannot update attribute view (i.e. Database) blocks.');
  }

  // In CF Worker, we auto-approve changes (no plugin UI for review)
  const config = getConfig();
  const autoApprove = config.autoApproveLocalChange !== false;

  if (autoApprove) {
    const response = await updateBlockAPI(data, id);
    if (response == null) {
      return createErrorResponse('Failed to update the block');
    }
    taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.APPROVED);
    return createSuccessResponse('Block updated successfully.');
  } else {
    taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.PENDING);
    return createSuccessResponse('Changes have entered the waiting queue, please remind users to review');
  }
}

async function deleteBlockHandler(params: { id: string }) {
  const { id } = params;
  debugPush('Delete block API called');

  checkIdValid(id);
  const blockDbItem = await getBlockDBItem(id);
  if (blockDbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, blockDbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }
  if (blockDbItem.type === 'd') {
    return createErrorResponse('Cannot delete document blocks. Use siyuan_remove_doc instead.');
  }

  const result = await removeBlockAPI(id);
  if (!result) {
    return createErrorResponse('Failed to delete the block');
  }

  taskManager.insert(id, '', 'deleteBlock', {}, TASK_STATUS.APPROVED);
  return createSuccessResponse('Block deleted successfully.');
}

async function moveBlockHandler(params: { id: string; parentID?: string; previousID?: string }) {
  const { id, parentID, previousID } = params;
  debugPush('Move block API called');

  if (!parentID && !previousID) {
    return createErrorResponse('Please provide either parentID or previousID to specify the target position.');
  }

  checkIdValid(id);
  const blockDbItem = await getBlockDBItem(id);
  if (blockDbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, blockDbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }

  // Validate target block exists
  if (previousID) {
    checkIdValid(previousID);
    const prevDbItem = await getBlockDBItem(previousID);
    if (prevDbItem == null) {
      return createErrorResponse('Invalid previousID: The specified block does not exist.');
    }
  }
  if (parentID && !previousID) {
    checkIdValid(parentID);
    const parentDbItem = await getBlockDBItem(parentID);
    if (parentDbItem == null) {
      return createErrorResponse('Invalid parentID: The specified block does not exist.');
    }
  }

  const result = await moveBlockAPI(id, parentID, previousID);
  if (!result) {
    return createErrorResponse('Failed to move the block');
  }

  return createSuccessResponse('Block moved successfully.');
}

async function foldBlockHandler(params: { id: string }) {
  const { id } = params;
  debugPush('Fold block API called');

  checkIdValid(id);
  const blockDbItem = await getBlockDBItem(id);
  if (blockDbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }

  const result = await foldBlockAPI(id);
  if (!result) {
    return createErrorResponse('Failed to fold the block');
  }

  return createSuccessResponse('Block folded successfully.');
}

async function unfoldBlockHandler(params: { id: string }) {
  const { id } = params;
  debugPush('Unfold block API called');

  checkIdValid(id);
  const blockDbItem = await getBlockDBItem(id);
  if (blockDbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }

  const result = await unfoldBlockAPI(id);
  if (!result) {
    return createErrorResponse('Failed to unfold the block');
  }

  return createSuccessResponse('Block unfolded successfully.');
}
