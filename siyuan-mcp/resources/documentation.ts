/**
 * Static documentation resources
 * Served via HTTP at /static/:name
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getDatabaseSchema, getSqlCheatsheet, getQuerySyntax } from '../static';

export class DocumentationResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, ctx: ResourceContext): Promise<void> {
    // Define docs inside method to ensure getters are resolved at runtime
    const docs = [
      {
        name: 'database-schema',
        title: 'SiYuan Database Schema',
        description: 'Database schema documentation including table names, field names, and relationships',
        getContent: getDatabaseSchema,
      },
      {
        name: 'sql-cheatsheet',
        title: 'SiYuan SQL Cheatsheet',
        description: 'SQL query examples for SiYuan database including FTS5 full-text search, window functions, and common patterns',
        getContent: getSqlCheatsheet,
      },
      {
        name: 'query-syntax',
        title: 'SiYuan Query Syntax',
        description: 'Full-text search query syntax reference for SiYuan',
        getContent: getQuerySyntax,
      },
    ];

    for (const doc of docs) {
      const uri = ctx.baseUrl ? `${ctx.baseUrl}/static/${doc.name}` : `siyuan://static/${doc.name}`;

      server.registerResource(
        doc.name,
        uri,
        {
          title: doc.title,
          description: doc.description,
          mimeType: 'text/markdown',
        },
        async (resourceUri) => {
          const content = doc.getContent();
          return {
            contents: [{ uri: resourceUri.href, text: content, mimeType: 'text/markdown' }],
          };
        }
      );
    }
  }
}
