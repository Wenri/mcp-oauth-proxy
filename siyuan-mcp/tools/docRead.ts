/**
 * Document reading tools
 */

import { z } from 'zod';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { exportMdContent, getKramdown, getFileAPIv2, getHPathByIDAPI, getDocOutlineAPI, getDocPreview } from '../syapi';
import { createJsonResponse, createResourceLink, blobToContentBlockWithLimit, MAX_INLINE_ASSET_SIZE } from '../utils/mcpResponse';
import { isValidStr, extractDocumentId, assertApiResult } from '../utils/commonCheck';
import { getEffectiveMimeType } from '../utils/contentType';
import { getConfig } from '..';
import { getBlockAssets } from '../syapi/custom';
import { validateBlockAccess } from '../utils/resultFilter';
import { debugPush, errorPush, logPush } from '../logger';
import { lang } from '../utils/lang';

// Recursive schema for outline - matches kernel's OutlineBlock structure
// Note: children can be null when there are no child blocks
const outlineBlockSchema: z.ZodType<OutlineBlock> = z.lazy(() =>
  z.object({
    id: z.string().describe('Block ID'),
    rootID: z.string().describe('Document ID this block belongs to'),
    box: z.string().describe('Notebook ID'),
    path: z.string().describe('File path within notebook'),
    content: z.string().describe('Heading text content'),
    type: z.string().describe('Block type (e.g., "h" for heading)'),
    subType: z.string().describe('Block subtype (e.g., "h1", "h2")'),
    depth: z.number().describe('Heading depth level'),
    count: z.number().describe('Child block count'),
    folded: z.boolean().describe('Whether the block is folded in UI'),
    children: z.array(outlineBlockSchema).nullable().describe('Nested heading blocks (null if none)'),
  })
);

// Recursive schema for outline path - matches kernel's Path struct
// Note: blocks and children have omitempty in kernel, so they're optional
const outlinePathSchema: z.ZodType<OutlinePath> = z.lazy(() =>
  z.object({
    id: z.string().describe('Block/Document ID'),
    box: z.string().describe('Notebook ID'),
    name: z.string().describe('Display name'),
    hPath: z.string().describe('Human-readable path'),
    type: z.string().describe('Block type'),
    nodeType: z.string().describe('Node type'),
    subType: z.string().describe('Block subtype'),
    blocks: z.array(outlineBlockSchema).optional().describe('Heading blocks within this path'),
    children: z.array(outlinePathSchema).optional().describe('Nested outline paths'),
    depth: z.number().describe('Depth level'),
    count: z.number().describe('Child count'),
    folded: z.boolean().describe('Whether folded in UI'),
    updated: z.string().describe('Last updated timestamp'),
    created: z.string().describe('Creation timestamp'),
  })
);

