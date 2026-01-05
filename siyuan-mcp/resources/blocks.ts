/**
 * Block resources - unified access to notebooks, documents, and blocks by ID
 * URI scheme: syblk://{id}
 *
 * In SiYuan, notebooks, documents, and blocks all have unique IDs.
 * This resource provides unified access to any of them.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getNodebookList, getDoc, getKramdown } from '../syapi';
import { getBlockDBItem } from '../syapi/custom';
import YAML from 'yaml';

export class BlockResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'block',
      new ResourceTemplate('syblk://{id}', {
        list: async () => {
          // List notebooks as top-level blocks
          const notebooks = await getNodebookList();
          return {
            resources: notebooks.map((nb: any) => ({
              uri: `syblk://${nb.id}`,
              name: nb.name,
              description: nb.closed ? 'notebook (closed)' : 'notebook (open)',
              mimeType: 'text/yaml',
            })),
          };
        },
      }),
      {
        title: 'SiYuan Block',
        description: 'Access any block by ID - works for notebooks, documents, and blocks. Example: syblk://20241231120000-abc1234',
      },
      async (uri, params) => {
        const id = Array.isArray(params.id) ? params.id[0] : params.id;

        // Check if it's a notebook
        const notebooks = await getNodebookList();
        const notebook = notebooks.find((nb: any) => nb.id === id);
        if (notebook) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/yaml',
              text: YAML.stringify(notebook),
            }],
          };
        }

        // Check if it's a block/document
        const blockInfo = await getBlockDBItem(id);
        if (!blockInfo) {
          return { contents: [{ uri: uri.href, text: `Block not found: ${id}` }] };
        }

        // Document: return full HTML content
        if (blockInfo.type === 'd') {
          const doc = await getDoc(id);
          if (!doc?.content) {
            return { contents: [{ uri: uri.href, text: `Failed to read document: ${id}` }] };
          }
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/html',
              text: doc.content,
            }],
          };
        }

        // Other blocks: return kramdown
        const result = await getKramdown(id);
        if (!result) {
          return { contents: [{ uri: uri.href, text: `Failed to read block: ${id}` }] };
        }
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: result.kramdown,
          }],
        };
      }
    );
  }
}
