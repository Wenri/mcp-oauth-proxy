/**
 * Asset management tools
 */

import { z } from 'zod';
import { createJsonResponse } from '../utils/mcpResponse';
import { uploadAPI, insertBlockAPI } from '../syapi';
import { validateBlockAccess } from '../utils/filterCheck';
import { base64ToBlob } from '../utils/common';
import { fetchFromUrl } from '../utils/urlFetch';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';

/** JSON-serializable value type */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Zod schema for JSON-serializable values (recursive) */
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
);

/** Schema for file content */
const fileContentSchema = z.union([
  z.string().describe('Base64 encoded binary, or URL (see type parameter)'),
  z.record(z.string(), jsonValue).describe('JSON object (auto-serialized)'),
  z.array(jsonValue).describe('JSON array (auto-serialized)'),
]);

/** Schema for a single file to upload */
const fileSchema = z.object({
  fileName: z.string().optional().describe('File name (required for base64/json, optional for URL - auto-detected if omitted)'),
  content: fileContentSchema.describe('File content: base64 binary, JSON object/array, or URL string'),
  type: z.enum(['base64', 'json', 'url']).optional().describe('Content type: base64 (default for strings), json (auto for objects/arrays), url (fetch from URL)'),
});

export class AssetToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      {
        name: 'siyuan_upload_assets',
        description:
          'Upload one or more files to SiYuan assets. Provide either content (base64/JSON) or a URL to fetch from. Can optionally auto-insert all uploaded assets into a document in order.',
        inputSchema: {
          files: z.array(fileSchema).describe('Array of files to upload'),
          assetsDirPath: z
            .string()
            .optional()
            .describe('Target assets directory path (e.g., "/data/assets/"). Defaults to "/data/assets/"'),
          insertAfterBlock: z
            .string()
            .optional()
            .describe('Auto-insert uploaded assets as image/link blocks after this block ID, in order'),
          altText: z
            .string()
            .optional()
            .describe('Alt text for images when using insertAfterBlock (defaults to fileName)'),
        },
        outputSchema: {
          uploadedCount: z.number().describe('Number of files uploaded successfully'),
          failedCount: z.number().describe('Number of files that failed to upload'),
          succMap: z.record(z.string()).describe('Map of file names to their asset paths'),
          errFiles: z.array(z.string()).describe('List of file names that failed to upload'),
          insertedBlockIds: z.array(z.string()).describe('IDs of inserted blocks (when insertAfterBlock is used)'),
        },
        handler: uploadAssetsHandler,
        title: lang('tool_title_upload_assets'),
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

/** Convert content to Blob based on type */
function contentToBlob(content: string | object, fileName: string): Blob {
  if (typeof content === 'object') {
    // JSON object/array → serialize to pretty JSON
    const jsonString = JSON.stringify(content, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
  }
  // String → assume base64 encoded binary
  const mimeType = getMimeType(fileName);
  return base64ToBlob(content, mimeType);
}

/** Processed file ready for upload */
interface ProcessedFile {
  name: string;
  data: Blob;
  mimeType: string;
}

async function uploadAssetsHandler(params: {
  files: { fileName?: string; content: string | object; type?: 'base64' | 'json' | 'url' }[];
  assetsDirPath?: string;
  insertAfterBlock?: string;
  altText?: string;
}) {
  const { files, assetsDirPath = '/data/assets/', insertAfterBlock, altText } = params;
  debugPush('Upload assets API called');

  if (!files || files.length === 0) {
    throw new Error('At least one file is required.');
  }

  // Validate insertAfterBlock if provided
  if (insertAfterBlock) {
    await validateBlockAccess(insertAfterBlock);
  }

  // Process all files based on type
  const processedFiles: ProcessedFile[] = [];
  for (const file of files) {
    // Infer type if not provided
    const resolvedType = file.type ?? (typeof file.content === 'object' ? 'json' : 'base64');

    switch (resolvedType) {
      case 'url':
        if (typeof file.content !== 'string') {
          throw new Error('URL must be a string.');
        }
        const result = await fetchFromUrl(file.content, file.fileName);
        processedFiles.push({
          name: result.fileName,
          data: result.blob,
          mimeType: result.mimeType,
        });
        break;
      case 'json':
        if (!file.fileName) {
          throw new Error('fileName is required for JSON content.');
        }
        const jsonBlob = contentToBlob(file.content, file.fileName);
        processedFiles.push({
          name: file.fileName,
          data: jsonBlob,
          mimeType: 'application/json',
        });
        break;
      case 'base64':
      default:
        if (typeof file.content !== 'string') {
          throw new Error('Base64 content must be a string.');
        }
        if (!file.fileName) {
          throw new Error('fileName is required for base64 content.');
        }
        const mimeType = getMimeType(file.fileName);
        const blob = base64ToBlob(file.content, mimeType);
        processedFiles.push({
          name: file.fileName,
          data: blob,
          mimeType,
        });
        break;
    }
  }

  // Upload all files
  const filesToUpload = processedFiles.map(f => ({ name: f.name, data: f.data }));
  const result = await uploadAPI(assetsDirPath, filesToUpload);
  if (!result) {
    throw new Error('Failed to upload assets.');
  }

  // Auto-insert blocks if requested (in order)
  const insertedBlockIds: string[] = [];
  if (insertAfterBlock) {
    let previousBlockId = insertAfterBlock;
    for (const file of processedFiles) {
      const assetPath = result.succMap[file.name];
      if (!assetPath) continue;

      const isImage = file.mimeType.startsWith('image/');
      const alt = altText || file.name;
      const markdown = isImage ? `![${alt}](${assetPath})` : `[${alt}](${assetPath})`;

      const insertResult = await insertBlockAPI(markdown, previousBlockId, 'insertAfter');
      if (insertResult) {
        insertedBlockIds.push(insertResult.id);
        previousBlockId = insertResult.id; // Next insert goes after this one
      }
    }
  }

  return createJsonResponse({
    uploadedCount: Object.keys(result.succMap).length,
    failedCount: result.errFiles?.length || 0,
    succMap: result.succMap,
    errFiles: result.errFiles || [],
    insertedBlockIds,
  });
}

