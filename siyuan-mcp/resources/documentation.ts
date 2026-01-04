/**
 * Static documentation resources
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider } from './baseResourceProvider';

// Import static resources
import databaseSchema from '../static/siyuan-database-schema.md';
import sqlCheatsheet from '../static/siyuan-sql-cheatsheet.md';
import querySyntax from '../static/query_syntax.md';

export class DocumentationResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer): Promise<void> {
    server.registerResource(
      'database-schema',
      'siyuan://docs/database-schema',
      {
        title: 'SiYuan Database Schema',
        description: 'Database schema documentation including table names, field names, and relationships',
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, text: databaseSchema, mimeType: 'text/markdown' }],
      })
    );

    server.registerResource(
      'sql-cheatsheet',
      'siyuan://docs/sql-cheatsheet',
      {
        title: 'SiYuan SQL Cheatsheet',
        description: 'SQL query examples for SiYuan database including FTS5 full-text search, window functions, and common patterns',
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, text: sqlCheatsheet, mimeType: 'text/markdown' }],
      })
    );

    server.registerResource(
      'query-syntax',
      'siyuan://docs/query-syntax',
      {
        title: 'SiYuan Query Syntax',
        description: 'Full-text search query syntax reference for SiYuan',
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, text: querySyntax, mimeType: 'text/markdown' }],
      })
    );
  }
}
