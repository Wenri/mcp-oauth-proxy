/**
 * Relation tools for document/block relationships
 */

import { z } from 'zod';
import { createArrayResponse } from '../utils/mcpResponse';
import { getBackLink2T, getChildBlocks, getNodebookList, listDocsByPathT } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { getDocDBitem, resolveIdOrHPath } from '../syapi/custom';
import { validateBlockAccess } from '../utils/resultFilter';
import { filterBlock } from '../utils/filterCheck';

export class RelationToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_get_doc_backlinks',
        description:
          "Retrieve all documents or blocks that reference a specified document or block within the workspace. The result includes the referencing document's ID, name, notebook ID, and path. Useful for understanding backlinks and document relationships within the knowledge base.",
        inputSchema: z.object({
          id: z
            .string()
            .describe(
              'The ID of the target document or block. The notebook where the target resides must be open.'
            ),
        }),
        outputSchema: z.object({
          count: z.number().describe('Number of backlinks found'),
          backlinks: z
            .array(
              z.object({
                id: z.string().describe('Document ID'),
                name: z.string().describe('Document name'),
                notebookId: z.string().describe('Notebook ID containing the document'),
                hpath: z.string().describe('Human-readable path'),
              })
            )
            .describe('Array of documents that reference the specified ID'),
        }),
        handler: getDocBacklink,
        title: 'Get Note Relationship',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_list_sub_docs',
        description:
          'Retrieve the basic information of sub-documents under a specified document within the SiYuan workspace. Useful for analyzing document structure and hierarchy relationships.',
        inputSchema: z.object({
          id: z
            .string()
            .describe(
              'Document/notebook ID or hpath (e.g., "20241231-abc" or "/NotebookName" or "/NotebookName/Doc"). The notebook must be open.'
            ),
        }),
        outputSchema: z.object({
          count: z.number().describe('Number of sub-documents found'),
          docs: z
            .array(
              z.object({
                path: z.string().describe('Document path'),
                name: z.string().describe('Document title'),
                icon: z.string().describe('Document icon'),
                id: z.string().describe('Document block ID'),
                count: z.number().describe('Reference count (backlinks)'),
                size: z.number().describe('File size in bytes'),
                hSize: z.string().describe('Human-readable file size'),
                mtime: z.number().describe('Modification time (Unix timestamp)'),
                ctime: z.number().describe('Creation time (Unix timestamp)'),
                hMtime: z.string().describe('Human-readable modification time'),
                hCtime: z.string().describe('Human-readable creation time'),
                sort: z.number().describe('Custom sort order'),
                subFileCount: z.number().describe('Count of sub-documents'),
              })
            )
            .describe('Array of sub-document metadata'),
        }),
        handler: getChildrenDocs,
        title: 'Get Sub-Document Information',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_get_children_blocks',
        description:
          'Get all child blocks under a parent block by its ID. This includes directly nested blocks and blocks under headings. Long block content will be abbreviated. Useful for understanding block hierarchy and content organization.',
        inputSchema: z.object({
          id: z.string().describe('The unique identifier (ID) of the parent block.'),
        }),
        outputSchema: z.object({
          count: z.number().describe('Number of child blocks'),
          blocks: z
            .array(
              z.object({
                id: z.string().describe('Block ID'),
                type: z.string().describe('Block type (p, h, l, ul, ol, etc.)'),
                subType: z.string().optional().describe('Block subtype'),
                content: z.string().optional().describe('HTML content'),
                markdown: z.string().optional().describe('Markdown content'),
              })
            )
            .describe('Array of child block metadata'),
        }),
        handler: getChildBlocksTool,
        title: 'Get Child Blocks',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
    ];
  }
}

async function getDocBacklink(params: { id: string }) {
  const { id } = params;

  await validateBlockAccess(id);

  const backlinkResponse = await getBackLink2T(id, '3');
  debugPush('backlinkResponse', backlinkResponse);

  if (backlinkResponse.backlinks.length == 0) {
    return createArrayResponse([], 'backlinks');
  }

  const result: { name: string; id: BlockId; notebookId: NotebookId; hpath: string }[] = [];
  for (let i = 0; i < backlinkResponse.backlinks.length; i++) {
    const oneBacklinkItem = backlinkResponse.backlinks[i];
    if (oneBacklinkItem.nodeType === 'NodeDocument') {
      const tempDocItem = {
        name: oneBacklinkItem.name,
        id: oneBacklinkItem.id,
        notebookId: oneBacklinkItem.box,
        hpath: oneBacklinkItem.hPath,
      };
      result.push(tempDocItem);
    }
  }

  return createArrayResponse(result, 'backlinks');
}

async function getChildrenDocs(params: { id: string }) {
  const { id: input } = params;

  const notebookList = await getNodebookList();
  const notebookIds = notebookList.map((item) => item.id);

  // Resolve hpath to ID if needed (e.g., "/NotebookName" or "/NotebookName/Doc")
  const resolvedId = await resolveIdOrHPath(input);
  if (!resolvedId) {
    throw new Error(
      `Invalid ID or path: "${input}". Provide a valid document/notebook ID or hpath like "/NotebookName" or "/NotebookName/Doc".`
    );
  }

  const sqlResult = await getDocDBitem(resolvedId);

  if (sqlResult && await filterBlock(resolvedId, sqlResult)) {
    throw new Error(
      'The specified document or block is excluded by the user settings. So cannot write or read.'
    );
  }

  let result: IFile[] = [];
  if (sqlResult == null && !notebookIds.includes(resolvedId)) {
    throw new Error(
      'The queried ID does not exist, or does not correspond to a document or notebook. Please check if the ID is correct.'
    );
  } else if (sqlResult == null) {
    // It's a notebook ID - list root documents
    result = await listDocsByPathT({ notebook: resolvedId, path: '/' });
  } else {
    // It's a document - list subdocuments from the document's directory
    // Document path is like /20241231-abc.sy, subdocs are in /20241231-abc/
    // Remove .sy extension to get the directory path for child documents
    const docDirPath = sqlResult['path'].replace(/\.sy$/, '');
    result = await listDocsByPathT({ notebook: sqlResult['box'], path: docDirPath });
  }

  // Sanitize result to ensure JSON-serializable (remove any unexpected properties)
  const sanitizedDocs = result.map((doc) => ({
    path: doc.path ?? '',
    name: doc.name ?? '',
    icon: doc.icon ?? '',
    id: doc.id ?? '',
    count: doc.count ?? 0,
    size: doc.size ?? 0,
    hSize: doc.hSize ?? '',
    mtime: doc.mtime ?? 0,
    ctime: doc.ctime ?? 0,
    hMtime: doc.hMtime ?? '',
    hCtime: doc.hCtime ?? '',
    sort: doc.sort ?? 0,
    subFileCount: doc.subFileCount ?? 0,
  }));

  return createArrayResponse(sanitizedDocs, 'docs');
}

async function getChildBlocksTool(params: { id: string }) {
  const { id } = params;

  await validateBlockAccess(id);

  return createArrayResponse(await getChildBlocks(id), 'blocks');
}
