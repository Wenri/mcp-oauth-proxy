/**
 * Flashcard tools
 */

import { addRiffCards, queryAPI, removeRiffCards } from '../syapi';
import { getBlockDBItem, isValidDeck, QUICK_DECK_ID } from '../syapi/custom';
import { isValidStr } from '../utils/commonCheck';
import { createErrorResponse, createSuccessResponse } from '../utils/mcpResponse';
import { createNewDocWithParentId } from './sharedFunction';
import { McpToolsProvider } from './baseToolProvider';
import { z } from 'zod';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterBlock } from '../utils/filterCheck';
import { getConfig } from '../context';

const TYPE_VALID_LIST = ['h1', 'h2', 'h3', 'h4', 'h5', 'highlight', 'superBlock'] as const;

export class FlashcardToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_create_flashcards_with_new_doc',
        description: 'Create New Document, and Make Flashcards with Specific Method',
        schema: {
          parentId: z
            .string()
            .describe('The ID of the parent document where the new document will be created.'),
          docTitle: z
            .string()
            .describe('The title of the new document that will contain the flashcards.'),
          type: z
            .enum(TYPE_VALID_LIST)
            .describe('The block type to use when formatting flashcards (e.g., heading or highlight).'),
          deckId: z
            .string()
            .optional()
            .describe('The ID of the flashcard deck to which the new content belongs.'),
          markdownContent: z
            .string()
            .describe('The Markdown-formatted content to append at the end of the new document.'),
        },
        handler: addFlashCardMarkdown,
        title: 'Create Flashcards with New Doc',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_create_flashcards',
        description: 'Create flashcards from one or more block IDs.',
        schema: {
          blockIds: z
            .array(z.string())
            .describe('The IDs of the blocks to be converted into flashcards.'),
          deckId: z
            .string()
            .optional()
            .describe('The ID of the deck to add the cards to. If not provided, a default deck will be used.'),
        },
        handler: createFlashcardsHandler,
        title: 'Create Flashcards',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_delete_flashcards',
        description: 'Delete flashcards from a deck using their corresponding block IDs.',
        schema: {
          blockIds: z
            .array(z.string())
            .describe('The IDs of the blocks corresponding to the flashcards to be deleted.'),
          deckId: z
            .string()
            .optional()
            .describe(
              'The ID of the deck to remove the cards from. If not provided, a default deck will be used.'
            ),
        },
        handler: deleteFlashcardsHandler,
        title: 'Delete Flashcards',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
    ];
  }
}

async function addFlashCardMarkdown(
  params: {
    parentId: string;
    docTitle: string;
    type: (typeof TYPE_VALID_LIST)[number];
    deckId?: string;
    markdownContent: string;
  },
  _extra: any
) {
  let { parentId, docTitle, type, deckId, markdownContent } = params;

  if (await filterBlock(parentId, null)) {
    return createErrorResponse(
      'The specified document or block is excluded by the user settings, so cannot create a new note under it.'
    );
  }

  if (!isValidStr(deckId)) {
    deckId = QUICK_DECK_ID;
  }
  if (!(await isValidDeck(deckId!))) {
    return createErrorResponse(
      'Card creation failed: DeckId does not exist. If user did not specify a deck name or ID, set deckId to ""'
    );
  }

  const config = getConfig();
  if (type === 'highlight' && !config.editor?.markdown?.inlineMath) {
    return createErrorResponse(
      'Card creation failed: Highlight flashcards require Markdown inline syntax to be enabled. Please remind user to enable this feature (Settings - Editor - Markdown inline syntax)'
    );
  }

  const { result, newDocId } = await createNewDocWithParentId(parentId, docTitle, markdownContent);
  if (result) {
    taskManager.insert(newDocId, markdownContent, 'createNewNoteWithFlashCard', {}, TASK_STATUS.APPROVED);
  }

  if (result) {
    // Parse document and add cards
    const addCardsResult = await parseDocAddCards(newDocId, type, deckId!);
    return createSuccessResponse(`Successfully added ${addCardsResult} flashcards`);
  } else {
    return createErrorResponse('Card creation failed: Unknown error while creating flashcard document');
  }
}

