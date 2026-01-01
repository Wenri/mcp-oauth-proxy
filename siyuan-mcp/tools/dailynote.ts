/**
 * Daily note tools
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
  getNodebookList,
} from '../syapi';
import { isValidStr } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush, warnPush } from '../logger';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterNotebook } from '../utils/filterCheck';
import { getAppId } from '..';

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

async function appendToDailynoteHandler(params: { notebookId: string; markdownContent: string }) {
  const { notebookId, markdownContent } = params;
  debugPush('Append to dailynote API called', params);

  if (filterNotebook(notebookId)) {
    return createErrorResponse('The specified notebook is excluded by the user settings.');
  }

  // Create or get daily note
  const appId = getAppId();
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
