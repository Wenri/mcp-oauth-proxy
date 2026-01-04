/**
 * Notebook resources
 * URI scheme: synb://{id} or synb://{name}
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getNodebookList } from '../syapi';

/** Check if string matches SiYuan ID pattern (14 digits + hyphen + 7 chars) */
const isSiyuanId = (s: string) => /^\d{14}-[a-z0-9]{7}$/.test(s);

export class NotebookResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'notebook',
      new ResourceTemplate('synb://{ref}', {
        list: async () => {
          const notebooks = await getNodebookList();
          return {
            resources: notebooks.map((nb: any) => ({
              uri: `synb://${nb.id}`,
              name: nb.name,
              description: nb.closed ? '(closed)' : '(open)',
              mimeType: 'application/json',
            })),
          };
        },
      }),
      {
        title: 'SiYuan Notebook',
        description: 'Notebook by ID or name. Examples: synb://20241231120000-abc1234, synb://My Notebook',
      },
      async (uri, params) => {
        const ref = decodeURIComponent(Array.isArray(params.ref) ? params.ref[0] : params.ref);
        const notebooks = await getNodebookList();

        // Find by ID or name
        const notebook = isSiyuanId(ref)
          ? notebooks.find((nb: any) => nb.id === ref)
          : notebooks.find((nb: any) => nb.name === ref);

        if (!notebook) {
          return { contents: [{ uri: uri.href, text: `Notebook not found: ${ref}` }] };
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
