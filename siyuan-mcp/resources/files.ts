/**
 * File resources - access to files in SiYuan workspace
 * URI scheme: syfile://{path}
 *
 * Provides read access to any file in the SiYuan workspace.
 * Used by tools to return resource references for large files.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpResourceProvider, ResourceContext } from './baseResourceProvider';
import { getFileAPIv2, isTextMimeType, isTextExtension, readDirAPI } from '../syapi';
import { logPush } from '../logger';

export class FileResourceProvider extends McpResourceProvider {
  async registerResources(server: McpServer, _ctx: ResourceContext): Promise<void> {
    server.registerResource(
      'file',
      new ResourceTemplate('syfile://{+path}', {
        list: async () => {
          // List top-level directories as starting points
          const entries = await readDirAPI('/data/');
          if (!entries) {
            return { resources: [] };
          }
          return {
            resources: entries
              .filter((e: { isDir: boolean }) => e.isDir)
              .map((e: { name: string }) => ({
                uri: `syfile:///data/${e.name}/`,
                name: e.name,
                description: 'directory',
                mimeType: 'inode/directory',
              })),
          };
        },
      }),
      {
        title: 'SiYuan File',
        description: 'Access any file in SiYuan workspace. Example: syfile:///data/assets/image.png',
      },
      async (uri, params) => {
        // Extract path from params - ResourceTemplate captures it as 'path'
        const pathParam = params.path;
        const path = '/' + (Array.isArray(pathParam) ? pathParam.join('/') : pathParam);

        logPush('File resource read:', path);

        const response = await getFileAPIv2(path);
        if (!response) {
          return { contents: [{ uri: uri.href, text: `File not found: ${path}` }] };
        }

        const mimeType = response.headers.get('Content-Type')?.split(';')[0].trim() || 'application/octet-stream';
        const isText = isTextMimeType(mimeType) || isTextExtension(path);

        if (isText) {
          const text = await response.text();
          return {
            contents: [{
              uri: uri.href,
              mimeType,
              text,
            }],
          };
        }

        // Binary file - return as blob
        const arrayBuffer = await response.arrayBuffer();
        const blob = new Uint8Array(arrayBuffer).toBase64();
        return {
          contents: [{
            uri: uri.href,
            mimeType,
            blob,
          }],
        };
      }
    );
  }
}
