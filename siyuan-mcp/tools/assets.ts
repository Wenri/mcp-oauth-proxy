/**
 * Asset management tools
 */

import { z } from 'zod';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { createJsonResponse, createImageContent, createAudioContent } from '../utils/mcpResponse';
import { uploadAPI, insertBlockAPI } from '../syapi';
import { validateBlockAccess } from '../utils/filterCheck';
import { resolveContentAuto, ResolvedContent, type ContentType } from '../utils/contentResolver';
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
  z.string().describe('Base64/hex encoded binary, or URL (see type parameter)'),
  z.record(z.string(), jsonValue).describe('JSON object (auto-serialized)'),
  z.array(jsonValue).describe('JSON array (auto-serialized)'),
]);

/** Schema for a single file to upload */
const fileSchema = z.object({
  fileName: z.string().optional().describe('File name (required for base64/hex/json, optional for URL - auto-detected if omitted)'),
  content: fileContentSchema.describe('File content: base64/hex binary, JSON object/array, or URL string'),
  type: z.enum(['base64', 'hex', 'json', 'url']).optional().describe('Content type: base64 (default for strings), hex, json (auto for objects/arrays), url (fetch from URL)'),
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

/** Processed file ready for upload (ResolvedContent extends Blob) */
type ProcessedFile = ResolvedContent & { name: string };

async function uploadAssetsHandler(params: {
  files: { fileName?: string; content: string | object; type?: ContentType }[];
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

  // Process all files using unified resolver
  const processedFiles: ProcessedFile[] = [];
  for (const file of files) {
    // For non-URL types, fileName is required
    if (file.type !== 'url' && !file.fileName) {
      throw new Error('fileName is required for non-URL content.');
    }

    const resolved = await resolveContentAuto(file.content, file.type, {
      fileName: file.fileName,
      defaultType: 'base64', // Default for assets is base64 (binary)
    });

    // Add name to resolved content (ProcessedFile = ResolvedContent & { name })
    const processed = resolved as ProcessedFile;
    processed.name = resolved.fileName || file.fileName!;
    processedFiles.push(processed);
  }

  // Upload all files (ProcessedFile extends Blob, so f IS the blob)
  const filesToUpload = processedFiles.map(f => ({ name: f.name, data: f }));
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

      const isImage = file.type.startsWith('image/');
      const alt = altText || file.name;
      const markdown = isImage ? `![${alt}](${assetPath})` : `[${alt}](${assetPath})`;

      const insertResult = await insertBlockAPI(markdown, previousBlockId, 'insertAfter');
      if (insertResult) {
        insertedBlockIds.push(insertResult.id);
        previousBlockId = insertResult.id; // Next insert goes after this one
      }
    }
  }

  // Build preview content for remote images/audio (for LLM to see)
  const previewContent: ContentBlock[] = [];
  for (const file of processedFiles) {
    if (!file.remote) continue;
    const assetPath = result.succMap[file.name];
    if (!assetPath) continue;

    if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
      const data = new Uint8Array(await file.arrayBuffer());
      const base64 = data.toBase64();
      if (file.type.startsWith('image/')) {
        previewContent.push(createImageContent(base64, file.type));
      } else {
        previewContent.push(createAudioContent(base64, file.type));
      }
    }
  }

  return createJsonResponse({
    uploadedCount: Object.keys(result.succMap).length,
    failedCount: result.errFiles?.length || 0,
    succMap: result.succMap,
    errFiles: result.errFiles || [],
    insertedBlockIds,
  }, previewContent.length > 0 ? previewContent : undefined);
}

