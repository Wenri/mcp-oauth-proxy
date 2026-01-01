/**
 * Document reading tools
 * Adapted from upstream to use platform abstraction
 *
 * CHANGE FROM UPSTREAM: Uses getPlatformContext().config instead of window.siyuan.config
 */

import { z } from 'zod';
import { McpToolsProvider, McpTool } from './baseToolProvider';
import { exportMdContent, getKramdown, queryAPI } from '../syapi';
import { createErrorResponse, createSuccessResponse } from '../utils/mcpResponse';
import { isValidStr } from '../utils/commonCheck';
import { getPlatformContext } from '../platform';

export class DocReadToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_read_doc_content_markdown',
        description: 'Retrieve the content of a document or block by its ID',
        schema: {
          id: z.string().describe('The unique identifier of the document or block'),
          offset: z
            .number()
            .default(0)
            .describe('The starting character offset for partial content reading'),
          limit: z
            .number()
            .default(10000)
            .describe('The maximum number of characters to return'),
        },
        handler: docReadHandler,
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_block_kramdown',
        description:
          'Get block content in Kramdown format, preserving all formatting including colors, attributes, and IDs.',
        schema: {
          id: z.string().describe('The unique identifier of the block'),
        },
        handler: kramdownReadHandler,
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

async function docReadHandler(params: { id: string; offset: number; limit: number }) {
  const { id, offset, limit } = params;

  // Get block info from database
  const dbResult = await queryAPI(`SELECT * FROM blocks WHERE id = '${id}'`);
  if (dbResult.length === 0) {
    return createErrorResponse(`Block not found: ${id}`);
  }
  const dbItem = dbResult[0];

  // Export markdown content
  const markdown = await exportMdContent({ id, refMode: 4, embedMode: 1, yfm: false });

  // PLATFORM CHANGE: Use getPlatformContext() instead of window.siyuan.config
  const ctx = getPlatformContext();
  if (dbItem.type !== 'd' && isValidStr(markdown['content']) && ctx.config.export.addTitle) {
    // Strip title from non-document blocks if addTitle is enabled
    markdown['content'] = markdown['content'].replace(/^#{1,6}\s+.*\n?/, '');
  }

  let content = markdown['content'] || '';

  // Handle pagination
  if (offset > 0 || limit < content.length) {
    content = content.slice(offset, offset + limit);
  }

  return createSuccessResponse(content);
}

async function kramdownReadHandler(params: { id: string }) {
  const { id } = params;

  const kramdown = await getKramdown(id, true);
  if (!kramdown) {
    return createErrorResponse(`Failed to get kramdown for block: ${id}`);
  }

  return createSuccessResponse(kramdown);
}
