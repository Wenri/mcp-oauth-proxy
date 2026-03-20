/**
 * Block write tools
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { insertBlockOriginAPI, updateBlockAPI, removeBlockAPI, moveBlockAPI, foldBlockAPI, unfoldBlockAPI } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { isCurrentVersionLessThan, isNonContainerBlockType, isValidNotebookId, isValidStr, assertApiResult } from '../utils/commonCheck';
// DISABLED: taskManager causes race conditions in CF Workers
// import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { validateBlockAccess } from '../utils/resultFilter';
import { getConfig } from '../server';

export class BlockWriteToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_insert_block',
        description:
          'Insert a new block at a specified position. Content must be in markdown format. Position is anchored by one of: `nextID` (ID of block after), `previousID` (ID of block before), or `parentID` (parent block ID). `nextID` has highest priority.',
        inputSchema: z.object({
          data: z.string().describe('The markdown content to insert'),
          nextID: z.string().optional().describe('Block ID of the block after the insertion point'),
          previousID: z.string().optional().describe('Block ID of the block before the insertion point'),
          parentID: z
            .string()
            .optional()
            .describe('Block ID or document hpath of the parent (must be a container like document or quote)'),
        }),
        outputSchema: z.object({
          id: z.string().describe('ID of the newly inserted block'),
          action: z.string().describe('The operation action performed'),
          data: z.string().describe('The block data/content'),
          parentID: z.string().optional().describe('ID of the parent block'),
        }),
        handler: insertBlockHandler,
        title: lang('tool_title_insert_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_update_block',
        description:
          'Update an existing block\'s content by ID. Content must be in markdown format. Note: for container blocks (list, blockquote, super block), child block IDs will be regenerated. To preserve custom block attributes, append an IAL line at the end (e.g. `{: custom-foo="bar"}`); use `siyuan_get_block_kramdown` to read current content with attributes.',
        inputSchema: z.object({
          data: z.string().describe('The new content in markdown format. Optionally append a trailing IAL line (e.g. `{: custom-foo="bar"}`) to preserve custom attributes.'),
          id: z.string().describe('Block ID of the block to update'),
        }),
        handler: updateBlockHandler,
        title: lang('tool_title_update_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_fold_block',
        description: 'Fold (collapse) a block to hide its children. Works on headings and other container blocks.',
        inputSchema: z.object({
          id: z.string().describe('Block ID of the block to fold'),
        }),
        handler: foldBlockHandler,
        title: lang('tool_title_fold_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_unfold_block',
        description: 'Unfold (expand) a block to show its children.',
        inputSchema: z.object({
          id: z.string().describe('Block ID of the block to unfold'),
        }),
        handler: unfoldBlockHandler,
        title: lang('tool_title_unfold_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_delete_block',
        description: 'Delete one or more blocks by their IDs. This action is irreversible.',
        inputSchema: z.object({
          ids: z.array(z.string()).describe('Block ID(s) to delete'),
        }),
        outputSchema: z.object({
          deleted: z.array(z.string()).describe('Block IDs successfully deleted'),
          failed: z.array(z.object({
            id: z.string().describe('Block ID that failed'),
            error: z.string().describe('Error reason'),
          })).optional().describe('Blocks that failed to delete with error details'),
        }),
        handler: deleteBlocksHandler,
        title: lang('tool_title_delete_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_move_block',
        description:
          'Move one or more blocks to a new position. Blocks are moved in order, maintaining their relative sequence. Specify either parentID (to move as children) or previousID (to move after a specific block).',
        inputSchema: z.object({
          ids: z.array(z.string()).describe('Block ID(s) to move (in desired order)'),
          parentID: z.string().optional().describe('Block ID or hpath of the new parent container'),
          previousID: z.string().optional().describe('Block ID after which to place the first moved block'),
          moveWithSubBlocks: z.boolean().optional().default(false).describe('For heading blocks: fold before moving and unfold after, so sub-blocks move as a unit. Note: existing fold state will be lost.'),
        }),
        outputSchema: z.object({
          moved: z.array(z.string()).describe('Block IDs successfully moved'),
          failed: z.array(z.object({
            id: z.string().describe('Block ID that failed'),
            error: z.string().describe('Error reason'),
          })).optional().describe('Blocks that failed to move with error details'),
        }),
        handler: moveBlocksHandler,
        title: lang('tool_title_move_block'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
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
    (nextID && await isValidNotebookId(nextID)) ||
    (previousID && await isValidNotebookId(previousID)) ||
    (parentID && await isValidNotebookId(parentID))
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
  const resolvedId = dbItem.id; // Use resolved ID (handles hpath)

  if (anchorType === 'parentID' && isNonContainerBlockType(dbItem.type) && isCurrentVersionLessThan('3.3.3')) {
    throw new Error('Invalid parentID: Cannot insert a block under a non-container block.');
  }

  // Pass resolved ID to API (raw input might be hpath)
  const apiParams = {
    data,
    dataType: 'markdown' as const,
    nextID: anchorType === 'nextID' ? resolvedId : undefined,
    previousID: anchorType === 'previousID' ? resolvedId : undefined,
    parentID: anchorType === 'parentID' ? resolvedId : undefined,
  };

  const response = assertApiResult(
    await insertBlockOriginAPI(apiParams),
    'insert the block'
  );
  const op = response[0].doOperations[0];
  // Note: taskManager disabled for debugging intermittent "[object Object]" issue
  // taskManager.insert(op.id, data, 'insertBlock', { parentID: resolvedId }, TASK_STATUS.APPROVED);

  // Return only the fields defined in outputSchema (data may be object in API response)
  return createJsonResponse({
    id: op.id,
    action: op.action,
    data: typeof op.data === 'string' ? op.data : JSON.stringify(op.data),
    parentID: op.parentID || undefined,
  });
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
    // Note: taskManager disabled for debugging intermittent "[object Object]" issue
    // taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.APPROVED);
    return createSuccessResponse('Block updated');
  } else {
    // Note: taskManager disabled for debugging intermittent "[object Object]" issue
    // taskManager.insert(id, data, 'updateBlock', {}, TASK_STATUS.PENDING);
    return createSuccessResponse('Block update pending approval');
  }
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

async function deleteBlocksHandler(params: { ids: BlockId[] }) {
  const { ids } = params;
  debugPush('Delete blocks API called', ids.length);

  if (ids.length === 0) {
    return createJsonResponse({ deleted: [] });
  }

  const deleted: BlockId[] = [];
  const failed: { id: BlockId; error: string }[] = [];

  for (const id of ids) {
    try {
      const blockDbItem = await validateBlockAccess(id);

      if (blockDbItem.type === 'd') {
        failed.push({ id, error: 'Cannot delete document blocks. Use siyuan_remove_doc instead.' });
        continue;
      }

      assertApiResult(await removeBlockAPI(id), 'delete the block');
      deleted.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const result = {
    deleted,
    ...(failed.length > 0 && { failed }),
  };

  if (failed.length > 0) {
    const errorMsg = `Failed to delete ${failed.length} of ${ids.length} blocks`;
    return createErrorResponse(errorMsg, result);
  }

  return createJsonResponse(result);
}

async function moveBlocksHandler(params: { ids: BlockId[]; parentID?: BlockId; previousID?: BlockId; moveWithSubBlocks?: boolean }) {
  const { ids, parentID, previousID, moveWithSubBlocks } = params;
  debugPush('Move blocks API called', ids.length);

  if (ids.length === 0) {
    return createJsonResponse({ moved: [] });
  }

  if (!parentID && !previousID) {
    throw new Error('Please provide either parentID or previousID to specify the target position.');
  }

  // Resolve target IDs once
  let resolvedParentID: BlockId | undefined;
  let currentPreviousID: BlockId | undefined;

  if (previousID) {
    const prevDbItem = await validateBlockAccess(previousID);
    currentPreviousID = prevDbItem.id;
  }
  if (parentID && !previousID) {
    const parentDbItem = await validateBlockAccess(parentID);
    resolvedParentID = parentDbItem.id;
  }

  const moved: BlockId[] = [];
  const failed: { id: BlockId; error: string }[] = [];

  for (const id of ids) {
    try {
      const blockDbItem = await validateBlockAccess(id);
      const resolvedId = blockDbItem.id;
      const needFold = moveWithSubBlocks && blockDbItem.type === 'h';

      if (needFold) {
        await foldBlockAPI(resolvedId);
      }
      try {
        assertApiResult(
          await moveBlockAPI(resolvedId, resolvedParentID, currentPreviousID),
          'move the block'
        );
      } finally {
        if (needFold) {
          await unfoldBlockAPI(resolvedId);
        }
      }

      // Update previousID to the just-moved block for next iteration
      // This maintains the order of blocks in the array
      currentPreviousID = resolvedId;
      resolvedParentID = undefined; // Only use parentID for first block

      moved.push(id);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const result = {
    moved,
    ...(failed.length > 0 && { failed }),
  };

  if (failed.length > 0) {
    const errorMsg = `Failed to move ${failed.length} of ${ids.length} blocks`;
    return createErrorResponse(errorMsg, result);
  }

  return createJsonResponse(result);
}
