/**
 * Document reading tools
 */

import { z } from 'zod';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { McpToolsProvider } from './baseToolProvider';
import { exportMdContent, getKramdown, getFileAPIv2, getHPathByIDAPI, getDocOutlineAPI, getDocPreview } from '../syapi';
import { createJsonResponse, createResourceLink, blobToContentBlockWithLimit, MAX_INLINE_ASSET_SIZE } from '../utils/mcpResponse';
import { isValidStr, extractDocumentId, assertApiResult } from '../utils/commonCheck';
import { getEffectiveMimeType } from '../utils/contentType';
import { getConfig } from '..';
import { getBlockAssets } from '../syapi/custom';
import { validateBlockAccess } from '../utils/resultFilter';
import { debugPush, errorPush, logPush } from '../logger';
import { lang } from '../utils/lang';

// Recursive schema for outline items
type OutlineItem = {
  id: string;
  name: string;
  type: string;
  depth: number;
  count: number;
  children?: OutlineItem[];
};

const outlineItemSchema: z.ZodType<OutlineItem> = z.lazy(() =>
  z.object({
    id: z.string().describe('Block ID'),
    name: z.string().describe('Heading text'),
    type: z.string().describe('Always "outline"'),
    depth: z.number().describe('Heading depth level'),
    count: z.number().describe('Child block count'),
    children: z.array(outlineItemSchema).optional().describe('Nested outline items'),
  })
);

export class DocReadToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
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
      },
      {
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
      },
      {
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
          outline: z.array(outlineItemSchema).optional().describe('Document outline/TOC if includeOutline was true'),
        }),
        handler: getHPathHandler,
        title: lang('tool_title_get_hpath'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_doc_outline',
        description:
          'Get the outline (table of contents) of a document. Returns headings hierarchy which helps understand document structure.',
        inputSchema: z.object({
          id: z.string().describe('Document ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The document ID'),
          outline: z.array(outlineItemSchema).describe('Hierarchical outline with headings'),
        }),
        handler: getDocOutlineHandler,
        title: lang('tool_title_get_doc_outline'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_export_html',
        description:
          'Export a document as HTML. Useful for getting a rendered preview of the document content.',
        inputSchema: z.object({
          id: z.string().describe('Document ID (e.g., "20241231120000-abc1234") or hpath (e.g., "/NotebookName/Doc")'),
        }),
        outputSchema: z.object({
          id: z.string().describe('The document ID'),
          html: z.string().describe('The rendered HTML content of the document'),
        }),
        handler: exportHtmlHandler,
        title: lang('tool_title_export_html'),
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

async function blockReadHandler(params: { id: BlockId; offset?: number; limit?: number }) {
  const { id, offset = 0, limit } = params;
  debugPush('Reading document content');

  const dbItem = await validateBlockAccess(id);

  let otherImg: ContentBlock[] = [];
  if (dbItem.type !== 'd') {
    try {
      otherImg = await getAssets(id);
    } catch (error) {
      errorPush('Error converting assets to images', error);
    }
  }

  const markdown = await exportMdContent({ id, refMode: 4, embedMode: 1, yfm: false });

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

  let otherImg: ContentBlock[] = [];
  if (dbItem.type !== 'd') {
    try {
      otherImg = await getAssets(id);
    } catch (error) {
      errorPush('Error converting assets to images', error);
    }
  }

  const result = assertApiResult(await getKramdown(id), 'get block kramdown content');
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

  const result: { id: BlockId; hpath: string; outline?: OutlineItem[] } = { id: resolvedId, hpath };

  if (includeOutline) {
    const docId = extractDocumentId(dbItem);
    const rawOutline = await getDocOutlineAPI(docId);
    if (rawOutline) {
      result.outline = transformOutline(rawOutline);
    }
  }

  return createJsonResponse(result);
}

async function getDocOutlineHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Get doc outline API called');

  const dbItem = await validateBlockAccess(id);
  const docId = extractDocumentId(dbItem);
  const rawOutline = assertApiResult(await getDocOutlineAPI(docId), 'get document outline');

  // Transform kernel OutlinePath[] to OutlineItem[] (matching our schema)
  const outline = transformOutline(rawOutline);

  return createJsonResponse({ id: docId, outline });
}

/**
 * Transform kernel OutlinePath/OutlineBlock structure to flat OutlineItem format.
 * Kernel returns: { name, blocks: OutlineBlock[], children: OutlinePath[], depth, count, ... }
 * We return: { id, name, type, depth, count, children?: OutlineItem[] }
 */
function transformOutline(paths: OutlinePath[]): OutlineItem[] {
  if (!paths || !Array.isArray(paths)) return [];

  return paths.map((path) => {
    // Combine blocks and children into a single children array
    const childItems: OutlineItem[] = [];

    // Process blocks (OutlineBlock[]) - these are the nested heading blocks
    if (path.blocks && Array.isArray(path.blocks)) {
      childItems.push(...transformBlocks(path.blocks));
    }

    // Process children (OutlinePath[]) - these are nested outline paths
    if (path.children && Array.isArray(path.children)) {
      childItems.push(...transformOutline(path.children));
    }

    const item: OutlineItem = {
      id: path.id,
      name: path.name,
      type: path.type || 'outline',
      depth: path.depth,
      count: path.count || childItems.length,
    };

    if (childItems.length > 0) {
      item.children = childItems;
    }

    return item;
  });
}

/**
 * Transform OutlineBlock[] to OutlineItem[] format.
 */
function transformBlocks(blocks: OutlineBlock[]): OutlineItem[] {
  if (!blocks || !Array.isArray(blocks)) return [];

  return blocks.map((block) => {
    const childItems = block.children ? transformBlocks(block.children) : [];

    const item: OutlineItem = {
      id: block.id,
      name: block.content || '',
      type: block.type || 'outline',
      depth: block.depth,
      count: block.count || childItems.length,
    };

    if (childItems.length > 0) {
      item.children = childItems;
    }

    return item;
  });
}

async function exportHtmlHandler(params: { id: BlockId }) {
  const { id } = params;
  debugPush('Export HTML API called');

  const dbItem = await validateBlockAccess(id);
  const docId = extractDocumentId(dbItem);
  const html = assertApiResult(await getDocPreview(docId), 'export document as HTML');

  return createJsonResponse({ id: docId, html });
}
