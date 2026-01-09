/**
 * Block attributes tools
 * Unchanged from upstream - no browser dependencies
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { addblockAttrAPI, getblockAttr, batchSetBlockAttrs } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { isValidStr, assertNonEmptyArray } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { validateBlockAccess } from '../utils/resultFilter';

const ALLOWED_NON_CUSTOM_KEYS = ['name', 'alias', 'memo', 'bookmark'];
const CUSTOM_KEY_REGEX = /^[a-zA-Z0-9]+$/;

function validateAttributeKeys(attributes: BlockAttrs, blockId?: string): void {
  for (const key in attributes) {
    if (key.startsWith('custom-')) {
      const customPart = key.substring('custom-'.length);
      if (!CUSTOM_KEY_REGEX.test(customPart)) {
        const prefix = blockId ? `Block ${blockId}: ` : '';
        throw new Error(
          `${prefix}Invalid custom attribute name: '${key}'. The part after 'custom-' must only contain letters and(or) numbers.`
        );
      }
    } else if (!ALLOWED_NON_CUSTOM_KEYS.includes(key)) {
      const prefix = blockId ? `Block ${blockId}: ` : '';
      throw new Error(
        `${prefix}Invalid attribute name: '${key}'. Attribute names must start with 'custom-' or be one of: ${ALLOWED_NON_CUSTOM_KEYS.join(', ')}.`
      );
    }
    if (typeof attributes[key] !== 'string') {
      const prefix = blockId ? `Block ${blockId}: ` : '';
      throw new Error(`${prefix}Invalid value for attribute '${key}'. Attribute values must be strings.`);
    }
  }
}

export class AttributeToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
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
      }),
      defineTool({
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
      }),
      defineTool({
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
        outputSchema: z.object({
          updated: z.array(z.string()).describe('Block IDs successfully updated'),
          failed: z.array(z.object({
            id: z.string().describe('Block ID that failed'),
            error: z.string().describe('Error reason'),
          })).optional().describe('Blocks that failed to update with error details'),
        }),
        handler: batchSetAttributesHandler,
        title: lang('tool_title_batch_set_attributes'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      }),
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

  validateAttributeKeys(attributes);

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

  const updated: BlockId[] = [];
  const failed: { id: BlockId; error: string }[] = [];
  const validBlocks: { id: BlockId; attrs: BlockAttrs }[] = [];

  // Validate all blocks first, collecting errors
  for (const block of blocks) {
    try {
      if (!isValidStr(block.id)) {
        throw new Error('Block ID cannot be empty.');
      }
      await validateBlockAccess(block.id);
      validateAttributeKeys(block.attrs, block.id);
      validBlocks.push(block);
    } catch (e) {
      failed.push({ id: block.id || '(empty)', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Call API with valid blocks only
  if (validBlocks.length > 0) {
    try {
      await batchSetBlockAttrs(validBlocks);
      updated.push(...validBlocks.map(b => b.id));
    } catch (e) {
      // API failed - mark all valid blocks as failed
      for (const block of validBlocks) {
        failed.push({ id: block.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const result = {
    updated,
    ...(failed.length > 0 && { failed }),
  };

  if (failed.length > 0) {
    const errorMsg = `Failed to update ${failed.length} of ${blocks.length} blocks`;
    return createErrorResponse(errorMsg, result);
  }

  return createJsonResponse(result);
}
