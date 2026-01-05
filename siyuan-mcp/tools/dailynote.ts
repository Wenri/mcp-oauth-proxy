/**
 * Daily note tools
 */

import { z } from 'zod';
import { createSuccessResponse, createArrayResponse } from '../utils/mcpResponse';
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
import { filterNotebook } from '../utils/resultFilter';
import { getAppId } from '..';

export class DailyNoteToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_append_to_dailynote',
        description: lang('tool_append_dailynote'),
        inputSchema: {
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
        inputSchema: {},
        outputSchema: {
          count: z.number().describe('Number of notebooks'),
          notebooks: z
            .array(
              z.object({
                id: z.string().describe('Notebook ID'),
                name: z.string().describe('Notebook name'),
                icon: z.string().describe('Notebook icon'),
                sort: z.number().describe('Custom sort order'),
                closed: z.boolean().describe('Whether notebook is closed'),
                newFlashcardCount: z.number().optional().describe('Count of new flashcards'),
                dueFlashcardCount: z.number().optional().describe('Count of due flashcards'),
                flashcardCount: z.number().optional().describe('Total flashcard count'),
                refCreateSaveBox: z.string().optional().describe('Ref create save box'),
                refCreateSavePath: z.string().optional().describe('Ref create save path'),
                docCreateSaveBox: z.string().optional().describe('Doc create save box'),
                docCreateSavePath: z.string().optional().describe('Doc create save path'),
                dailyNoteSavePath: z.string().optional().describe('Daily note save path template'),
                dailyNoteTemplatePath: z.string().optional().describe('Daily note template path'),
              })
            )
            .describe('Array of notebook metadata objects'),
        },
        handler: listNotebookHandler,
        title: lang('tool_title_list_notebook'),
        annotations: {
          readOnlyHint: true,
        },
      },
    ];
  }
}

async function appendToDailynoteHandler(params: { notebookId: NotebookId; markdownContent: string }) {
  const { notebookId, markdownContent } = params;
  debugPush('Append to dailynote API called', params);

  if (filterNotebook(notebookId)) {
    throw new Error('The specified notebook is excluded by the user settings.');
  }

  // Create or get daily note
  const appId = getAppId();
  const id = await createDailyNote(notebookId, appId);

  let newBlockId: BlockId = '';
  if (isValidStr(id)) {
    const queryResult = await queryAPI(`SELECT * FROM blocks WHERE id = "${id}"`);
    const result = await appendBlockAPI(markdownContent, id);
    if (result == null) {
      throw new Error('Failed to append to dailynote');
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
    throw new Error('Internal Error: failed to create dailynote');
  }

  taskManager.insert(id, markdownContent, 'appendToDailyNote', {}, TASK_STATUS.APPROVED);
  return createSuccessResponse(newBlockId);
}

async function listNotebookHandler() {
  // PLATFORM CHANGE: Use kernel API instead of window.siyuan.notebooks
  const notebooks = await getNodebookList();
  if (!notebooks || notebooks.length === 0) {
    return createArrayResponse([], 'notebooks');
  }

  const augmentedNotebooks = await Promise.all(
    notebooks.map(async (notebook) => {
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

  return createArrayResponse(augmentedNotebooks, 'notebooks');
}
