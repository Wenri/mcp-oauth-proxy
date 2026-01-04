/**
 * Notebook resources
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getNodebookList } from '../syapi';

export class NotebookResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'notebooks',
      new ResourceTemplate('siyuan://notebooks/{notebookId}', {
        list: async () => {
          const notebooks = await getNodebookList();
          return {
            resources: notebooks.map((nb: any) => ({
              uri: `siyuan://notebooks/${nb.id}`,
              name: nb.name,
              description: nb.closed ? '(closed)' : '(open)',
              mimeType: 'application/json',
            })),
          };
        },
      }),
      {
        title: 'SiYuan Notebook',
        description: 'Notebook metadata by ID',
      },
      async (uri, params) => {
        const notebookId = Array.isArray(params.notebookId) ? params.notebookId[0] : params.notebookId;
        const notebooks = await getNodebookList();
        const notebook = notebooks.find((nb: any) => nb.id === notebookId);
        if (!notebook) {
          return { contents: [{ uri: uri.href, text: `Notebook not found: ${notebookId}` }] };
        }
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(notebook, null, 2),
          }],
        };
      }
    );
  }
}
