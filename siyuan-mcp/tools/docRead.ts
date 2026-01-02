/**
 * Document reading tools
 */

import { z } from 'zod';
import { McpToolsProvider } from './baseToolProvider';
import { exportMdContent, getKramdown, getFileAPIv2, getHPathByIDAPI } from '../syapi';
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
          'Get the human-readable path (hpath) for a document or block by its ID. Returns the path like "/Notebook/Parent Doc/Child Doc".',
        schema: {
          id: z.string().describe('The unique identifier of the document or block'),
        },
        handler: getHPathHandler,
        title: lang('tool_title_get_hpath'),
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

async function getAssets(id: string) {
  const assetsInfo = await getBlockAssets(id);
  const assetsPathList = assetsInfo.map((item) => item.path);
  const assetsPromise: Promise<Blob>[] = [];

  assetsPathList.forEach((pathItem) => {
    if (isSupportedImageOrAudio(pathItem)) {
      assetsPromise.push(getFileAPIv2('/data/' + pathItem));
    }
  });

  const assetsBlobResult = await Promise.all(assetsPromise);
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

function isSupportedImageOrAudio(path: string): 'image' | 'audio' | false {
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

  const extMatch = path.match(/\.([a-zA-Z0-9]+)$/);
  if (!extMatch) return false;

  const ext = extMatch[1].toLowerCase();

  if (imageExtensions.includes(ext)) {
    return 'image';
  } else if (audioExtensions.includes(ext)) {
    return 'audio';
  } else {
    return false;
  }
}

async function getHPathHandler(params: { id: string }) {
  const { id } = params;
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

  return createJsonResponse({ id, hpath });
}
