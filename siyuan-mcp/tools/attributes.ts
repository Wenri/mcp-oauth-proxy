/**
 * Block attributes tools
 * Unchanged from upstream - no browser dependencies
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { addblockAttrAPI, getblockAttr, batchSetBlockAttrs } from '../syapi';
import { getBlockDBItem } from '../syapi/custom';
import { McpToolsProvider } from './baseToolProvider';
import { isValidStr } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { filterBlock } from '../utils/filterCheck';

export class AttributeToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_set_block_attributes',
        description:
          "Set, update, or delete attributes for a specific block. To delete an attribute, set its value to an empty string.",
        schema: {
          blockId: z.string().describe('The ID of the block to modify.'),
          attributes: z
            .record(z.string())
            .describe(
              "An object of key-value pairs representing the attributes to set. Setting an attribute to an empty string ('') will delete it."
            ),
        },
        handler: setBlockAttributesHandler,
        title: lang('tool_title_set_block_attributes'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_get_block_attributes',
        description: 'Get all attributes of a specific block.',
        schema: {
          blockId: z.string().describe('The ID of the block to get attributes from.'),
        },
        handler: getBlockAttributesHandler,
        title: lang('tool_title_get_block_attributes'),
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: 'siyuan_batch_set_attributes',
        description:
          'Set attributes on multiple blocks at once. More efficient than calling set_block_attributes multiple times.',
        schema: {
          blocks: z
            .array(
              z.object({
                id: z.string().describe('The block ID'),
                attrs: z.record(z.string()).describe('Attributes to set on this block'),
              })
            )
            .describe('Array of blocks with their attributes to set'),
        },
        handler: batchSetAttributesHandler,
        title: lang('tool_title_batch_set_attributes'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
    ];
  }
}

async function setBlockAttributesHandler(params: { blockId: string; attributes: Record<string, string> }) {
  const { blockId, attributes } = params;

  if (!isValidStr(blockId)) {
    return createErrorResponse('blockId cannot be empty.');
  }

  const dbItem = await getBlockDBItem(blockId);
  if (dbItem == null) {
    return createErrorResponse('Invalid document or block ID. Please check if the ID exists and is correct.');
  }

  if (await filterBlock(blockId, dbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }

  if (typeof attributes !== 'object' || attributes === null) {
    return createErrorResponse('attributes must be an object.');
  }

  const allowedNonCustomKeys = ['name', 'alias', 'memo', 'bookmark'];
  const customKeyRegex = /^[a-zA-Z0-9]+$/;

  for (const key in attributes) {
    if (key.startsWith('custom-')) {
      const customPart = key.substring('custom-'.length);
      if (!customKeyRegex.test(customPart)) {
        return createErrorResponse(
          `Invalid custom attribute name: '${key}'. The part after 'custom-' must only contain letters and(or) numbers.`
        );
      }
    } else if (!allowedNonCustomKeys.includes(key)) {
      return createErrorResponse(
        `Invalid attribute name: '${key}'. Attribute names must start with 'custom-' or be one of the following: ${allowedNonCustomKeys.join(', ')}.`
      );
    }
    if (typeof attributes[key] !== 'string') {
      return createErrorResponse(`Invalid value for attribute '${key}'. Attribute values must be strings.`);
    }
  }

  try {
    const result = await addblockAttrAPI(attributes, blockId);
    if (result === 0) {
      return createSuccessResponse('Attributes updated successfully.');
    } else {
      return createErrorResponse('Failed to update attributes.');
    }
  } catch (error: any) {
    return createErrorResponse(`An error occurred: ${error.message}`);
  }
}

async function getBlockAttributesHandler(params: { blockId: string }) {
  const { blockId } = params;

  if (!isValidStr(blockId)) {
    return createErrorResponse('blockId cannot be empty.');
  }

  const dbItem = await getBlockDBItem(blockId);
  if (dbItem == null) {
    return createErrorResponse('Invalid document or block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(blockId, dbItem)) {
    return createErrorResponse("The specified block is excluded by the user settings. Can't read or write.");
  }

  try {
    const attributes = await getblockAttr(blockId);
    return createJsonResponse(attributes ?? {});
  } catch (error: any) {
    return createErrorResponse(`An error occurred: ${error.message}`);
  }
}

async function batchSetAttributesHandler(params: { blocks: { id: string; attrs: Record<string, string> }[] }) {
  const { blocks } = params;

  if (!blocks || blocks.length === 0) {
    return createErrorResponse('blocks array cannot be empty.');
  }

  // Validate all blocks first
  for (const block of blocks) {
    if (!isValidStr(block.id)) {
      return createErrorResponse('Each block must have a valid id.');
    }
    const dbItem = await getBlockDBItem(block.id);
    if (dbItem == null) {
      return createErrorResponse(`Block "${block.id}" does not exist.`);
    }
    if (await filterBlock(block.id, dbItem)) {
      return createErrorResponse(`Block "${block.id}" is excluded by user settings.`);
    }
  }

  // Format for batchSetBlockAttrs API: JSON string of array
  // Each item: { id: string, attrs: Record<string, string> }
  const blockAttrs = JSON.stringify(blocks);

  try {
    const result = await batchSetBlockAttrs(blockAttrs);
    if (result !== null) {
      return createSuccessResponse(`Successfully updated attributes for ${blocks.length} block(s).`);
    } else {
      return createErrorResponse('Failed to batch update attributes.');
    }
  } catch (error: any) {
    return createErrorResponse(`An error occurred: ${error.message}`);
  }
}
