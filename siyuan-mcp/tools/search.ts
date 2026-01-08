/**
 * Search tools
 * Adapted from upstream - removed showMessage browser dependency
 */

import { z } from 'zod';
import { createSuccessResponse, createJsonResponse, createErrorResponse } from '../utils/mcpResponse';
import { DEFAULT_FILTER, fullTextSearchBlock, getNotebookInfo, getNodebookList } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { filterGroupSearchBlocksResult, filterSearchBlocksResult, validateBlockAccess } from '../utils/resultFilter';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { getQuerySyntax } from '../static';
import { isValidIdFormat } from '../syapi/custom';

// Schema for grouped search results (when grouped=true)
const groupedResultSchema = z.object({
  notebookId: z.string().describe('Notebook ID'),
  path: z.string().describe('Document path'),
  docId: z.string().describe('Document ID'),
  docName: z.string().describe('Document name/title'),
  hPath: z.string().describe('Human-readable path'),
  tag: z.string().describe('Document tags'),
  memo: z.string().describe('Document memo'),
  children: z.array(z.string()).describe('Matching content snippets in this document'),
});

// Schema for ungrouped search results (when grouped=false)
const ungroupedResultSchema = z.object({
  notebookId: z.string().describe('Notebook ID'),
  path: z.string().describe('Document path'),
  docId: z.string().describe('Document ID'),
  blockId: z.string().describe('Block ID'),
  content: z.string().describe('Block content (markdown)'),
  docHumanPath: z.string().describe('Human-readable document path'),
  tag: z.string().describe('Block tags'),
  memo: z.string().describe('Block memo'),
  alias: z.string().describe('Block alias'),
});

export class SearchToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_find_block',
        description:
          'Find blocks by text content using full-text search. Searches paragraphs, headings, and other content blocks. Optionally filter by document or notebook using the scope parameter. For complex queries with date ranges, path restrictions, or metadata filtering, use `siyuan_query_sql` instead.',
        inputSchema: z.object({
          query: z.string().describe('Text to search for in block content'),
          scope: z
            .string()
            .optional()
            .describe('Limit search scope: document ID, document hpath (e.g., "/Notebook/Doc"), or notebook ID'),
          fuzzy: z
            .boolean()
            .default(true)
            .describe('Use fuzzy keyword matching (true, default) or query syntax for exact phrases (false)'),
          page: z
            .number()
            .default(1)
            .describe('Page number (starting from 1), 10 results per page'),
          grouped: z
            .boolean()
            .default(true)
            .describe('Group results by document (true, default) or return individual blocks (false)'),
          orderBy: z
            .enum(['relevance', 'created', 'updated'])
            .default('relevance')
            .describe('Sort order: relevance (default), created, or updated'),
        }),
        outputSchema: z.object({
          page: z.number().describe('Current page number'),
          pageCount: z.number().describe('Total number of pages'),
          matchedBlockCount: z.number().describe('Total number of matching blocks'),
          matchedRootCount: z.number().describe('Total number of matching documents'),
          results: z.union([
            z.array(groupedResultSchema),
            z.array(ungroupedResultSchema),
          ]).describe('Search results (format depends on grouped setting)'),
        }),
        handler: findBlockHandler,
        title: lang('tool_title_search'),
        annotations: {
          readOnlyHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_query_syntax',
        description:
          "Provides documentation about SiYuan's advanced query syntax for searching content blocks, including boolean operators (AND, OR, NOT).",
        inputSchema: z.object({}),
        handler: querySyntaxHandler,
        title: lang('tool_title_query_syntax'),
        annotations: {
          readOnlyHint: true,
        },
      }),
    ];
  }
}

// Map orderBy enum to kernel numeric values
const ORDER_BY_MAP = {
  relevance: 7, // By relevance (descending)
  created: 2,   // By creation time (descending)
  updated: 4,   // By update time (descending)
} as const;

/**
 * Resolve scope to paths array for search API.
 * Scope can be: document ID, document hpath, or notebook ID.
 */
async function resolveScopeToPaths(scope: string): Promise<string[]> {
  // Try to resolve as document (ID or hpath)
  try {
    const block = await validateBlockAccess(scope);
    // Found a block - use its notebook and path
    return [`${block.box}${block.path}`];
  } catch {
    // Not a valid block/document - try as notebook ID
  }

  // Check if it's a notebook ID (direct lookup)
  if (isValidIdFormat(scope)) {
    const notebook = await getNotebookInfo(scope);
    if (notebook) {
      return [`${scope}/`];
    }
  }

  // If starts with /, might be a notebook name only (e.g., "/MyNotebook")
  if (scope.startsWith('/')) {
    const notebookName = scope.split('/').filter(s => s.length > 0)[0];
    if (notebookName) {
      const notebooks = await getNodebookList();
      const notebook = notebooks.find(nb => nb.name === notebookName);
      if (notebook) {
        return [`${notebook.id}/`];
      }
    }
  }

  throw new Error(`Invalid scope: "${scope}". Provide a document ID, hpath (e.g., "/Notebook/Doc"), or notebook ID.`);
}

async function findBlockHandler(params: {
  query: string;
  scope?: string;
  fuzzy: boolean;
  page: number;
  grouped: boolean;
  orderBy: 'relevance' | 'created' | 'updated';
}) {
  const { query, scope, fuzzy, page, grouped, orderBy } = params;
  debugPush('Find block tool called', params);

  // Build paths filter from scope
  let paths: string[] = [];
  if (scope) {
    try {
      paths = await resolveScopeToPaths(scope);
    } catch (error) {
      return createErrorResponse((error as Error).message);
    }
  }

  const queryObj: FullTextSearchQuery = {
    query,
    page,
    paths,
    types: { ...DEFAULT_FILTER },
    orderBy: ORDER_BY_MAP[orderBy],
    method: fuzzy ? 0 : 1, // 0 = keyword, 1 = query syntax
    groupBy: grouped ? 1 : 0,
  };

  const response = await fullTextSearchBlock(queryObj);

  // Determine result format based on grouped setting
  const anyResult = response?.blocks?.[0] as Record<string, unknown> | undefined;
  const isGrouped = grouped || !!anyResult?.children;
  const results = isGrouped
    ? filterGroupSearchBlocksResult(response?.blocks)
    : filterSearchBlocksResult(response?.blocks);

  debugPush('Find block tool finished');
  return createJsonResponse({
    page: page ?? 1,
    pageCount: response?.pageCount ?? 0,
    matchedBlockCount: response?.matchedBlockCount ?? 0,
    matchedRootCount: response?.matchedRootCount ?? 0,
    results,
  });
}

async function querySyntaxHandler() {
  return createSuccessResponse(getQuerySyntax());
}
