/**
 * Asset management tools
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse } from '../utils/mcpResponse';
import { uploadAPI } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';

export class AssetToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'siyuan_upload_asset',
        description:
          'Upload a file (image, document, etc.) to SiYuan assets. The file content should be base64 encoded. Returns the asset path that can be used in documents.',
        schema: {
          fileName: z.string().describe('Name of the file including extension (e.g., "image.png", "document.pdf")'),
          base64Content: z.string().describe('Base64 encoded content of the file'),
          assetsDirPath: z
            .string()
            .optional()
            .describe('Target assets directory path (e.g., "/data/assets/"). Defaults to "/data/assets/"'),
        },
        handler: uploadAssetHandler,
        title: lang('tool_title_upload_asset'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_upload_assets_batch',
        description:
          'Upload multiple files to SiYuan assets in a single request. Each file should have a name and base64 encoded content.',
        schema: {
          files: z
            .array(
              z.object({
                fileName: z.string().describe('Name of the file including extension'),
                base64Content: z.string().describe('Base64 encoded content of the file'),
              })
            )
            .describe('Array of files to upload'),
          assetsDirPath: z
            .string()
            .optional()
            .describe('Target assets directory path. Defaults to "/data/assets/"'),
        },
        handler: uploadAssetsBatchHandler,
        title: lang('tool_title_upload_assets_batch'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
    ];
  }
}

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string = 'application/octet-stream'): Blob {
  // Remove data URL prefix if present
  const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Get MIME type from file extension
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function uploadAssetHandler(params: {
  fileName: string;
  base64Content: string;
  assetsDirPath?: string;
}) {
  const { fileName, base64Content, assetsDirPath = '/data/assets/' } = params;
  debugPush('Upload asset API called');

  if (!fileName || !base64Content) {
    return createErrorResponse('fileName and base64Content are required.');
  }

  try {
    const mimeType = getMimeType(fileName);
    const blob = base64ToBlob(base64Content, mimeType);

    const result = await uploadAPI(assetsDirPath, [{ name: fileName, data: blob }]);
    if (!result) {
      return createErrorResponse('Failed to upload the asset.');
    }

    if (result.errFiles && result.errFiles.length > 0) {
      return createErrorResponse(`Failed to upload: ${result.errFiles.join(', ')}`);
    }

    const assetPath = result.succMap[fileName];
    if (!assetPath) {
      return createErrorResponse('Upload succeeded but asset path not returned.');
    }

    return createJsonResponse({
      success: true,
      fileName,
      assetPath,
      message: `Asset uploaded successfully. Use "${assetPath}" to reference it in documents.`,
    });
  } catch (error) {
    return createErrorResponse(`Failed to process the file: ${error}`);
  }
}

async function uploadAssetsBatchHandler(params: {
  files: { fileName: string; base64Content: string }[];
  assetsDirPath?: string;
}) {
  const { files, assetsDirPath = '/data/assets/' } = params;
  debugPush('Upload assets batch API called');

  if (!files || files.length === 0) {
    return createErrorResponse('At least one file is required.');
  }

  try {
    const filesToUpload: { name: string; data: Blob }[] = [];

    for (const file of files) {
      if (!file.fileName || !file.base64Content) {
        return createErrorResponse(`Invalid file entry: fileName and base64Content are required.`);
      }
      const mimeType = getMimeType(file.fileName);
      const blob = base64ToBlob(file.base64Content, mimeType);
      filesToUpload.push({ name: file.fileName, data: blob });
    }

    const result = await uploadAPI(assetsDirPath, filesToUpload);
    if (!result) {
      return createErrorResponse('Failed to upload the assets.');
    }

    return createJsonResponse({
      success: true,
      uploadedCount: Object.keys(result.succMap).length,
      failedCount: result.errFiles?.length || 0,
      succMap: result.succMap,
      errFiles: result.errFiles || [],
    });
  } catch (error) {
    return createErrorResponse(`Failed to process the files: ${error}`);
  }
}
