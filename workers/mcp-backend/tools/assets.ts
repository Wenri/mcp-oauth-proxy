/**
 * Asset management tools
 */

import { z } from 'zod';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { createJsonResponse, createResourceLink, blobToContentBlockWithLimit, MAX_INLINE_ASSET_SIZE } from '../utils/mcpResponse';
import { uploadAPI, insertBlockAPI } from '../syapi';
import { validateBlockAccess } from '../utils/resultFilter';
import { ResolvedContent, inferContentType, type ContentType } from '../utils/contentResolver';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { jsonValueSchema } from '../types';
import { assertNonEmptyArray } from '../utils/commonCheck';

/** Schema for file content */
const fileContentSchema = z.union([
  z.string().describe('Base64/hex encoded binary, or URL (see type parameter)'),
  z.record(z.string(), jsonValueSchema).describe('JSON object (auto-serialized)'),
  z.array(jsonValueSchema).describe('JSON array (auto-serialized)'),
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
      defineTool({
        name: 'siyuan_upload_assets',
        description:
          'Upload one or more files to SiYuan assets. Provide either content (base64/JSON) or a URL to fetch from. Can optionally auto-insert all uploaded assets into a document in order.',
        inputSchema: z.object({
          files: z.array(fileSchema).describe('Array of files to upload'),
          assetsDirPath: z
            .string()
            .optional()
            .describe('Target assets directory path relative to /data/ (e.g., "assets/"). Defaults to "assets/"'),
          insertAfterBlock: z
            .string()
            .optional()
            .describe('Auto-insert uploaded assets as image/link blocks after this block ID, in order'),
          altText: z
            .string()
            .optional()
            .describe('Alt text for images when using insertAfterBlock (defaults to fileName)'),
        }),
        outputSchema: z.object({
          uploadedCount: z.number().describe('Number of files uploaded successfully'),
          failedCount: z.number().describe('Number of files that failed to upload'),
          succMap: z.record(z.string(), z.string()).describe('Map of file names to their asset paths'),
          errFiles: z.array(z.string()).describe('List of file names that failed to upload'),
          insertedBlockIds: z.array(z.string()).describe('IDs of inserted blocks (when insertAfterBlock is used)'),
        }),
        handler: uploadAssetsHandler,
        title: lang('tool_title_upload_assets'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
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
  const { files, assetsDirPath = 'assets/', insertAfterBlock, altText } = params;
  debugPush('Upload assets API called');

  assertNonEmptyArray(files, 'file');

  // Validate insertAfterBlock if provided
  if (insertAfterBlock) {
    await validateBlockAccess(insertAfterBlock);
  }

  // Process all files using ResolvedContent.from()
  const processedFiles: ProcessedFile[] = [];
  for (const file of files) {
    // For non-URL types, fileName is required
    if (file.type !== 'url' && !file.fileName) {
      throw new Error('fileName is required for non-URL content.');
    }

    // Infer type with 'base64' as default for assets (binary)
    const type = file.type ?? inferContentType(file.content, 'base64');
    const resolved = await ResolvedContent.from(file.content, type, file.fileName);

    // Add name to resolved content (ProcessedFile = ResolvedContent & { name })
    const processed = resolved as ProcessedFile;
    processed.name = resolved.fileName || file.fileName!;
    processedFiles.push(processed);
  }

  // Upload all files (ProcessedFile extends Blob, so f IS the blob)
  const filesToUpload = processedFiles.map(f => ({ name: f.name, data: f }));
  const result = await uploadAPI(assetsDirPath, filesToUpload);

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

  // Build preview content for images/audio (for LLM to see)
  const previewContent: ContentBlock[] = [];
  let inlineSizeSum = 0;
  for (const file of processedFiles) {
    const assetPath = result.succMap[file.name];
    if (!assetPath) continue;

    // Only preview image/audio content
    if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) continue;

    const uri = `syfile://${assetPath}`;

    if (file.remote) {
      // Remote content: apply size limits (inline if small, ResourceLink if large)
      const { block, inlineSize } = await blobToContentBlockWithLimit(
        file, file.type, uri, MAX_INLINE_ASSET_SIZE, inlineSizeSum
      );
      previewContent.push(block);
      inlineSizeSum += inlineSize;
    } else {
      // Uploaded content: always ResourceLink (no inline preview)
      previewContent.push(createResourceLink(uri, file.name, file.type));
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

