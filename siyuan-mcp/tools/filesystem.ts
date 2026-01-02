/**
 * File system tools for SiYuan workspace
 */

import { z } from 'zod';
import { createErrorResponse, createSuccessResponse, createJsonResponse } from '../utils/mcpResponse';
import { getFileAPIv2, putFileAPI, removeFileAPI, renameFileAPI, readDirAPI, exportResourcesAPI, downloadExportFile } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';

export class FileSystemToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_read_file',
        description:
          'Read a file from SiYuan workspace. For text files, returns the content. For binary files (images, etc.), returns base64 encoded content.',
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
        name: 'siyuan_export_resources',
        description:
          'Export files or folders from SiYuan workspace as a zip archive. Returns the zip file as base64 encoded content. Useful for bundling multiple files/assets for download or backup.',
        schema: {
          paths: z
            .array(z.string())
            .describe('Array of file/folder paths to export (e.g., ["/data/assets/", "/data/widgets/config.json"])'),
          name: z.string().optional().describe('Custom name for the zip file (without .zip extension)'),
        },
        handler: exportResourcesHandler,
        title: lang('tool_title_export_resources'),
        annotations: { readOnlyHint: true },
      },
    ];
  }
}

/**
 * Convert Blob to base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

/**
 * Check if a file is likely text based on extension
 */
function isTextFile(path: string): boolean {
  const textExtensions = [
    'txt', 'md', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
    'sql', 'graphql', 'vue', 'svelte', 'astro', 'php', 'pl', 'lua',
    'r', 'R', 'scala', 'kt', 'swift', 'dart', 'elm', 'clj', 'ex', 'exs',
    'sy', 'csv', 'log', 'env', 'gitignore', 'dockerignore', 'editorconfig',
  ];
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return textExtensions.includes(ext);
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

  // If it's a Blob (binary file)
  if (result instanceof Blob) {
    if (isTextFile(path)) {
      // Try to read as text
      try {
        const text = await result.text();
        return createJsonResponse({ path, content: text, type: 'text' });
      } catch {
        // Fall through to base64
      }
    }
    // Return as base64
    const base64 = await blobToBase64(result);
    return createJsonResponse({
      path,
      content: base64,
      type: 'base64',
      size: result.size,
      mimeType: result.type,
    });
  }

  // If it's already JSON (e.g., error response or JSON file content)
  return createJsonResponse({ path, content: result, type: 'json' });
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

async function exportResourcesHandler(params: { paths: string[]; name?: string }) {
  const { paths, name } = params;
  debugPush('Export resources API called');

  if (!paths || paths.length === 0) {
    return createErrorResponse('At least one path is required.');
  }

  // Step 1: Create the zip archive
  const exportResult = await exportResourcesAPI(paths, name);
  if (!exportResult || !exportResult.path) {
    return createErrorResponse('Failed to create export archive.');
  }

  // Step 2: Download the zip file from SiYuan server
  const zipBlob = await downloadExportFile(exportResult.path);
  if (!zipBlob) {
    return createErrorResponse('Failed to download export archive.');
  }

  // Step 3: Convert to base64 and return
  const base64 = await blobToBase64(zipBlob);
  const fileName = exportResult.path.split('/').pop() || 'export.zip';

  return createJsonResponse({
    fileName,
    content: base64,
    type: 'base64',
    size: zipBlob.size,
    mimeType: 'application/zip',
    paths: paths,
  });
}
