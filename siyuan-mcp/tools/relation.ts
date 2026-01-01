/**
 * Relation tools for document/block relationships
 * Unchanged from upstream - no browser dependencies
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { getBackLink2T, getChildBlocks, getNodebookList, listDocsByPathT } from '../syapi';
import { McpToolsProvider, McpTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { getBlockDBItem, getDocDBitem } from '../syapi/custom';
import { filterBlock } from '../utils/filterCheck';

export class RelationToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_get_doc_backlinks',
        description:
          "Retrieve all documents or blocks that reference a specified document or block within the workspace. The result includes the referencing document's ID, name, notebook ID, and path. Useful for understanding backlinks and document relationships within the knowledge base.",
        schema: {
          id: z
            .string()
            .describe(
              'The ID of the target document or block. The notebook where the target resides must be open.'
            ),
        },
        handler: getDocBacklink,
        title: 'Get Note Relationship',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_list_sub_docs',
        description:
          'Retrieve the basic information of sub-documents under a specified document within the SiYuan workspace. Useful for analyzing document structure and hierarchy relationships.',
        schema: {
          id: z
            .string()
            .describe(
              'The ID of the parent document or notebook. The notebook containing this document must be open.'
            ),
        },
        handler: getChildrenDocs,
        title: 'Get Sub-Document Information',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_get_children_blocks',
        description:
          'Get all child blocks under a parent block by its ID. This includes directly nested blocks and blocks under headings. Long block content will be abbreviated. Useful for understanding block hierarchy and content organization.',
        schema: {
          id: z.string().describe('The unique identifier (ID) of the parent block.'),
        },
        handler: getChildBlocksTool,
        title: 'Get Child Blocks',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    ];
  }
}

async function getDocBacklink(params: { id: string }) {
  const { id } = params;

  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse(
      'Invalid document or block ID. Please check if the ID exists and is correct.'
    );
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse(
      'The specified document or block is excluded by the user settings. So cannot write or read.'
    );
  }

  const backlinkResponse = await getBackLink2T(id, '3');
  debugPush('backlinkResponse', backlinkResponse);

  if (backlinkResponse.backlinks.length == 0) {
    return createSuccessResponse('No documents or blocks referencing the specified ID were found.');
  }

  const result: any[] = [];
  for (let i = 0; i < backlinkResponse.backlinks.length; i++) {
    const oneBacklinkItem = backlinkResponse.backlinks[i];
    if (oneBacklinkItem.nodeType === 'NodeDocument') {
      const tempDocItem = {
        name: oneBacklinkItem.name,
        id: oneBacklinkItem.id,
        notebookId: oneBacklinkItem.box,
        hpath: oneBacklinkItem.hpath,
      };
      result.push(tempDocItem);
    }
  }

  return createJsonResponse(result);
}

async function getChildrenDocs(params: { id: string }) {
  const { id } = params;

  const notebookList = await getNodebookList();
  const notebookIds = notebookList.map((item: any) => item.id);
  const sqlResult = await getDocDBitem(id);

  if (await filterBlock(id, sqlResult)) {
    return createErrorResponse(
      'The specified document or block is excluded by the user settings. So cannot write or read.'
    );
  }

  let result = null;
  if (sqlResult == null && !notebookIds.includes(id)) {
    return createErrorResponse(
      'The queried ID does not exist, or does not correspond to a document or notebook. Please check if the ID is correct.'
    );
  } else if (sqlResult == null) {
    // It's a notebook ID
    result = await listDocsByPathT({ notebook: id, path: '/' });
  } else {
    result = await listDocsByPathT({ notebook: sqlResult['box'], path: sqlResult['path'] });
  }

  return createJsonResponse(result);
}

async function getChildBlocksTool(params: { id: string }) {
  const { id } = params;

  const sqlResult = await getBlockDBItem(id);
  if (sqlResult == null) {
    return createErrorResponse(
      'Invalid document or block ID. Please check if the ID exists and is correct.'
    );
  }
  if (await filterBlock(id, sqlResult)) {
    return createErrorResponse(
      'The specified document or block is excluded by the user settings. So cannot write or read.'
    );
  }

  return createJsonResponse(await getChildBlocks(id));
}
