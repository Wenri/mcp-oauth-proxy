/**
 * Daily note tools
 * Adapted from upstream to use platform abstraction
 *
 * CHANGE FROM UPSTREAM: Uses getPlatformContext().config.notebooks instead of window.siyuan.notebooks
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import {
  appendBlockAPI,
  createDailyNote,
  getChildBlocks,
  getNotebookConf,
  queryAPI,
  removeBlockAPI,
  exportMdContent,
  getFileAPIv2,
  getNodebookList,
} from '../syapi';
import { isValidStr } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { McpToolsProvider, McpTool } from './baseToolProvider';
import { debugPush, logPush, warnPush, errorPush } from '../logger';
import { getBlockAssets } from '../syapi/custom';
import { blobToBase64Object } from '../utils/common';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterNotebook } from '../utils/filterCheck';
import { getPlatformContext } from '../platform';

export class DailyNoteToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_append_to_dailynote',
        description: lang('tool_append_dailynote'),
        schema: {
          markdownContent: z
            .string()
            .describe("The Markdown-formatted content to append to today's daily note."),
          notebookId: z
            .string()
            .describe(
              'The ID of the target notebook where the daily note is located. The notebook must not be in a closed state.'
            ),
        },
        handler: appendToDailynoteHandler,
        title: lang('tool_title_append_to_dailynote'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_list_notebook',
        description:
          'List all notebooks in SiYuan and return their metadata(such as id, open status, dailyNoteSavePath etc.).',
        schema: {},
        handler: listNotebookHandler,
        title: lang('tool_title_list_notebook'),
        annotations: {
          readOnlyHint: true,
        },
      },
    ];
  }
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

async function appendToDailynoteHandler(params: { notebookId: string; markdownContent: string }) {
  const { notebookId, markdownContent } = params;
  debugPush('Append to dailynote API called', params);

  if (filterNotebook(notebookId)) {
    return createErrorResponse('The specified notebook is excluded by the user settings.');
  }

  // Create or get daily note
  const ctx = getPlatformContext();
  const appId = ctx.config.appId || 'mcp-worker';
  const id = await createDailyNote(notebookId, appId);

  let newBlockId = '';
  if (isValidStr(id)) {
    const queryResult = await queryAPI(`SELECT * FROM blocks WHERE id = "${id}"`);
    const result = await appendBlockAPI(markdownContent, id);
    if (result == null) {
      return createErrorResponse('Failed to append to dailynote');
    }

    // If new daily note, remove empty child block
    if (queryResult && queryResult.length == 0) {
      try {
        const childList = await getChildBlocks(id);
        debugPush('New daily note, checking child blocks', childList);
        if (
          childList &&
          childList.length >= 1 &&
          childList[0].type == 'p' &&
          !isValidStr(childList[0]['markdown'])
        ) {
          debugPush('Removing empty child block', childList[0]);
          removeBlockAPI(childList[0].id);
        }
      } catch (err) {
        warnPush('Error removing empty block', err);
      }
    }
    newBlockId = result.id;
  } else {
    return createErrorResponse('Internal Error: failed to create dailynote');
  }

  taskManager.insert(id, markdownContent, 'appendToDailyNote', {}, TASK_STATUS.APPROVED);
  return createSuccessResponse('Successfully created the dailynote, the block ID for the new content is ' + newBlockId);
}

async function listNotebookHandler() {
  // PLATFORM CHANGE: Use kernel API instead of window.siyuan.notebooks
  const notebooks = await getNodebookList();
  if (!notebooks || notebooks.length === 0) {
    return createJsonResponse([]);
  }

  const augmentedNotebooks = await Promise.all(
    notebooks.map(async (notebook: any) => {
      try {
        const confData = await getNotebookConf(notebook.id);
        if (confData && confData.conf) {
          return {
            ...notebook,
            refCreateSaveBox: confData.conf.refCreateSaveBox,
            refCreateSavePath: confData.conf.refCreateSavePath,
            docCreateSaveBox: confData.conf.docCreateSaveBox,
            docCreateSavePath: confData.conf.docCreateSavePath,
            dailyNoteSavePath: confData.conf.dailyNoteSavePath,
            dailyNoteTemplatePath: confData.conf.dailyNoteTemplatePath,
          };
        }
      } catch (error) {
        warnPush(`Failed to get conf for notebook ${notebook.id}`, error);
      }
      return notebook;
    })
  );

  return createJsonResponse(augmentedNotebooks);
}
