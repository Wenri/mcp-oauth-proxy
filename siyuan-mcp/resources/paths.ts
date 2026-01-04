/**
 * Path resources - access documents by human-readable path
 * URI scheme: sypath://{notebook}/{hpath}
 *
 * The hpath system resembles a filesystem:
 * - Notebooks are referenced by name
 * - Documents are referenced by their human-readable path within the notebook
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getNodebookList, getDoc, getDocIDByHPath } from '../syapi';
import YAML from 'yaml';

export class PathResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'path',
      new ResourceTemplate('sypath://{+path}', {
        list: async () => {
          // List all notebooks as entry points
          const notebooks = await getNodebookList();
          return {
            resources: notebooks.map((nb: any) => ({
              uri: `sypath://${encodeURIComponent(nb.name)}`,
              name: nb.name,
              description: nb.closed ? 'notebook (closed)' : 'notebook',
              mimeType: 'text/markdown',
            })),
          };
        },
      }),
      {
        title: 'SiYuan Path',
        description: 'Access document by human-readable path. Format: sypath://Notebook Name/path/to/document',
      },
      async (uri, params) => {
        const fullPath = decodeURIComponent(Array.isArray(params.path) ? params.path[0] : params.path);

        // Parse: first segment is notebook name, rest is hpath
        const firstSlash = fullPath.indexOf('/');
        const notebookName = firstSlash > 0 ? fullPath.slice(0, firstSlash) : fullPath;
        const hpath = firstSlash > 0 ? '/' + fullPath.slice(firstSlash + 1) : '/';

        // Find notebook by name
        const notebooks = await getNodebookList();
        const notebook = notebooks.find((nb: any) => nb.name === notebookName);
        if (!notebook) {
          return { contents: [{ uri: uri.href, text: `Notebook not found: ${notebookName}` }] };
        }

        // If only notebook specified, return notebook info
        if (hpath === '/') {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/yaml',
              text: YAML.stringify(notebook),
            }],
          };
        }

        // Get document by hpath
        const docId = await getDocIDByHPath(notebook.id, hpath);
        if (!docId) {
          return { contents: [{ uri: uri.href, text: `Document not found: ${notebookName}${hpath}` }] };
        }

        const doc = await getDoc(docId);
        if (!doc?.content) {
          return { contents: [{ uri: uri.href, text: `Failed to read document: ${notebookName}${hpath}` }] };
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/html',
            text: doc.content,
          }],
        };
      }
    );
  }
}