export class DocReadToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_read_doc_content_markdown',
        description: 'Retrieve the content of a document or block by its ID or path',
        inputSchema: z.object({
          id: z.string().describe('Block ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
          offset: z
            .number()
            .optional()
            .describe('Starting character offset for partial reading (default: 0)'),
          limit: z
            .number()
            .optional()
            .describe('Maximum characters to return (default: unlimited)'),
          refMode: z
            .enum(['link', 'text', 'footnote'])
            .optional()
            .describe(
              'Block reference export mode: "footnote"=footnotes with anchor hash (default), "text"=anchor text only, "link"=siyuan:// protocol link'
            ),
          embedMode: z
            .enum(['original', 'blockquote'])
            .optional()
            .describe('Block embed export mode: "blockquote"=as blockquote (default), "original"=original text'),
          yfm: z
            .boolean()
            .optional()
            .describe('Include YAML front matter with document attributes (default: false)'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The resolved block/document ID'),
          content: z.string().describe('The markdown content (sliced if offset/limit provided)'),
          offset: z.number().describe('The starting offset used'),
          hasMore: z.boolean().describe('Whether there is more content beyond the current slice'),
          totalLength: z.number().describe('Total length of the full content in characters'),
        }),
        handler: blockReadHandler,
        title: lang('tool_title_read_doc_content_markdown'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_get_block_kramdown',
        description:
          'Get block content in Kramdown format from SiYuan. Unlike plain text, Kramdown preserves all rich formatting including colors, attributes, and IDs. Use this tool before modifying blocks to ensure formatting is preserved.',
        inputSchema: z.object({
          id: z.string().describe('Block ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
          offset: z
            .number()
            .optional()
            .describe('Starting character offset for partial reading (default: 0)'),
          limit: z
            .number()
            .optional()
            .describe('Maximum characters to return (default: unlimited)'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The resolved block/document ID'),
          kramdown: z.string().describe('Block content in Kramdown format (Markdown with IAL attributes like {: id="..." })'),
          offset: z.number().describe('The starting offset used'),
          hasMore: z.boolean().describe('Whether there is more content beyond the current slice'),
          totalLength: z.number().describe('Total length of the full content in characters'),
        }),
        handler: kramdownReadHandler,
        title: lang('tool_title_get_block_kramdown'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_get_hpath',
        description:
          'Get the human-readable path (hpath) for a document or block. Optionally includes document outline for context.',
        inputSchema: z.object({
          id: z.string().describe('Block ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
          includeOutline: z.boolean().optional().describe('If true, also returns the document outline/TOC'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The block/document ID'),
          hpath: z.string().describe('Human-readable path (e.g., "/Notebook/Parent Doc/Child Doc")'),
          outline: z.array(outlinePathSchema).optional().describe('Document outline/TOC if includeOutline was true'),
        }),
        handler: getHPathHandler,
        title: lang('tool_title_get_hpath'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_get_doc_outline',
        description:
          'Get the outline (table of contents) of a document. Returns headings hierarchy which helps understand document structure.',
        inputSchema: z.object({
          id: z.string().describe('Document ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The document ID'),
          outline: z.array(outlinePathSchema).describe('Hierarchical outline with headings'),
        }),
        handler: getDocOutlineHandler,
        title: lang('tool_title_get_doc_outline'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_export_html',
        description:
          'Export a document as HTML. Useful for getting a rendered preview of the document content.',
        inputSchema: z.object({
          id: z.string().describe('Document ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
          offset: z
            .number()
            .optional()
            .describe('Starting character offset for partial reading (default: 0)'),
          limit: z
            .number()
            .optional()
            .describe('Maximum characters to return (default: unlimited)'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The document ID'),
          html: z.string().describe('The rendered HTML content (sliced if offset/limit provided)'),
          offset: z.number().describe('The starting offset used'),
          hasMore: z.boolean().describe('Whether there is more content beyond the current slice'),
          totalLength: z.number().describe('Total length of the full HTML in characters'),
        }),
        handler: exportHtmlHandler,
        title: lang('tool_title_export_html'),
        annotations: { readOnlyHint: true },
      }),
    ];
  }
}

// Map enum values to kernel numeric values
const REF_MODE_MAP = { link: 2, text: 3, footnote: 4 } as const;
const EMBED_MODE_MAP = { original: 0, blockquote: 1 } as const;

async function blockReadHandler(params: {
  id: BlockId;
  offset?: number;
  limit?: number;
  refMode?: 'link' | 'text' | 'footnote';
  embedMode?: 'original' | 'blockquote';
  yfm?: boolean;
}) {
  const { id, offset = 0, limit, refMode = 'footnote', embedMode = 'blockquote', yfm = false } = params;
  debugPush('Reading document content');

  const dbItem = await validateBlockAccess(id);
  const resolvedId = dbItem.id; // Use resolved ID (handles hpath)

  let otherImg: ContentBlock[] = [];
  if (dbItem.type !== 'd') {
    try {
      otherImg = await getAssets(resolvedId);
    } catch (error) {
      errorPush('Error converting assets to images', error);
    }
  }

  // Map enum to kernel numeric values
  const refModeNum = REF_MODE_MAP[refMode];
  const embedModeNum = EMBED_MODE_MAP[embedMode];

  const markdown = await exportMdContent({ id: resolvedId, refMode: refModeNum, embedMode: embedModeNum, yfm });

  const config = getConfig();
  if (dbItem.type !== 'd' && isValidStr(markdown['content']) && config.export?.addTitle) {
    // Strip title from non-document blocks if addTitle is enabled
    markdown['content'] = markdown['content'].replace(/^#{1,6}\s+.*\n?/, '');
  }

  const content = markdown['content'] || '';
  const sliced = limit !== undefined ? content.slice(offset, offset + limit) : content.slice(offset);
  const hasMore = limit !== undefined ? offset + limit < content.length : false;

  return createJsonResponse(
    {
      id: dbItem.id,
      content: sliced,
      offset,
      hasMore,
      totalLength: content.length,
    },
    otherImg
  );
}

async function kramdownReadHandler(params: { id: BlockId; offset?: number; limit?: number }) {
  const { id, offset = 0, limit } = params;

  const dbItem = await validateBlockAccess(id);
  const resolvedId = dbItem.id; // Use resolved ID (handles hpath)

  let otherImg: ContentBlock[] = [];
  if (dbItem.type !== 'd') {
    try {
      otherImg = await getAssets(resolvedId);
    } catch (error) {
      errorPush('Error converting assets to images', error);
    }
  }

  const result = assertApiResult(await getKramdown(resolvedId), 'get block kramdown content');
  const content = result.kramdown;
  const sliced = limit !== undefined ? content.slice(offset, offset + limit) : content.slice(offset);
  const hasMore = limit !== undefined ? offset + limit < content.length : false;

  return createJsonResponse(
    {
      id: dbItem.id,
      kramdown: sliced,
      offset,
      hasMore,
      totalLength: content.length,
    },
    otherImg
  );
}

async function getAssets(id: BlockId): Promise<ContentBlock[]> {
  const assetsInfo = await getBlockAssets(id);

  // Fetch all assets in parallel
  const allPaths = assetsInfo.map((item) => item.path);

  const fetchResults = await Promise.all(
    allPaths.map((path) =>
      getFileAPIv2('/data/' + path).then((response) => ({ path, response }))
    )
  );

  const contentBlocks: ContentBlock[] = [];
  let inlineSizeSum = 0;

  for (const { path, response } of fetchResults) {
    if (!response) continue;

    const mimeType = getEffectiveMimeType(response, path);
    const contentLength = response.headers.get('Content-Length');
    const size = contentLength ? parseInt(contentLength, 10) : null;
    const uri = `syfile:///data/${path}`;

    // Early check using Content-Length header (optimization - skip reading large files)
    if (size && size > MAX_INLINE_ASSET_SIZE) {
      logPush('Asset too large, returning resource link', path, size);
      const fileName = path.split('/').pop() || path;
      contentBlocks.push(createResourceLink(uri, fileName, mimeType));
      continue;
    }

    const blob = await response.blob();
    logPush('Asset blob', path, blob.size);

    const { block, inlineSize } = await blobToContentBlockWithLimit(
      blob, mimeType, uri, MAX_INLINE_ASSET_SIZE, inlineSizeSum
    );
    contentBlocks.push(block);
    inlineSizeSum += inlineSize;
  }

  return contentBlocks;
}

async function getHPathHandler(params: { id: BlockId; includeOutline?: boolean }) {
  const { id, includeOutline = false } = params;
  debugPush('Get hpath API called');

  const dbItem = await validateBlockAccess(id);
  const resolvedId = dbItem.id;

  const hpath = assertApiResult(await getHPathByIDAPI(resolvedId), 'get the human-readable path');

  const result: { id: BlockId; hpath: string; outline?: OutlinePath[] } = { id: resolvedId, hpath };

  if (includeOutline) {
    const docId = extractDocumentId(dbItem);
    const outline = await getDocOutlineAPI(docId);
    if (outline) {
      result.outline = outline;
    }
  }

  return createJsonResponse(result);
}

async function getDocOutlineHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Get doc outline API called');

  const dbItem = await validateBlockAccess(id);
  const docId = extractDocumentId(dbItem);
  const outline = assertApiResult(await getDocOutlineAPI(docId), 'get document outline');

  // Pass through kernel's OutlinePath[] directly (no transformation)
  return createJsonResponse({ id: docId, outline });
}

async function exportHtmlHandler(params: { id: BlockId; offset?: number; limit?: number }) {
  const { id, offset = 0, limit } = params;
  debugPush('Export HTML API called');

  const dbItem = await validateBlockAccess(id);
  const docId = extractDocumentId(dbItem);
  const html = assertApiResult(await getDocPreview(docId), 'export document as HTML');

  const sliced = limit !== undefined ? html.slice(offset, offset + limit) : html.slice(offset);
  const hasMore = limit !== undefined ? offset + limit < html.length : false;

  return createJsonResponse({
    id: docId,
    html: sliced,
    offset,
    hasMore,
    totalLength: html.length,
  });
}
