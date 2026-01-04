/**
 * Document reading tools
 */

import { z } from 'zod';
import { McpToolsProvider } from './baseToolProvider';
import { exportMdContent, getKramdown, getFileAPIv2, getHPathByIDAPI, getDocOutlineAPI, getDocPreview } from '../syapi';
import { createErrorResponse, createJsonResponse } from '../utils/mcpResponse';
import { isValidStr } from '../utils/commonCheck';
import { getConfig } from '..';
import { getBlockDBItem, getBlockAssets, checkIdValid } from '../syapi/custom';
import { filterBlock } from '../utils/filterCheck';
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

export class DocReadToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_read_doc_content_markdown',
        description: 'Retrieve the content of a document or block by its ID',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document or block'),
          offset: z
            .number()
            .default(0)
            .describe('The starting character offset for partial content reading (for pagination/large docs)'),
          limit: z
            .number()
            .default(10000)
            .describe('The maximum number of characters to return in this request'),
        },
        outputSchema: {
          content: z.string().describe('The markdown content of the document/block (sliced by offset/limit)'),
          offset: z.number().describe('The starting offset used'),
          limit: z.number().describe('The limit used'),
          hasMore: z.boolean().describe('Whether there is more content beyond the current slice'),
          totalLength: z.number().describe('Total length of the full content in characters'),
        },
        handler: blockReadHandler,
        title: lang('tool_title_read_doc_content_markdown'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_block_kramdown',
        description:
          'Get block content in Kramdown format from SiYuan. Unlike plain text, Kramdown preserves all rich formatting including colors, attributes, and IDs. Use this tool before modifying blocks to ensure formatting is preserved.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the block'),
        },
        outputSchema: {
          kramdown: z.string().describe('The block content in Kramdown format with preserved formatting'),
        },
        handler: kramdownReadHandler,
        title: lang('tool_title_get_block_kramdown'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_hpath',
        description:
          'Get the human-readable path (hpath) for a document or block by its ID. Optionally includes document outline for context.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document or block'),
          includeOutline: z.boolean().optional().describe('If true, also returns the document outline/TOC'),
        },
        outputSchema: {
          id: z.string().describe('The block/document ID'),
          hpath: z.string().describe('Human-readable path (e.g., "/Notebook/Parent Doc/Child Doc")'),
          outline: z.array(outlineItemSchema).optional().describe('Document outline/TOC if includeOutline was true'),
        },
        handler: getHPathHandler,
        title: lang('tool_title_get_hpath'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_doc_outline',
        description:
          'Get the outline (table of contents) of a document. Returns headings hierarchy which helps understand document structure.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document'),
        },
        outputSchema: {
          id: z.string().describe('The document ID'),
          outline: z.array(outlineItemSchema).describe('Hierarchical outline with headings'),
        },
        handler: getDocOutlineHandler,
        title: lang('tool_title_get_doc_outline'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_export_html',
        description:
          'Export a document as HTML. Useful for getting a rendered preview of the document content.',
        inputSchema: {
          id: z.string().describe('The unique identifier of the document'),
        },
        outputSchema: {
          id: z.string().describe('The document ID'),
          html: z.string().describe('The rendered HTML content of the document'),
        },
        handler: exportHtmlHandler,
        title: lang('tool_title_export_html'),
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

async function blockReadHandler(params: { id: string; offset?: number; limit?: number }) {
  const { id, offset = 0, limit = 10000 } = params;
  debugPush('Reading document content');

  // Check input
  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse('Invalid document or block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse('The specified document or block is excluded by the user settings. So cannot write or read.');
  }

  let otherImg: any[] = [];
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
  const sliced = content.slice(offset, offset + limit);
  const hasMore = offset + limit < content.length;

  return createJsonResponse(
    {
      content: sliced,
      offset,
      limit,
      hasMore,
      totalLength: content.length,
    },
    otherImg
  );
}

async function kramdownReadHandler(params: { id: string }) {
  const { id } = params;

  // Check input
  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse('Invalid block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse('The specified document or block is excluded by the user settings. So cannot write or read.');
  }

  let otherImg: any[] = [];
  if (dbItem.type !== 'd') {
    try {
      otherImg = await getAssets(id);
    } catch (error) {
      errorPush('Error converting assets to images', error);
    }
  }

  const kramdown = await getKramdown(id);
  const content = kramdown || '';

  return createJsonResponse(
    {
      kramdown: content,
    },
    otherImg
  );
}

/** Extension to MIME type mapping */
const extensionMimeMap: Record<string, string> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/** Get MIME type from file extension, or null if not a supported media type */
function getMimeFromExtension(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return extensionMimeMap[ext] || null;
}

/** Check if MIME type is a supported media type */
function isMediaMime(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('audio/');
}

/**
 * Get effective MIME type for a response.
 * Priority: response MIME (if media) > extension-based MIME
 */
function getEffectiveMimeType(response: Response, path: string): string | null {
  const contentType = response.headers.get('Content-Type') || '';
  const responseMime = contentType.split(';')[0].trim().toLowerCase();

  // Trust response MIME if it's a known media type
  if (isMediaMime(responseMime)) {
    return responseMime;
  }

  // Fall back to extension-based MIME (e.g., when server returns application/octet-stream)
  return getMimeFromExtension(path);
}

/** Convert blob to MCP ContentBlock with explicit MIME type */
async function blobToContentBlock(blob: Blob, mimeType: string): Promise<{
  type: string;
  data: string;
  mimeType: string;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);

  return {
    type: mimeType.split('/')[0], // "image" or "audio"
    data: base64Data,
    mimeType,
  };
}

