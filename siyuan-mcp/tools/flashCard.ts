/**
 * Flashcard tools
 */

import { addRiffCards, removeRiffCards } from '../syapi';
import { getBlockDBItem, isValidDeck, QUICK_DECK_ID, cachedQuery } from '../syapi/custom';
import { isValidStr } from '../utils/commonCheck';
import { createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { McpToolsProvider, createNewDocWithParentId } from './baseToolProvider';
import { z } from 'zod';
import { TASK_STATUS, taskManager } from '../utils/historyTaskHelper';
import { filterBlock } from '../utils/resultFilter';
import { getConfig } from '..';

const TYPE_VALID_LIST = ['h1', 'h2', 'h3', 'h4', 'h5', 'highlight', 'superBlock'] as const;

export class FlashcardToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_create_flashcards_with_new_doc',
        description: 'Create New Document, and Make Flashcards with Specific Method',
        inputSchema: {
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
        outputSchema: z.object({
          docId: z.string().describe('ID of the newly created document'),
          cardCount: z.number().describe('Number of flashcards created'),
        }),
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
        inputSchema: {
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
        inputSchema: {
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
    parentId: NotebookId | DocumentId;
    docTitle: string;
    type: (typeof TYPE_VALID_LIST)[number];
    deckId?: string;
    markdownContent: string;
  }
) {
  let { parentId, docTitle, type, deckId, markdownContent } = params;

  if (await filterBlock(parentId, null)) {
    throw new Error(
      'The specified document or block is excluded by the user settings, so cannot create a new note under it.'
    );
  }

  if (!isValidStr(deckId)) {
    deckId = QUICK_DECK_ID;
  }
  if (!(await isValidDeck(deckId!))) {
    throw new Error(
      'Card creation failed: DeckId does not exist. If user did not specify a deck name or ID, set deckId to ""'
    );
  }

  const config = getConfig();
  if (type === 'highlight' && !config.editor?.markdown?.inlineMath) {
    throw new Error(
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
    return createJsonResponse({ docId: newDocId, cardCount: addCardsResult });
  } else {
    throw new Error('Card creation failed: Unknown error while creating flashcard document');
  }
}

async function createFlashcardsHandler(
  params: { blockIds: BlockId[]; deckId?: string }
) {
  let { blockIds, deckId } = params;

  if (!isValidStr(deckId)) {
    deckId = QUICK_DECK_ID;
  }
  if (!(await isValidDeck(deckId!))) {
    throw new Error(
      'Card creation failed: The DeckId does not exist. If the user has not specified a deck name or ID, set the deckId parameter to an empty string.'
    );
  }

  const filteredIds: BlockId[] = [];
  for (let i = 0; i < blockIds.length; i++) {
    const blockId = blockIds[i];
    const dbItem = await getBlockDBItem(blockId);
    if (dbItem == null) {
      throw new Error(
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
    throw new Error('Failed to create flashcards.');
  }
  return createSuccessResponse(`Created ${filteredIds.length} flashcards`);
}

async function deleteFlashcardsHandler(params: { blockIds: BlockId[]; deckId?: string }) {
  let { blockIds, deckId } = params;

  if (!isValidStr(deckId)) {
    deckId = '';
  }
  if ((await isValidDeck(deckId!)) === false && deckId !== '') {
    throw new Error(
      'Card deletion failed: The DeckId does not exist. If the user has not specified a deck name or ID, set the deckId parameter to an empty string.'
    );
  }

  const removeResult = await removeRiffCards(blockIds, deckId!);
  if (removeResult === null) {
    throw new Error('Failed to delete flashcards.');
  }
  return createSuccessResponse(`Removed ${blockIds.length} flashcards`);
}

async function parseDocAddCards(
  docId: DocumentId,
  addType: string,
  deckId: string
): Promise<number> {
  const functionDict: Record<string, () => Promise<BlockId[]>> = {
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

function getIdFromSqlItem(sqlResponse: Block[]): BlockId[] {
  sqlResponse = sqlResponse ?? [];
  return sqlResponse.map((item) => item.id);
}

async function provideHeadingIds(docId: DocumentId, headingType: string): Promise<BlockId[]> {
  const stmt = `select id from blocks where root_id = '${docId}' and type = 'h' and subtype = '${headingType}';`;
  const queryResult = await cachedQuery('/custom/headingIds', { docId, headingType }, stmt);
  return getIdFromSqlItem(queryResult);
}

async function provideSuperBlockIds(docId: DocumentId): Promise<BlockId[]> {
  const stmt = `select * from blocks where root_id = '${docId}' and type = 's'`;
  const queryResult = await cachedQuery('/custom/superBlockIds', { docId }, stmt);
  return getIdFromSqlItem(queryResult);
}

async function provideHighlightBlockIds(docId: DocumentId): Promise<BlockId[]> {
  const stmt = `SELECT * FROM blocks WHERE root_id = '${docId}' AND type = "p" AND markdown regexp '==.*=='`;
  const queryResult = await cachedQuery('/custom/highlightBlockIds', { docId }, stmt);

  const finalResult: Block[] = [];
  queryResult.forEach((oneResult) => {
    let oneContent = oneResult.markdown;
    oneContent = oneContent.replace(new RegExp("(?!<\\\\)`[^`]*`(?!`)", 'g'), '');
    const regExp = new RegExp('(?<!\\\\)==[^=]*[^\\\\]==');
    if (oneContent.match(regExp) != null) {
      finalResult.push(oneResult);
    }
  });

  return getIdFromSqlItem(finalResult);
}
