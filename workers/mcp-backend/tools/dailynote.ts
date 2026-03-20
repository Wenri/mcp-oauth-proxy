/**
 * Daily note tools
 */

import { z } from 'zod';
import {
  createSuccessResponse,
  createArrayResponse,
  createErrorResponse,
  createJsonResponse,
  createImageContent,
  createAudioContent,
} from '../utils/mcpResponse';
import {
  appendBlockAPI,
  createDailyNote,
  exportMdContent,
  getChildBlocks,
  getFileAPIv2,
  getNotebookConf,
  queryAPI,
  removeBlockAPI,
  getNodebookList,
} from '../syapi';
import { getBlockAssets } from '../syapi/custom';
import { isValidStr } from '../utils/commonCheck';
import { lang } from '../utils/lang';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush, warnPush, errorPush } from '../logger';
// DISABLED: taskManager causes race conditions in CF Workers
// import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterNotebook } from '../utils/filterCheck';
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
      defineTool({
        name: 'siyuan_read_dailynote',
        description: 'Read the content of a daily note for a specific date.',
        inputSchema: z.object({
          date: z
            .string()
            .optional()
            .describe(
              "The date of the daily note in 'yyyyMMdd' format. If not provided, today's date will be used."
            ),
          notebookId: z
            .string()
            .optional()
            .describe(
              'The ID of the notebook to search for the daily note. If not provided, all notebooks will be searched.'
            ),
        }),
        outputSchema: z.object({
          content: z.string().describe('Markdown content of the daily note'),
          docId: z.string().describe('Document block ID of the daily note'),
        }),
        handler: readDailynoteHandler,
        title: lang('tool_title_read_dailynote'),
        annotations: {
          readOnlyHint: true,
        },
      }),
    ];
  }
}

async function readDailynoteHandler(params: { date?: string; notebookId?: string }) {
  let { date, notebookId } = params;

  if (!date) {
    const now = new Date();
    date = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
  }

  // Validate notebookId and date formats
  if (notebookId && !/^[a-zA-Z0-9\-]+$/.test(notebookId)) {
    return createErrorResponse('Invalid notebookId format.');
  }
  if (!/^\d{8}$/.test(date)) {
    return createErrorResponse("Invalid date format. Expected 'yyyyMMdd'.");
  }

  if (notebookId && filterNotebook(notebookId)) {
    return createErrorResponse('The specified notebook is excluded by the user settings.');
  }

  const boxCondition = notebookId ? `AND B.box = '${notebookId}'` : '';

  // First try to find by custom attribute
  let sql = `SELECT B.id FROM blocks AS B JOIN attributes AS A ON B.id = A.block_id WHERE A.name = 'custom-dailynote-${date}' ${boxCondition} AND B.type = 'd' LIMIT 1`;
  let queryResult = await queryAPI(sql);

  // Fall back to querying by document title
  if (!queryResult || queryResult.length === 0) {
    const formattedDate = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
    const boxCondition2 = notebookId ? `AND box = '${notebookId}'` : '';
    sql = `SELECT id FROM blocks WHERE content = '${formattedDate}' ${boxCondition2} AND type = 'd' LIMIT 1`;
    queryResult = await queryAPI(sql);
  }

  if (!queryResult || queryResult.length === 0) {
    const notebookInfo = notebookId ? ` in notebook ${notebookId}` : '';
    return createErrorResponse(`Daily note for date ${date} not found${notebookInfo}.`);
  }

  const docId = queryResult[0].id;

  // Fetch assets (images/audio) attached to the document
  const mediaContent = await getAssets(docId);

  const markdown = await exportMdContent({ id: docId, refMode: 4, embedMode: 1, yfm: false });
  const content = markdown['content'] || '';

  return createJsonResponse({ content, docId }, mediaContent);
}

async function getAssets(id: BlockId) {
  const assetsInfo = await getBlockAssets(id);
  const assetPaths = assetsInfo.map((item) => item.path);

  const mediaItems: Array<{ path: string; kind: 'image' | 'audio' }> = [];
  for (const path of assetPaths) {
    const kind = getSupportedMediaKind(path);
    if (kind) {
      mediaItems.push({ path, kind });
    }
  }

  const results = [];
  let totalBytes = 0;
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB
  const MAX_SINGLE_BYTES = 2 * 1024 * 1024; // 2 MB

  for (const { path, kind } of mediaItems) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      break;
    }
    try {
      const response = await getFileAPIv2('/data/' + path);
      if (!response) continue;

      const blob = await response.blob();
      if (blob.size > MAX_SINGLE_BYTES) {
        continue;
      }
      if (totalBytes + blob.size > MAX_TOTAL_BYTES) {
        break;
      }
      totalBytes += blob.size;

      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);
      const mimeType = blob.type || (kind === 'image' ? 'image/png' : 'audio/mpeg');

      if (kind === 'image') {
        results.push(createImageContent(base64Data, mimeType));
      } else {
        results.push(createAudioContent(base64Data, mimeType));
      }
    } catch (err) {
      errorPush('Error fetching asset', path, err);
    }
  }

  return results;
}

function getSupportedMediaKind(path: string): 'image' | 'audio' | false {
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

  const extMatch = path.match(/\.([a-zA-Z0-9]+)$/);
  if (!extMatch) return false;

  const ext = extMatch[1].toLowerCase();

  if (imageExtensions.includes(ext)) {
    return 'image';
  } else if (audioExtensions.includes(ext)) {
    return 'audio';
  }
  return false;
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
