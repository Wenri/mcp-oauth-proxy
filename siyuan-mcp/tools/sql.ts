/**
 * SQL query tools
 * Adapted from upstream to use platform abstraction
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { queryAPI } from '../syapi';
import { debugPush } from '../logger';
import { McpToolsProvider } from './baseToolProvider';
import { lang } from '../utils/lang';
import { getBlockDBItem } from '../syapi/custom';
import { filterBlock } from '../utils/filterCheck';
import databaseSchema from '../static/siyuan-database-schema.md';
import sqlCheatsheet from '../static/siyuan-sql-cheatsheet.md';

export class SqlToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_database_schema',
        description:
          'Provides the SiYuan database schema, including table names, field names, and their relationships, to help construct valid SQL queries for retrieving notes or note content. Returns the schema in markdown format.',
        schema: {},
        handler: schemaHandler,
        title: lang('tool_title_database_schema'),
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: 'siyuan_sql_cheatsheet',
        description:
          'Provides a SQL cheatsheet with query examples for SiYuan database, including FTS5 full-text search, window functions, JSON operations, and common patterns.',
        schema: {},
        handler: cheatsheetHandler,
        title: lang('tool_title_sql_cheatsheet'),
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: 'siyuan_query_sql',
        description: `Execute SQL queries on SiYuan's SQLite database (read-only). Supports advanced features:

**Full-Text Search (FTS5)**: Use \`blocks_fts_case_insensitive\` for fast text search with BM25 ranking.
**REGEXP**: Pattern matching with \`WHERE content REGEXP 'pattern'\`.
**Window Functions**: ROW_NUMBER(), LAG(), LEAD(), NTILE(), PERCENT_RANK(), etc.
**JSON Functions**: json_extract(), json_object(), json_group_array(), ->, ->>.

Example FTS5 query:
\`\`\`sql
SELECT id, content, bm25(blocks_fts_case_insensitive) as score
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'keyword'
ORDER BY score LIMIT 20
\`\`\`

Use 'siyuan_database_schema' for schema reference and 'siyuan_sql_cheatsheet' for query examples.`,
        schema: {
          stmt: z.string().describe('SQL statement to execute (read-only, writes do not persist)'),
        },
        handler: sqlHandler,
        title: lang('tool_title_query_sql'),
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: 'siyuan_fulltext_search',
        description:
          'Fast full-text search using FTS5 with BM25 relevance ranking. Returns matching blocks with highlighted snippets. Supports FTS5 query syntax: AND (implicit), OR, NOT, "exact phrase", prefix*, column:term.',
        schema: {
          query: z.string().describe('FTS5 search query. Examples: "neural network", "python OR javascript", "machine NOT learning", "\\"exact phrase\\"", "neuro*"'),
          limit: z.number().optional().default(20).describe('Maximum results to return (default: 20)'),
          snippetLength: z.number().optional().default(64).describe('Number of tokens around match in snippet (default: 64)'),
          caseSensitive: z.boolean().optional().default(false).describe('Use case-sensitive search (default: false)'),
        },
        handler: fulltextSearchHandler,
        title: lang('tool_title_fulltext_search'),
        annotations: {
          readOnlyHint: true,
        },
      },
    ];
  }
}

async function sqlHandler(params: { stmt: string }) {
  const { stmt } = params;
  debugPush('SQL API called', stmt);

  let sqlResult;
  try {
    sqlResult = await queryAPI(stmt);
  } catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }

  debugPush('SQL result', sqlResult);

  // Filter results if they contain id field
  if (sqlResult.length > 0 && sqlResult.length < 300 && 'id' in sqlResult[0]) {
    const filteredResult = [];
    for (const row of sqlResult) {
      const id = row['id'];
      const dbItem = await getBlockDBItem(id);
      if (dbItem && (await filterBlock(id, dbItem)) === false) {
        filteredResult.push(dbItem);
      }
    }
    sqlResult = filteredResult;
  }

  return createJsonResponse(sqlResult);
}

async function schemaHandler() {
  debugPush('Schema API called');
  return createSuccessResponse(databaseSchema);
}

async function cheatsheetHandler() {
  debugPush('SQL cheatsheet API called');
  return createSuccessResponse(sqlCheatsheet);
}

async function fulltextSearchHandler(params: {
  query: string;
  limit?: number;
  snippetLength?: number;
  caseSensitive?: boolean;
}) {
  const { query, limit = 20, snippetLength = 64, caseSensitive = false } = params;
  debugPush('Fulltext search API called', query);

  if (!query || query.trim() === '') {
    return createErrorResponse('Search query cannot be empty');
  }

  const ftsTable = caseSensitive ? 'blocks_fts' : 'blocks_fts_case_insensitive';

  // Column 5 is 'content' in the FTS5 table (0-indexed: id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content=11)
  const contentColumn = 11;

  const stmt = `
    SELECT
      id,
      root_id,
      box,
      hpath,
      type,
      snippet(${ftsTable}, ${contentColumn}, '<mark>', '</mark>', '...', ${snippetLength}) as snippet,
      bm25(${ftsTable}) as relevance
    FROM ${ftsTable}
    WHERE ${ftsTable} MATCH '${query.replace(/'/g, "''")}'
    ORDER BY relevance
    LIMIT ${limit}
  `;

  let sqlResult;
  try {
    sqlResult = await queryAPI(stmt);
  } catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : String(error));
  }

  // Filter results
  if (sqlResult.length > 0 && 'id' in sqlResult[0]) {
    const filteredResult = [];
    for (const row of sqlResult) {
      const id = row['id'];
      const dbItem = await getBlockDBItem(id);
      if (dbItem && (await filterBlock(id, dbItem)) === false) {
        filteredResult.push({
          ...row,
          type: dbItem.type,
          subtype: dbItem.subtype,
        });
      }
    }
    sqlResult = filteredResult;
  }

  return createJsonResponse({
    query,
    resultCount: sqlResult.length,
    results: sqlResult,
  });
}
