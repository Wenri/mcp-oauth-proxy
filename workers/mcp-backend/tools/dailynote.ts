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
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush, warnPush } from '../logger';
// DISABLED: taskManager causes race conditions in CF Workers
// import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterNotebook } from '../utils/resultFilter';
import { getAppId } from '../server';

/** SiYuan sort mode values (from kernel/util/sort.go) */
const SORT_MODES = [
  'Name ascending',
  'Name descending',
  'Updated ascending',
  'Updated descending',
  'Alphanumeric ascending',
  'Alphanumeric descending',
  'Custom',
  'Ref count ascending',
  'Ref count descending',
  'Created ascending',
  'Created descending',
  'Size ascending',
  'Size descending',
  'Sub-doc count ascending',
  'Sub-doc count descending',
  'File tree',
] as const;

type SortMode = (typeof SORT_MODES)[number] | 'Unassigned';

const SORT_MODE_NAMES: Record<number, SortMode> = {
  0: 'Name ascending',
  1: 'Name descending',
  2: 'Updated ascending',
  3: 'Updated descending',
  4: 'Alphanumeric ascending',
  5: 'Alphanumeric descending',
  6: 'Custom',
  7: 'Ref count ascending',
  8: 'Ref count descending',
  9: 'Created ascending',
  10: 'Created descending',
  11: 'Size ascending',
  12: 'Size descending',
  13: 'Sub-doc count ascending',
  14: 'Sub-doc count descending',
  15: 'File tree',
  256: 'Unassigned',
};

const sortModeSchema = z.enum([...SORT_MODES, 'Unassigned']);

function getSortModeName(sortMode: number): SortMode {
  return SORT_MODE_NAMES[sortMode] ?? 'Unassigned';
}

export class DailyNoteToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_append_to_dailynote',
        description: lang('tool_append_dailynote'),
        inputSchema: z.object({
          markdownContent: z
            .string()
            .describe("The Markdown-formatted content to append to today's daily note."),
          notebookId: z
            .string()
            .describe(
              'The ID of the target notebook where the daily note is located. The notebook must not be in a closed state.'
            ),
        }),
        handler: appendToDailynoteHandler,
        title: lang('tool_title_append_to_dailynote'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_list_notebook',
        description:
          'List all notebooks in SiYuan and return their metadata(such as id, open status, dailyNoteSavePath etc.).',
        inputSchema: z.object({}),
        outputSchema: z.object({
          count: z.number().describe('Number of notebooks'),
          notebooks: z
            .array(
              z.object({
                id: z.string().describe('Notebook ID'),
                name: z.string().describe('Notebook name'),
                icon: z.string().describe('Notebook icon'),
                sort: z.number().describe('Custom sort order'),
                sortMode: sortModeSchema.describe('Document sort mode'),
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
        }),
        handler: listNotebookHandler,
        title: lang('tool_title_list_notebook'),
        annotations: {
          readOnlyHint: true,
        },
      }),
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

  // DISABLED: taskManager causes race conditions in CF Workers
  // taskManager.insert(id, markdownContent, 'appendToDailyNote', {}, TASK_STATUS.APPROVED);
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
      // Transform sortMode number to human-readable name
      const baseNotebook = {
        ...notebook,
        sortMode: getSortModeName(notebook.sortMode),
      };

      try {
        const confData = await getNotebookConf(notebook.id);
        if (confData && confData.conf) {
          return {
            ...baseNotebook,
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
      return baseNotebook;
    })
  );

  return createArrayResponse(augmentedNotebooks, 'notebooks');
}
