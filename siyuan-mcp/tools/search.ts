/**
 * Search tools
 * Adapted from upstream - removed showMessage browser dependency
 */

import { z } from 'zod';
import { createSuccessResponse, createJsonResponse } from '../utils/mcpResponse';
import { DEFAULT_FILTER, fullTextSearchBlock } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { filterGroupSearchBlocksResult, filterSearchBlocksResult } from '../utils/resultFilter';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { getQuerySyntax } from '../static';

// Schema for grouped search results (when groupBy=1)
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

// Schema for ungrouped search results (when groupBy=0)
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
    // Note: Original upstream returns empty array with "// # 16" comment
    // We keep the tools available for CF Worker implementation
    return [
      defineTool({
        name: 'siyuan_search',
        description:
          'Perform a keyword-based full-text search across blocks in SiYuan (e.g., paragraphs, headings). This tool only matches literal text content in document bodies or headings. For dynamic queries (dailynote(i.e. diary), path restrictions, date ranges), use sql with `siyuan_query_sql` tool instead. Results are grouped by their containing documents with limit page size 10.',
        inputSchema: z.object({
          query: z.string().describe('The keyword or phrase to search for across content blocks.'),
          page: z
            .number()
            .default(1)
            .describe('The page number of the search results to return (starting from 1).'),
          includingCodeBlock: z
            .boolean()
            .default(false)
            .describe('Whether to include code blocks in the search results.'),
          includingDatabase: z
            .boolean()
            .default(false)
            .describe('Whether to include database blocks in the search results.'),
          method: z
            .number()
            .default(0)
            .describe(
              'Search method: 0 for keyword search, 1 for query syntax (see `siyuan_query_syntax`), 2 for regular expression matching.'
            ),
          orderBy: z.number().default(0).describe(`Sorting method for results:
            0: By block type (default)
            1: By creation time (ascending)
            2: By creation time (descending)
            3: By update time (ascending)
            4: By update time (descending)
            5: By content order (only when grouped by document)
            6: By relevance (ascending)
            7: By relevance (descending)
          `),
          groupBy: z.number().default(1).describe(`Grouping method for results:
            0: No grouping - returns individual blocks matching the search criteria
            1: Group by document (default) - returns hits organized by their parent documents
          `),
        }),
        outputSchema: z.object({
          page: z.number().describe('Current page number'),
          pageCount: z.number().describe('Total number of pages'),
          matchedBlockCount: z.number().describe('Total number of matching blocks'),
          matchedRootCount: z.number().describe('Total number of matching documents'),
          results: z.union([
            z.array(groupedResultSchema),
            z.array(ungroupedResultSchema),
          ]).describe('Search results (format depends on groupBy setting)'),
        }),
        handler: searchHandler,
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

async function searchHandler(params: {
  query: string;
  page: number;
  includingCodeBlock: boolean;
  includingDatabase: boolean;
  method: number;
  orderBy: number;
  groupBy: number;
}) {
  const { query, page, includingCodeBlock, includingDatabase, method, orderBy, groupBy } = params;
  debugPush('Search tool called', params);

  const queryObj: FullTextSearchQuery = {
    query,
    page,
    types: { ...DEFAULT_FILTER },
    orderBy,
    method,
    groupBy,
  };
  queryObj.types!.codeBlock = includingCodeBlock;
  queryObj.types!.databaseBlock = includingDatabase;

  const response = await fullTextSearchBlock(queryObj);

  // Determine result format based on groupBy setting
  const anyResult = response?.blocks?.[0] as Record<string, unknown> | undefined;
  const isGrouped = groupBy === 1 || !!anyResult?.children;
  const results = isGrouped
    ? filterGroupSearchBlocksResult(response?.blocks)
    : filterSearchBlocksResult(response?.blocks);

  debugPush('Search tool finished');
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