async function createFlashcardsHandler(
  params: { blockIds: string[]; deckId?: string },
  _extra: any
) {
  let { blockIds, deckId } = params;

  if (!isValidStr(deckId)) {
    deckId = QUICK_DECK_ID;
  }
  if (!(await isValidDeck(deckId!))) {
    return createErrorResponse(
      'Card creation failed: The DeckId does not exist. If the user has not specified a deck name or ID, set the deckId parameter to an empty string.'
    );
  }

  const filteredIds: string[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const blockId = blockIds[i];
    const dbItem = await getBlockDBItem(blockId);
    if (dbItem == null) {
      return createErrorResponse(
        `Invalid block ID: ${blockId}. Please check if the ID exists and is correct.`
      );
    }
    if (await filterBlock(blockId, dbItem)) {
      continue;
    }
    filteredIds.push(blockId);
  }

  const addCardsResult = await addRiffCards(filteredIds, deckId!);
  if (addCardsResult === null) {
    return createErrorResponse('Failed to create flashcards.');
  }
  return createSuccessResponse(`Successfully added ${filteredIds.length} flashcards.`);
}

async function deleteFlashcardsHandler(params: { blockIds: string[]; deckId?: string }) {
  let { blockIds, deckId } = params;

  if (!isValidStr(deckId)) {
    deckId = '';
  }
  if ((await isValidDeck(deckId!)) === false && deckId !== '') {
    return createErrorResponse(
      'Card deletion failed: The DeckId does not exist. If the user has not specified a deck name or ID, set the deckId parameter to an empty string.'
    );
  }

  const removeResult = await removeRiffCards(blockIds, deckId!);
  if (removeResult === null) {
    return createErrorResponse('Failed to delete flashcards.');
  }
  return createSuccessResponse(`Successfully removed flashcards corresponding to ${blockIds.length} blocks.`);
}

async function parseDocAddCards(
  docId: string,
  addType: string,
  deckId: string
): Promise<number> {
  const functionDict: Record<string, () => Promise<string[]>> = {
    h1: () => provideHeadingIds(docId, addType),
    h2: () => provideHeadingIds(docId, addType),
    h3: () => provideHeadingIds(docId, addType),
    h4: () => provideHeadingIds(docId, addType),
    h5: () => provideHeadingIds(docId, addType),
    highlight: () => provideHighlightBlockIds(docId),
    superBlock: () => provideSuperBlockIds(docId),
  };

  const blockIds = await functionDict[addType]();
  await addRiffCards(blockIds, deckId);
  return blockIds.length;
}

function getIdFromSqlItem(sqlResponse: any[]): string[] {
  sqlResponse = sqlResponse ?? [];
  return sqlResponse.map((item) => item.id);
}

async function provideHeadingIds(docId: string, headingType: string): Promise<string[]> {
  const queryResult = await queryAPI(
    `select id from blocks where root_id = '${docId}' and type = 'h' and subtype = '${headingType}';`
  );
  return getIdFromSqlItem(queryResult);
}

async function provideSuperBlockIds(docId: string): Promise<string[]> {
  const queryResult = await queryAPI(
    `select * from blocks where root_id = '${docId}' and type = 's'`
  );
  return getIdFromSqlItem(queryResult);
}

async function provideHighlightBlockIds(docId: string): Promise<string[]> {
  const queryResult = await queryAPI(`SELECT * FROM blocks WHERE
    root_id = '${docId}'
    AND
    type = "p"
    AND
    markdown regexp '==.*=='`);

  const finalResult: any[] = [];
  queryResult.forEach((oneResult: any) => {
    let oneContent = oneResult.markdown;
    oneContent = oneContent.replace(new RegExp("(?!<\\\\)`[^`]*`(?!`)", 'g'), '');
    const regExp = new RegExp('(?<!\\\\)==[^=]*[^\\\\]==');
    if (oneContent.match(regExp) != null) {
      finalResult.push(oneResult);
    }
  });

  return getIdFromSqlItem(finalResult);
}
