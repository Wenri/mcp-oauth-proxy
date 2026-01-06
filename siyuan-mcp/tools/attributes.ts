/**
 * Block attributes tools
 * Unchanged from upstream - no browser dependencies
 */

import { z } from 'zod';
import { createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { addblockAttrAPI, getblockAttr, batchSetBlockAttrs } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { isValidStr, assertNonEmptyArray } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { validateBlockAccess } from '../utils/resultFilter';

export class AttributeToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_set_block_attributes',
        description:
          "Set, update, or delete attributes for a specific block. To delete an attribute, set its value to an empty string.",
        inputSchema: z.object({
          blockId: z.string().describe('The ID of the block to modify.'),
          attributes: z
            .record(z.string(), z.string())
            .describe(
              "An object of key-value pairs representing the attributes to set. Setting an attribute to an empty string ('') will delete it."
            ),
        }),
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
        inputSchema: z.object({
          blockId: z.string().describe('The ID of the block to get attributes from.'),
        }),
        outputSchema: z.object({
          attributes: z.record(z.string(), z.string()).describe('Object of attribute key-value pairs'),
        }),
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
        inputSchema: z.object({
          blocks: z
            .array(
              z.object({
                id: z.string().describe('The block ID'),
                attrs: z.record(z.string(), z.string()).describe('Attributes to set on this block'),
              })
            )
            .describe('Array of blocks with their attributes to set'),
        }),
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

async function setBlockAttributesHandler(params: { blockId: BlockId; attributes: BlockAttrs }) {
  const { blockId, attributes } = params;

  if (!isValidStr(blockId)) {
    throw new Error('blockId cannot be empty.');
  }

  await validateBlockAccess(blockId);

  if (typeof attributes !== 'object' || attributes === null) {
    throw new Error('attributes must be an object.');
  }

  const allowedNonCustomKeys = ['name', 'alias', 'memo', 'bookmark'];
  const customKeyRegex = /^[a-zA-Z0-9]+$/;

  for (const key in attributes) {
    if (key.startsWith('custom-')) {
      const customPart = key.substring('custom-'.length);
      if (!customKeyRegex.test(customPart)) {
        throw new Error(
          `Invalid custom attribute name: '${key}'. The part after 'custom-' must only contain letters and(or) numbers.`
        );
      }
    } else if (!allowedNonCustomKeys.includes(key)) {
      throw new Error(
        `Invalid attribute name: '${key}'. Attribute names must start with 'custom-' or be one of the following: ${allowedNonCustomKeys.join(', ')}.`
      );
    }
    if (typeof attributes[key] !== 'string') {
      throw new Error(`Invalid value for attribute '${key}'. Attribute values must be strings.`);
    }
  }

  const result = await addblockAttrAPI(attributes, blockId);
  if (result === 0) {
    return createSuccessResponse('Attributes updated');
  } else {
    throw new Error('Failed to update attributes');
  }
}

async function getBlockAttributesHandler(params: { blockId: BlockId }) {
  const { blockId } = params;

  if (!isValidStr(blockId)) {
    throw new Error('blockId cannot be empty.');
  }

  await validateBlockAccess(blockId);

  const attributes = await getblockAttr(blockId);
  return createJsonResponse({ attributes: attributes ?? {} });
}

async function batchSetAttributesHandler(params: { blocks: { id: BlockId; attrs: BlockAttrs }[] }) {
  const { blocks } = params;

  assertNonEmptyArray(blocks, 'block');

  // Validate all blocks first
  for (const block of blocks) {
    if (!isValidStr(block.id)) {
      throw new Error('Each block must have a valid id.');
    }
    await validateBlockAccess(block.id);
  }

  // Format for batchSetBlockAttrs API: JSON string of array
  const blockAttrs = JSON.stringify(blocks);
  await batchSetBlockAttrs(blockAttrs);
  return createSuccessResponse(`Updated ${blocks.length} blocks`);
}