async function getAssets(id: string) {
  const assetsInfo = await getBlockAssets(id);

  // Pre-filter by extension, fetch in parallel with path info
  const mediaPaths = assetsInfo
    .map((item) => item.path)
    .filter((path) => getMimeFromExtension(path) !== null);

  const fetchResults = await Promise.all(
    mediaPaths.map(async (path) => ({
      path,
      response: await getFileAPIv2('/data/' + path),
    }))
  );

  const contentBlocks: Promise<any>[] = [];
  let mediaLengthSum = 0;

  for (const { path, response } of fetchResults) {
    if (!response) continue;

    // Determine MIME: trust response if media, fallback to extension
    const mimeType = getEffectiveMimeType(response, path);
    if (!mimeType) continue;

    const blob = await response.blob();
    logPush('Asset blob', path, blob.size);

    if (blob.size / 1024 / 1024 > 2) {
      logPush('File too large, not returning', blob.size);
      continue;
    }
    if (mediaLengthSum / 1024 / 1024 > 5) {
      logPush('Total media size too large, not returning more content', mediaLengthSum);
      break;
    }

    mediaLengthSum += blob.size;
    contentBlocks.push(blobToContentBlock(blob, mimeType));
  }

  return await Promise.all(contentBlocks);
}

async function getHPathHandler(params: { id: string; includeOutline?: boolean }) {
  const { id, includeOutline = false } = params;
  debugPush('Get hpath API called');

  checkIdValid(id);
  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse('Invalid document or block ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse('The specified document or block is excluded by the user settings.');
  }

  const hpath = await getHPathByIDAPI(id);
  if (hpath == null) {
    return createErrorResponse('Failed to get the human-readable path.');
  }

  const result: any = { id, hpath };

  if (includeOutline) {
    // Get the root document ID for outline
    const docId = dbItem.type === 'd' ? id : dbItem.root_id;
    if (docId) {
      const outline = await getDocOutlineAPI(docId);
      if (outline) {
        result.outline = outline;
      }
    }
  }

  return createJsonResponse(result);
}

async function getDocOutlineHandler(params: { id: string }) {
  const { id } = params;
  debugPush('Get doc outline API called');

  checkIdValid(id);
  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse('Invalid document ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse('The specified document is excluded by the user settings.');
  }

  // Get the root document ID if a block ID was provided
  const docId = dbItem.type === 'd' ? id : dbItem.root_id;
  if (!docId) {
    return createErrorResponse('Could not determine the document ID.');
  }

  const outline = await getDocOutlineAPI(docId);
  if (outline == null) {
    return createErrorResponse('Failed to get document outline.');
  }

  return createJsonResponse({ id: docId, outline });
}

async function exportHtmlHandler(params: { id: string }) {
  const { id } = params;
  debugPush('Export HTML API called');

  checkIdValid(id);
  const dbItem = await getBlockDBItem(id);
  if (dbItem == null) {
    return createErrorResponse('Invalid document ID. Please check if the ID exists and is correct.');
  }
  if (await filterBlock(id, dbItem)) {
    return createErrorResponse('The specified document is excluded by the user settings.');
  }

  // Get the root document ID if a block ID was provided
  const docId = dbItem.type === 'd' ? id : dbItem.root_id;
  if (!docId) {
    return createErrorResponse('Could not determine the document ID.');
  }

  const html = await getDocPreview(docId);
  if (!html) {
    return createErrorResponse('Failed to export document as HTML.');
  }

  return createJsonResponse({ id: docId, html });
}
