/**
 * File system tools for SiYuan workspace
 */

import { z } from 'zod';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { createJsonResponse, createArrayResponse, createSuccessResponse, createImageContent, createAudioContent, createBlobResource, createResourceLink } from '../utils/mcpResponse';
import { getFileAPIv2, putFileAPI, removeFileAPI, renameFileAPI, readDirAPI, exportResourcesAPI, limitedRead } from '../syapi';
import { ResolvedContent, inferContentType, type ContentType } from '../utils/contentResolver';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { buildDownloadUrl, getTokenTtl } from '../server';
import { jsonValueSchema, type JsonValue } from '../types';
import { getContentCategory } from '../utils/contentType';
import { assertNonEmptyArray, assertApiResult } from '../utils/commonCheck';

export class FileSystemToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_read_file',
        description:
          'Read a file from SiYuan workspace. For text files, returns content in structured data. For media files (images/audio), returns metadata in structured data and the binary content as separate MCP content blocks. For other binary files, returns metadata with download URL only.',
        inputSchema: z.object({
          path: z
            .string()
            .describe('Path to the file in workspace (e.g., "/data/assets/image.png", "/data/widgets/config.json")'),
        }),
        outputSchema: z.object({
          path: z.string().describe('Path of the file'),
          type: z.enum(['text', 'image', 'audio', 'binary']).describe('Content type: text/image/audio (in extraContent), binary (download only)'),
          mimeType: z.string().describe('MIME type of the file'),
          downloadUrl: z.string().describe('URL to download the file'),
          expiresAt: z.string().nullable().describe('When the download URL expires'),
        }),
        handler: readFileHandler,
        title: lang('tool_title_read_file'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_write_file',
        description:
          'Write content to a file in SiYuan workspace. Content can be text, base64-encoded binary, JSON object/array, or a URL to fetch from.',
        inputSchema: z.object({
          path: z.string().describe('Path to write the file (e.g., "/data/widgets/config.json")'),
          content: z.union([
            z.string().describe('Text, base64/hex-encoded binary, or URL (see type parameter)'),
            z.record(z.string(), jsonValueSchema).describe('JSON object (auto-serialized)'),
            z.array(jsonValueSchema).describe('JSON array (auto-serialized)'),
          ]).describe('File content to write'),
          type: z.enum(['text', 'base64', 'hex', 'json', 'url']).optional().describe('Content type: text (default for strings), base64, hex, json (auto for objects/arrays), url (fetch from URL)'),
        }),
        handler: writeFileHandler,
        title: lang('tool_title_write_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_remove_file',
        description: 'Delete a file or directory from SiYuan workspace.',
        inputSchema: z.object({
          path: z.string().describe('Path to the file or directory to delete'),
        }),
        handler: removeFileHandler,
        title: lang('tool_title_remove_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_rename_file',
        description: 'Rename or move a file within SiYuan workspace.',
        inputSchema: z.object({
          path: z.string().describe('Current path of the file'),
          newPath: z.string().describe('New path for the file'),
        }),
        handler: renameFileHandler,
        title: lang('tool_title_rename_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_list_dir',
        description:
          'List contents of a directory in SiYuan workspace. Returns file/directory names with metadata.',
        inputSchema: z.object({
          path: z.string().describe('Path to the directory (e.g., "/data/assets/", "/data/widgets/")'),
        }),
        outputSchema: z.object({
          count: z.number().describe('Number of entries'),
          path: z.string().describe('Path of the directory'),
          entries: z
            .array(
              z.object({
                name: z.string().describe('File or directory name'),
                isDir: z.boolean().describe('Whether this is a directory'),
                isSymlink: z.boolean().describe('Whether this is a symbolic link'),
                updated: z.number().describe('Modification time (Unix timestamp)'),
              })
            )
            .describe('Array of file/directory entries'),
        }),
        handler: listDirHandler,
        title: lang('tool_title_list_dir'),
        annotations: { readOnlyHint: true },
      }),
      defineTool({
        name: 'siyuan_create_dir',
        description: 'Create a new directory in SiYuan workspace.',
        inputSchema: z.object({
          path: z.string().describe('Path for the new directory (e.g., "/data/assets/my-folder/")'),
        }),
        handler: createDirHandler,
        title: lang('tool_title_create_dir'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_create_archive',
        description:
          'Create a zip archive from files or directories in SiYuan workspace. Returns a download URL for the zip file. Can archive any workspace path including assets, widgets, notebooks, etc.',
        inputSchema: z.object({
          paths: z
            .array(z.string())
            .describe('Array of file/directory paths to archive (e.g., ["/data/assets/", "/data/widgets/config.json"])'),
          name: z.string().optional().describe('Custom name for the archive (without .zip extension)'),
        }),
        outputSchema: z.object({
          fileName: z.string().describe('Name of the created zip file'),
          downloadUrl: z.string().describe('URL to download the zip file'),
          expiresAt: z.string().nullable().describe('When the download URL expires'),
          paths: z.array(z.string()).describe('Array of paths that were archived'),
        }),
        handler: createArchiveHandler,
        title: lang('tool_title_create_archive'),
        annotations: { readOnlyHint: true },
      }),
    ];
  }
}

