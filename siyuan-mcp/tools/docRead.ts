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
import { blobToBase64Object } from '../utils/common';
import { debugPush, errorPush, logPush } from '../logger';
import { lang } from '../utils/lang';

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
            .describe('The starting character offset for partial content reading (for pagination/large docs)'),
          limit: z
            .number()
            .default(10000)
            .describe('The maximum number of characters to return in this request'),
        },
        handler: blockReadHandler,
        title: lang('tool_title_read_doc_content_markdown'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_block_kramdown',
        description:
          'Get block content in Kramdown format from SiYuan. Unlike plain text, Kramdown preserves all rich formatting including colors, attributes, and IDs. Use this tool before modifying blocks to ensure formatting is preserved.',
        schema: {
          id: z.string().describe('The unique identifier of the block'),
        },
        handler: kramdownReadHandler,
        title: lang('tool_title_get_block_kramdown'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_hpath',
        description:
          'Get the human-readable path (hpath) for a document or block by its ID. Optionally includes document outline for context.',
        schema: {
          id: z.string().describe('The unique identifier of the document or block'),
          includeOutline: z.boolean().optional().describe('If true, also returns the document outline/TOC'),
        },
        handler: getHPathHandler,
        title: lang('tool_title_get_hpath'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_get_doc_outline',
        description:
          'Get the outline (table of contents) of a document. Returns headings hierarchy which helps understand document structure.',
        schema: {
          id: z.string().describe('The unique identifier of the document'),
        },
        handler: getDocOutlineHandler,
        title: lang('tool_title_get_doc_outline'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_export_html',
        description:
          'Export a document as HTML. Useful for getting a rendered preview of the document content.',
        schema: {
          id: z.string().describe('The unique identifier of the document'),
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

const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico'];
const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

/** Check if file extension is supported media */
function isMediaExtension(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.includes(ext) || audioExtensions.includes(ext);
}

/** Check if response is supported image/audio and return blob promise, or null */
function getSupportedMediaBlob(
  result: { response: Response; contentType: string } | null
): Promise<Blob> | null {
  if (!result) return null;

  const { response, contentType } = result;
  const baseType = contentType.split(';')[0].trim().toLowerCase();

  // Check MIME type (extension already filtered before fetch)
  if (baseType.startsWith('image/') || baseType.startsWith('audio/')) {
    return response.blob();
  }

  return null;
}

async function getAssets(id: string) {
  const assetsInfo = await getBlockAssets(id);

  // Pre-filter by extension, fetch in parallel
  const fetchResults = await Promise.all(
    assetsInfo
      .map((item) => item.path)
      .filter(isMediaExtension)
      .map((pathItem) => getFileAPIv2('/data/' + pathItem))
  );

  // Filter nulls synchronously, then read blobs in parallel
  const blobPromises = fetchResults
    .map(getSupportedMediaBlob)
    .filter((p): p is Promise<Blob> => p !== null);

  const assetsBlobResult = await Promise.all(blobPromises);
  const base64ObjPromise: Promise<any>[] = [];
  let mediaLengthSum = 0;

  for (const blob of assetsBlobResult) {
    logPush('type', typeof blob, blob);
    if (blob.size / 1024 / 1024 > 2) {
      logPush('File too large, not returning', blob.size);
    } else if (mediaLengthSum / 1024 / 1024 > 5) {
      logPush('Total media size too large, not returning more content', mediaLengthSum);
      break;
    } else {
      mediaLengthSum += blob.size;
      base64ObjPromise.push(blobToBase64Object(blob));
    }
  }

  return await Promise.all(base64ObjPromise);
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
