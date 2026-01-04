/**
 * Block resources
 * URI scheme: syblk://{id}
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getKramdown } from '../syapi';
import { getBlockDBItem } from '../syapi/custom';

export class BlockResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'block',
      new ResourceTemplate('syblk://{id}', {
        list: undefined, // Too many blocks to list
      }),
      {
        title: 'SiYuan Block',
        description: 'Block content in Kramdown format by ID. Example: syblk://20241231120000-abc1234',
      },
      async (uri, params) => {
        const blockId = Array.isArray(params.id) ? params.id[0] : params.id;
        const blockInfo = await getBlockDBItem(blockId);
        if (!blockInfo) {
          return { contents: [{ uri: uri.href, text: `Block not found: ${blockId}` }] };
        }
        const kramdown = await getKramdown(blockId);
        if (!kramdown) {
          return { contents: [{ uri: uri.href, text: `Failed to read block: ${blockId}` }] };
        }
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: kramdown,
          }],
        };
      }
    );
  }
}
