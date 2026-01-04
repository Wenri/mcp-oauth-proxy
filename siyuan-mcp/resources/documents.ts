/**
 * Document resources
 * URI scheme: sydoc://{id} or sydoc://{notebookId}/{hpath}
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getDoc, getDocIDByHPath } from '../syapi';
import { getDocDBitem } from '../syapi/custom';

/** Check if string matches SiYuan ID pattern (14 digits + hyphen + 7 chars) */
const isSiyuanId = (s: string) => /^\d{14}-[a-z0-9]{7}$/.test(s);

export class DocumentResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'document',
      new ResourceTemplate('sydoc://{+ref}', {
        list: undefined, // Too many docs to list
      }),
      {
        title: 'SiYuan Document',
        description: 'Document by ID or hpath. Examples: sydoc://20241231120000-abc1234, sydoc://notebook-id/path/to/doc',
      },
      async (uri, params) => {
        const ref = decodeURIComponent(Array.isArray(params.ref) ? params.ref[0] : params.ref);

        let docId: string | null = null;

        if (isSiyuanId(ref)) {
          // Direct ID reference
          docId = ref;
        } else {
          // hpath format: notebookId/path/to/doc
          const slashIndex = ref.indexOf('/');
          if (slashIndex > 0) {
            const notebookId = ref.slice(0, slashIndex);
            const hpath = '/' + ref.slice(slashIndex + 1);
            docId = await getDocIDByHPath(notebookId, hpath);
          }
        }

        if (!docId) {
          return { contents: [{ uri: uri.href, text: `Document not found: ${ref}` }] };
        }

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