async function readFileHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Read file API called');

  if (!path) {
    throw new Error('Path is required.');
  }

  const cacheTtl = getTokenTtl();
  const response = await getFileAPIv2(path, cacheTtl);
  if (response === null) {
    throw new Error('File not found or failed to read.');
  }

  const mimeType = response.headers.get('Content-Type')?.split(';')[0].trim() || 'application/octet-stream';
  const downloadUrl = await buildDownloadUrl(path);
  const expiresAt = cacheTtl > 0 ? new Date(Date.now() + cacheTtl * 1000).toISOString() : null;
  const contentType = getContentCategory(mimeType, path);

  const MAX_INLINE_SIZE = 512 * 1024; // 512KB
  const contentLength = response.headers.get('Content-Length');
  const knownSize = contentLength ? parseInt(contentLength, 10) : null;

  // Resource URI for syfile:// scheme (used by FileResourceProvider)
  const resourceUri = `syfile://${path}`;

  // Base metadata for all responses
  const metadata = { path, type: contentType, mimeType, downloadUrl, expiresAt };

  // Helper to create response with inline content
  const createInlineResponse = (data: Uint8Array) => {
    let extraContent: ContentBlock[];

    if (contentType === 'text') {
      // Text: return as simple text content block
      extraContent = [{ type: 'text', text: new TextDecoder().decode(data) }];
    } else if (contentType === 'image') {
      // Image: return as image content block
      extraContent = [createImageContent(data.toBase64(), mimeType)];
    } else if (contentType === 'audio') {
      // Audio: return as audio content block
      extraContent = [createAudioContent(data.toBase64(), mimeType)];
    } else {
      // Other binary: return as embedded resource with blob
      extraContent = [createBlobResource(resourceUri, data.toBase64(), mimeType)];
    }

    return createJsonResponse(metadata, extraContent);
  };

  // Helper to create response with resource link (for large files)
  const createRefResponse = () => {
    // Return resource link - client can fetch via FileResourceProvider
    const fileName = path.split('/').pop() || path;
    const extraContent: ContentBlock[] = [createResourceLink(resourceUri, fileName, mimeType)];
    return createJsonResponse(metadata, extraContent);
  };

  // Fast path: Content-Length tells us the size
  if (knownSize !== null) {
    if (knownSize <= MAX_INLINE_SIZE) {
      const data = new Uint8Array(await response.arrayBuffer());
      return createInlineResponse(data);
    }
    // Too large for inline - return resource reference
    return createRefResponse();
  }

  // Slow path: No Content-Length, try limitedRead
  const data = await limitedRead(response.body!, MAX_INLINE_SIZE);
  if (data) {
    return createInlineResponse(data);
  }
  // Too large or failed - return resource reference
  return createRefResponse();
}

async function writeFileHandler(params: {
  path: string;
  content: string | JsonValue[] | Record<string, JsonValue>;
  type?: ContentType;
}) {
  const { path, content, type } = params;
  debugPush('Write file API called');

  if (!path) {
    throw new Error('Path is required.');
  }

  // Resolve content using ResolvedContent.from()
  const fileName = path.split('/').pop();
  const resolvedType = type ?? inferContentType(content, 'text');
  const resolved = await ResolvedContent.from(content, resolvedType, fileName);

  const result = await putFileAPI(path, resolved);
  if (!result) {
    throw new Error('Failed to write the file.');
  }

  return createSuccessResponse(path);
}

async function removeFileHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Remove file API called');

  if (!path) {
    throw new Error('Path is required.');
  }

  const result = await removeFileAPI(path);
  if (!result) {
    throw new Error('Failed to remove the file or directory.');
  }

  return createSuccessResponse('File removed');
}

async function renameFileHandler(params: { path: string; newPath: string }) {
  const { path, newPath } = params;
  debugPush('Rename file API called');

  if (!path || !newPath) {
    throw new Error('Both path and newPath are required.');
  }

  const result = await renameFileAPI(path, newPath);
  if (!result) {
    throw new Error('Failed to rename the file.');
  }

  return createSuccessResponse(newPath);
}

async function listDirHandler(params: { path: string }) {
  const { path } = params;
  debugPush('List directory API called');

  if (!path) {
    throw new Error('Path is required.');
  }

  const result = await readDirAPI(path);
  if (result === null) {
    throw new Error('Directory not found or failed to read.');
  }

  return createArrayResponse(result, 'entries', { path });
}

async function createDirHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Create directory API called');

  if (!path) {
    throw new Error('Path is required.');
  }

  // Use putFile with isDir=true to create a directory
  const result = await putFileAPI(path, '', true);
  if (!result) {
    throw new Error('Failed to create the directory.');
  }

  return createSuccessResponse(path);
}

async function createArchiveHandler(params: { paths: string[]; name?: string }) {
  const { paths, name } = params;
  debugPush('Create archive API called');

  assertNonEmptyArray(paths, 'path');

  // Create the zip archive on SiYuan server
  const result = assertApiResult(await exportResourcesAPI(paths, name), 'create archive');
  if (!result.path) {
    throw new Error('Failed to create archive.');
  }

  const fileName = result.path.split('/').pop() || 'archive.zip';
  const downloadUrl = await buildDownloadUrl(result.path);
  const cacheTtl = getTokenTtl();
  const expiresAt = cacheTtl > 0 ? new Date(Date.now() + cacheTtl * 1000).toISOString() : null;

  return createJsonResponse({
    fileName,
    downloadUrl,
    expiresAt,
    paths: paths,
  });
}
