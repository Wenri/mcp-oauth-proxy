/**
 * File system tools for SiYuan workspace
 */

import { z } from 'zod';
import { createJsonResponse, createArrayResponse, createSuccessResponse } from '../utils/mcpResponse';
import { getFileAPIv2, isTextMimeType, isTextExtension, putFileAPI, removeFileAPI, renameFileAPI, readDirAPI, exportResourcesAPI, limitedRead } from '../syapi';
import { base64ToBlob } from '../utils/common';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { buildDownloadUrl, getTokenTtl } from '..';

export class FileSystemToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_read_file',
        description:
          'Read a file from SiYuan workspace. For text files (detected via Content-Type or extension), returns the content directly. For binary files (images, etc.), returns metadata with a download URL.',
        inputSchema: {
          path: z
            .string()
            .describe('Path to the file in workspace (e.g., "/data/assets/image.png", "/data/widgets/config.json")'),
        },
        outputSchema: {
          path: z.string().describe('Path of the file'),
          content: z.string().optional().describe('File content (text or base64 encoded)'),
          type: z.enum(['text', 'binary']).describe('Whether the file is text or binary'),
          mimeType: z.string().describe('MIME type of the file'),
          downloadUrl: z.string().describe('URL to download the file'),
          expiresAt: z.string().nullable().describe('When the download URL expires'),
          encoding: z.string().optional().describe('Content encoding (e.g., "base64" for binary)'),
        },
        handler: readFileHandler,
        title: lang('tool_title_read_file'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_write_file',
        description:
          'Write content to a file in SiYuan workspace. For text content, pass the string directly. For binary content, pass base64 encoded data.',
        inputSchema: {
          path: z.string().describe('Path to write the file (e.g., "/data/widgets/config.json")'),
          content: z.string().describe('File content (text or base64 encoded for binary)'),
          isBase64: z.boolean().optional().describe('Set to true if content is base64 encoded binary data'),
        },
        handler: writeFileHandler,
        title: lang('tool_title_write_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_remove_file',
        description: 'Delete a file or directory from SiYuan workspace.',
        inputSchema: {
          path: z.string().describe('Path to the file or directory to delete'),
        },
        handler: removeFileHandler,
        title: lang('tool_title_remove_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_rename_file',
        description: 'Rename or move a file within SiYuan workspace.',
        inputSchema: {
          path: z.string().describe('Current path of the file'),
          newPath: z.string().describe('New path for the file'),
        },
        handler: renameFileHandler,
        title: lang('tool_title_rename_file'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_list_dir',
        description:
          'List contents of a directory in SiYuan workspace. Returns file/directory names with metadata.',
        inputSchema: {
          path: z.string().describe('Path to the directory (e.g., "/data/assets/", "/data/widgets/")'),
        },
        outputSchema: {
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
        },
        handler: listDirHandler,
        title: lang('tool_title_list_dir'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_create_dir',
        description: 'Create a new directory in SiYuan workspace.',
        inputSchema: {
          path: z.string().describe('Path for the new directory (e.g., "/data/assets/my-folder/")'),
        },
        handler: createDirHandler,
        title: lang('tool_title_create_dir'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_create_archive',
        description:
          'Create a zip archive from files or directories in SiYuan workspace. Returns a download URL for the zip file. Can archive any workspace path including assets, widgets, notebooks, etc.',
        inputSchema: {
          paths: z
            .array(z.string())
            .describe('Array of file/directory paths to archive (e.g., ["/data/assets/", "/data/widgets/config.json"])'),
          name: z.string().optional().describe('Custom name for the archive (without .zip extension)'),
        },
        outputSchema: {
          fileName: z.string().describe('Name of the created zip file'),
          downloadUrl: z.string().describe('URL to download the zip file'),
          expiresAt: z.string().nullable().describe('When the download URL expires'),
          paths: z.array(z.string()).describe('Array of paths that were archived'),
        },
        handler: createArchiveHandler,
        title: lang('tool_title_create_archive'),
        annotations: { readOnlyHint: true },
      },
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

  const contentType = response.headers.get('Content-Type') || '';
  const downloadUrl = await buildDownloadUrl(path);
  const isText = isTextMimeType(contentType) || isTextExtension(path);
  const expiresAt = cacheTtl > 0 ? new Date(Date.now() + cacheTtl * 1000).toISOString() : null;

  const MAX_INLINE_SIZE = 512 * 1024; // 512KB
  const contentLength = response.headers.get('Content-Length');
  const knownSize = contentLength ? parseInt(contentLength, 10) : null;

  // Helper to return inline content
  const returnInline = (data: Uint8Array) => {
    if (isText) {
      return createJsonResponse({ path, content: new TextDecoder().decode(data), type: 'text', mimeType: contentType, downloadUrl, expiresAt });
    }
    return createJsonResponse({ path, content: data.toBase64(), type: 'binary', mimeType: contentType, downloadUrl, expiresAt, encoding: 'base64' });
  };

  // Fast path: Content-Length tells us the size
  if (knownSize !== null) {
    if (knownSize <= MAX_INLINE_SIZE) {
      const data = new Uint8Array(await response.arrayBuffer());
      return returnInline(data);
    }
    return createJsonResponse({ path, type: 'binary', mimeType: contentType, downloadUrl, expiresAt });
  }

  // Slow path: No Content-Length, try limitedRead
  const data = await limitedRead(response.body!, MAX_INLINE_SIZE);
  if (data) {
    return returnInline(data);
  }
  return createJsonResponse({ path, type: 'binary', mimeType: contentType, downloadUrl, expiresAt });
}

async function writeFileHandler(params: { path: string; content: string; isBase64?: boolean }) {
  const { path, content, isBase64 = false } = params;
  debugPush('Write file API called');

  if (!path || content === undefined) {
    throw new Error('Path and content are required.');
  }

  let fileContent: Blob | string;
  if (isBase64) {
    fileContent = base64ToBlob(content);
  } else {
    fileContent = content;
  }

  const result = await putFileAPI(path, fileContent);
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

  if (!paths || paths.length === 0) {
    throw new Error('At least one path is required.');
  }

  // Create the zip archive on SiYuan server
  const result = await exportResourcesAPI(paths, name);
  if (!result || !result.path) {
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
