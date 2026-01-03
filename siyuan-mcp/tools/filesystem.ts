/**
 * File system tools for SiYuan workspace
 */

import { z } from 'zod';
import { waitUntil } from 'cloudflare:workers';
import { createErrorResponse, createSuccessResponse, createJsonResponse } from '../utils/mcpResponse';
import { getFileAPIv2, isTextMimeType, isTextExtension, putFileAPI, removeFileAPI, renameFileAPI, readDirAPI, exportResourcesAPI } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { buildDownloadUrl } from '..';

// Cache TTL for files (1 hour)
const FILE_CACHE_TTL = 3600;

export class FileSystemToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_read_file',
        description:
          'Read a file from SiYuan workspace. For text files (detected via Content-Type or extension), returns the content directly. For binary files (images, etc.), returns metadata with a download URL.',
        schema: {
          path: z
            .string()
            .describe('Path to the file in workspace (e.g., "/data/assets/image.png", "/data/widgets/config.json")'),
        },
        handler: readFileHandler,
        title: lang('tool_title_read_file'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_write_file',
        description:
          'Write content to a file in SiYuan workspace. For text content, pass the string directly. For binary content, pass base64 encoded data.',
        schema: {
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
        schema: {
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
        schema: {
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
        schema: {
          path: z.string().describe('Path to the directory (e.g., "/data/assets/", "/data/widgets/")'),
        },
        handler: listDirHandler,
        title: lang('tool_title_list_dir'),
        annotations: { readOnlyHint: true },
      },
      {
        name: 'siyuan_create_dir',
        description: 'Create a new directory in SiYuan workspace.',
        schema: {
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
        schema: {
          paths: z
            .array(z.string())
            .describe('Array of file/directory paths to archive (e.g., ["/data/assets/", "/data/widgets/config.json"])'),
          name: z.string().optional().describe('Custom name for the archive (without .zip extension)'),
        },
        handler: createArchiveHandler,
        title: lang('tool_title_create_archive'),
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string = 'application/octet-stream'): Blob {
  const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function readFileHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Read file API called');

  if (!path) {
    return createErrorResponse('Path is required.');
  }

  const result = await getFileAPIv2(path);
  if (result === null) {
    return createErrorResponse('File not found or failed to read.');
  }

  const { response, contentType } = result;
  const downloadUrl = buildDownloadUrl(path);
  const isText = isTextMimeType(contentType) || isTextExtension(path);

  // Cache all files for faster subsequent downloads
  const cache = caches.default;
  const cacheKey = `https://siyuan-cache${path}`;
  const cached = await cache.match(cacheKey);

  if (isText) {
    // Text file: read content and cache
    const text = await response.text();
    if (!cached) {
      waitUntil(
        cache.put(
          cacheKey,
          new Response(text, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': `public, max-age=${FILE_CACHE_TTL}`,
            },
          }),
        ),
      );
    }
    return createJsonResponse({ path, content: text, type: 'text', mimeType: contentType, downloadUrl });
  }

  // Binary file: tee stream to cache while returning download URL
  if (!cached) {
    const [cacheStream, _] = response.body!.tee();
    waitUntil(
      cache.put(
        cacheKey,
        new Response(cacheStream, {
          status: response.status,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': `public, max-age=${FILE_CACHE_TTL}`,
          },
        }),
      ),
    );
  }

  return createJsonResponse({
    path,
    type: 'binary',
    mimeType: contentType,
    downloadUrl,
  });
}

async function writeFileHandler(params: { path: string; content: string; isBase64?: boolean }) {
  const { path, content, isBase64 = false } = params;
  debugPush('Write file API called');

  if (!path || content === undefined) {
    return createErrorResponse('Path and content are required.');
  }

  let fileContent: Blob | string;
  if (isBase64) {
    fileContent = base64ToBlob(content);
  } else {
    fileContent = content;
  }

  const result = await putFileAPI(path, fileContent);
  if (!result) {
    return createErrorResponse('Failed to write the file.');
  }

  return createSuccessResponse(`File written successfully to ${path}`);
}

async function removeFileHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Remove file API called');

  if (!path) {
    return createErrorResponse('Path is required.');
  }

  const result = await removeFileAPI(path);
  if (!result) {
    return createErrorResponse('Failed to remove the file or directory.');
  }

  return createSuccessResponse(`Successfully removed ${path}`);
}

async function renameFileHandler(params: { path: string; newPath: string }) {
  const { path, newPath } = params;
  debugPush('Rename file API called');

  if (!path || !newPath) {
    return createErrorResponse('Both path and newPath are required.');
  }

  const result = await renameFileAPI(path, newPath);
  if (!result) {
    return createErrorResponse('Failed to rename the file.');
  }

  return createSuccessResponse(`Successfully renamed ${path} to ${newPath}`);
}

async function listDirHandler(params: { path: string }) {
  const { path } = params;
  debugPush('List directory API called');

  if (!path) {
    return createErrorResponse('Path is required.');
  }

  const result = await readDirAPI(path);
  if (result === null) {
    return createErrorResponse('Directory not found or failed to read.');
  }

  return createJsonResponse({
    path,
    entries: result,
    count: result.length,
  });
}

async function createDirHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Create directory API called');

  if (!path) {
    return createErrorResponse('Path is required.');
  }

  // Use putFile with isDir=true to create a directory
  const result = await putFileAPI(path, '', true);
  if (!result) {
    return createErrorResponse('Failed to create the directory.');
  }

  return createSuccessResponse(`Directory created at ${path}`);
}

async function createArchiveHandler(params: { paths: string[]; name?: string }) {
  const { paths, name } = params;
  debugPush('Create archive API called');

  if (!paths || paths.length === 0) {
    return createErrorResponse('At least one path is required.');
  }

  // Create the zip archive on SiYuan server
  const result = await exportResourcesAPI(paths, name);
  if (!result || !result.path) {
    return createErrorResponse('Failed to create archive.');
  }

  const fileName = result.path.split('/').pop() || 'archive.zip';
  const downloadUrl = buildDownloadUrl(result.path);

  return createJsonResponse({
    fileName,
    downloadUrl,
    paths: paths,
  });
}
