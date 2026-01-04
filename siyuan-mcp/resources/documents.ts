/**
 * Document resources
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider } from './baseResourceProvider';
import { getDoc } from '../syapi';
import { getDocDBitem } from '../syapi/custom';

export class DocumentResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer): Promise<void> {
    server.registerResource(
      'document',
      new ResourceTemplate('siyuan://doc/{docId}', {
        list: undefined, // Too many docs to list
      }),
      {
        title: 'SiYuan Document',
        description: 'Document content in Markdown format by ID',
      },
      async (uri, params) => {
        const docId = Array.isArray(params.docId) ? params.docId[0] : params.docId;
        const docInfo = await getDocDBitem(docId);
        if (!docInfo) {
          return { contents: [{ uri: uri.href, text: `Document not found: ${docId}` }] };
        }
        const doc = await getDoc(docId);
        if (!doc?.content) {
          return { contents: [{ uri: uri.href, text: `Failed to read document: ${docId}` }] };
        }
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: doc.content,
          }],
        };
      }
    );
  }
}
