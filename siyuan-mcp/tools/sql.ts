/**
 * SQL query tools
 * Adapted from upstream to use platform abstraction
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse, createSuccessResponse } from '../utils/mcpResponse';
import { queryAPI } from '../syapi';
import { isSelectQuery } from '../utils/commonCheck';
import { debugPush } from '../logger';
import { McpToolsProvider, McpTool } from './baseToolProvider';
import { lang } from '../utils/lang';
import { getBlockDBItem } from '../syapi/custom';
import { filterBlock } from '../utils/filterCheck';

// Database schema documentation
const databaseSchema = `# SiYuan Database Schema

## Table: blocks
Main table storing all content blocks.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Block ID (format: YYYYMMDDHHmmss-xxxxxxx) |
| parent_id | TEXT | Parent block ID |
| root_id | TEXT | Document ID (root block) |
| hash | TEXT | Content hash |
| box | TEXT | Notebook ID |
| path | TEXT | Document path |
| hpath | TEXT | Human-readable path |
| name | TEXT | Block name/alias |
| alias | TEXT | Block alias |
| memo | TEXT | Block memo |
| tag | TEXT | Block tags |
| content | TEXT | Plain text content |
| fcontent | TEXT | First child content |
| markdown | TEXT | Markdown content |
| length | INTEGER | Content length |
| type | TEXT | Block type (d=doc, h=heading, p=paragraph, c=code, t=table, etc.) |
| subtype | TEXT | Block subtype (h1-h6 for headings, o/u for lists) |
| ial | TEXT | Inline Attribute List |
| sort | INTEGER | Sort order |
| created | TEXT | Creation time (YYYYMMDDHHmmss) |
| updated | TEXT | Update time (YYYYMMDDHHmmss) |

## Table: attributes
Block custom attributes.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Attribute ID |
| name | TEXT | Attribute name |
| value | TEXT | Attribute value |
| type | TEXT | Attribute type |
| block_id | TEXT | Block ID |
| root_id | TEXT | Document ID |
| box | TEXT | Notebook ID |
| path | TEXT | Document path |

## Table: assets
File assets/attachments.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Asset ID |
| block_id | TEXT | Block ID containing the asset |
| root_id | TEXT | Document ID |
| box | TEXT | Notebook ID |
| docpath | TEXT | Document path |
| path | TEXT | Asset file path |
| name | TEXT | Asset filename |
| title | TEXT | Asset title |
| hash | TEXT | File hash |

## Block Types
- d: Document
- h: Heading (subtype: h1-h6)
- p: Paragraph
- c: Code block
- t: Table
- l: List
- i: List item
- b: Blockquote
- s: Super block
- html: HTML block
- av: Attribute view (database)
- widget: Widget
- iframe: IFrame
- query_embed: Embedded query
- tb: Thematic break

## Common Query Examples

### Find documents by title
\`\`\`sql
SELECT * FROM blocks WHERE type = 'd' AND content LIKE '%keyword%'
\`\`\`

### Find blocks updated today
\`\`\`sql
SELECT * FROM blocks WHERE updated >= strftime('%Y%m%d', 'now') || '000000'
\`\`\`

### Find tagged blocks
\`\`\`sql
SELECT * FROM blocks WHERE tag LIKE '%#tagname#%'
\`\`\`

### Find blocks by custom attribute
\`\`\`sql
SELECT b.* FROM blocks b
JOIN attributes a ON b.id = a.block_id
WHERE a.name = 'custom-myattr' AND a.value = 'myvalue'
\`\`\`
`;

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
        name: 'siyuan_query_sql',
        description: `Execute SQL queries to retrieve data (including notes, documents, and their content) from the SiYuan database. This tool is also used when you need to search notes content.
Always use the 'siyuan_database_schema' tool to understand the database schema, including table names, field names, and relationships, before writing your query and use this tool.`,
        schema: {
          stmt: z.string().describe('A valid SQL SELECT statement to execute'),
        },
        handler: sqlHandler,
        title: lang('tool_title_query_sql'),
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

  if (!isSelectQuery(stmt)) {
    return createErrorResponse('Not a SELECT statement');
  }

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
