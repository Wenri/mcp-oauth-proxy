import type { CallToolResult, ImageContent, AudioContent, EmbeddedResource, ResourceLink, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import YAML from "yaml";
import { getContentCategory } from "./contentType";

/**
 * Structured content type - matches outputSchema definitions.
 * MCP clients can parse this programmatically while `content` provides human-readable text.
 *
 * Note: structuredContent is JSON-only. Binary data (images, audio) goes in `content` array.
 */
export type StructuredContent = Record<string, unknown>;

/**
 * Text response for tool calls - human-readable text with optional media content.
 *
 * @param text - Human-readable message
 * @param extraContent - Additional content blocks (images, audio, etc.)
 *
 * @example
 * ```ts
 * // Simple text response
 * return createSuccessResponse("Operation completed successfully");
 *
 * // Text with image
 * return createSuccessResponse(
 *   "Here is the requested image",
 *   [createImageContent(base64Data, "image/png")]
 * );
 * ```
 */
export function createSuccessResponse(
  text: string,
  extraContent: ContentBlock[] = []
): CallToolResult {
  return {
    content: [{ type: "text", text }, ...extraContent],
  };
}

/**
 * JSON response helper - returns both human-readable text and machine-readable structured content.
 *
 * @param data - Object matching the tool's outputSchema definition
 * @param extraContent - Additional content blocks (images, audio, etc.)
 * @returns CallToolResult with:
 *   - `content`: YAML text representation (human/LLM-friendly) + extra content
 *   - `structuredContent`: Typed object for programmatic parsing by MCP clients
 *
 * Note: For array responses, use createArrayResponse() instead.
 *
 * @example
 * ```ts
 * // Object response
 * return createJsonResponse({ success: true, blockId: "abc123" });
 *
 * // With image content
 * return createJsonResponse(
 *   { path: "/data/assets/image.png", type: "binary" },
 *   [createImageContent(base64Data, "image/png")]
 * );
 * ```
 */
export function createJsonResponse<T extends StructuredContent>(
  data: T,
  extraContent: ContentBlock[] = []
): CallToolResult {
  return {
    content: [
      { type: "text", text: YAML.stringify(data).trimEnd() },
      ...extraContent,
    ],
    structuredContent: data,
  };
}

/**
 * Array response helper - wraps array with count and descriptive key name.
 *
 * @param data - Array to return
 * @param key - Key name for the array (e.g., 'rows', 'blocks', 'results')
 * @param context - Additional context fields (e.g., { query: "..." })
 * @param extraContent - Additional content blocks (images, audio, etc.)
 *
 * @example
 * ```ts
 * // Simple array
 * createArrayResponse(blocks, 'blocks')
 * // → { count: 5, blocks: [...] }
 *
 * // With context
 * createArrayResponse(results, 'results', { query: "search term" })
 * // → { count: 3, query: "search term", results: [...] }
 * ```
 */
export function createArrayResponse<T>(
  data: T[],
  key: string,
  context: Record<string, unknown> = {},
  extraContent: ContentBlock[] = []
): CallToolResult {
  return createJsonResponse(
    { count: data.length, ...context, [key]: data },
    extraContent
  );
}

/**
 * Create an ImageContent block for inclusion in content array.
 *
 * @param base64Data - Base64 encoded image data (without data URL prefix)
 * @param mimeType - MIME type (e.g., "image/png", "image/jpeg")
 * @returns ImageContent block to include in content array
 *
 * @example
 * ```ts
 * return createJsonResponse(
 *   { path: "/data/assets/image.png", type: "binary" },
 *   [createImageContent(base64Data, "image/png")]
 * );
 * ```
 */
export function createImageContent(base64Data: string, mimeType: string): ImageContent {
  return {
    type: "image",
    data: base64Data,
    mimeType,
  };
}

/**
 * Create an AudioContent block for inclusion in content array.
 *
 * @param base64Data - Base64 encoded audio data (without data URL prefix)
 * @param mimeType - MIME type (e.g., "audio/mpeg", "audio/wav", "audio/ogg")
 * @returns AudioContent block to include in content array
 *
 * @example
 * ```ts
 * return createJsonResponse(
 *   { path: "/data/assets/audio.mp3", type: "binary" },
 *   [createAudioContent(base64Data, "audio/mpeg")]
 * );
 * ```
 */
export function createAudioContent(base64Data: string, mimeType: string): AudioContent {
  return {
    type: "audio",
    data: base64Data,
    mimeType,
  };
}

/**
 * Error response for failed tool calls.
 * Sets `isError: true` to signal failure to MCP clients.
 */
export function createErrorResponse(errorMessage: string): CallToolResult {
  return {
    content: [{ type: "text", text: errorMessage }],
    isError: true,
  };
}

/**
 * Create an EmbeddedResource with text content for inclusion in content array.
 *
 * @param uri - Resource URI (e.g., "file:///data/config.json")
 * @param text - The text content
 * @param mimeType - MIME type (e.g., "text/plain", "application/json")
 * @returns EmbeddedResource block to include in content array
 *
 * @example
 * ```ts
 * return createJsonResponse(
 *   { path: "/data/config.json", type: "text" },
 *   [createTextResource("file:///data/config.json", jsonContent, "application/json")]
 * );
 * ```
 */
export function createTextResource(uri: string, text: string, mimeType: string): EmbeddedResource {
  return {
    type: "resource",
    resource: {
      uri,
      mimeType,
      text,
    },
  };
}

/**
 * Create an EmbeddedResource with blob (binary) content for inclusion in content array.
 *
 * @param uri - Resource URI (e.g., "file:///data/document.pdf")
 * @param base64Data - Base64 encoded binary data
 * @param mimeType - MIME type (e.g., "application/pdf", "application/zip")
 * @returns EmbeddedResource block to include in content array
 *
 * @example
 * ```ts
 * return createJsonResponse(
 *   { path: "/data/document.pdf", type: "binary" },
 *   [createBlobResource("file:///data/document.pdf", base64Data, "application/pdf")]
 * );
 * ```
 */
export function createBlobResource(uri: string, base64Data: string, mimeType: string): EmbeddedResource {
  return {
    type: "resource",
    resource: {
      uri,
      mimeType,
      blob: base64Data,
    },
  };
}

/**
 * Create a ResourceLink (URI reference without inline content).
 * Client can fetch the actual content via the resource handler.
 *
 * @param uri - Resource URI (e.g., "syfile:///data/large-file.pdf")
 * @param name - Display name for the resource
 * @param mimeType - MIME type of the resource
 * @returns ResourceLink block for inclusion in content array
 *
 * @example
 * ```ts
 * // For large files, return reference instead of inline content
 * return createJsonResponse(
 *   { path: "/data/large-file.pdf", type: "binary" },
 *   [createResourceLink("syfile:///data/large-file.pdf", "large-file.pdf", "application/pdf")]
 * );
 * ```
 */
export function createResourceLink(uri: string, name: string, mimeType: string): ResourceLink {
  return {
    type: "resource_link",
    uri,
    name,
    mimeType,
  };
}

/** Maximum size for inline content per asset (2MB) */
export const MAX_INLINE_ASSET_SIZE = 2 * 1024 * 1024;

/** Maximum total size for all inline content (5MB) */
export const MAX_TOTAL_INLINE_SIZE = 5 * 1024 * 1024;

/**
 * Convert a Blob to an appropriate MCP ContentBlock based on content type.
 *
 * @param blob - The blob to convert
 * @param mimeType - MIME type of the content
 * @param resourceUri - URI for embedding as resource (used for binary files)
 * @returns ContentBlock (TextContent, ImageContent, AudioContent, or EmbeddedResource)
 *
 * @example
 * ```ts
 * const block = await blobToContentBlock(blob, "image/png", "syfile:///data/image.png");
 * return createJsonResponse({ path }, [block]);
 * ```
 */
export async function blobToContentBlock(blob: Blob, mimeType: string, resourceUri: string): Promise<ContentBlock> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const category = getContentCategory(mimeType, resourceUri);

  if (category === 'text') {
    const text = new TextDecoder().decode(bytes);
    return { type: 'text', text };
  }

  // Binary data needs base64 encoding
  const base64Data = bytes.toBase64();

  if (category === 'image') {
    return { type: 'image', data: base64Data, mimeType };
  }

  if (category === 'audio') {
    return { type: 'audio', data: base64Data, mimeType };
  }

  // Other binary: return as EmbeddedResource with blob
  return createBlobResource(resourceUri, base64Data, mimeType);
}

/**
 * Convert a Blob to ContentBlock with size limits.
 * Returns ResourceLink for oversized content, inline content otherwise.
 *
 * @param blob - The blob to convert
 * @param mimeType - MIME type of the content
 * @param resourceUri - URI for the resource
 * @param maxSize - Maximum size for inline content (default: MAX_INLINE_ASSET_SIZE)
 * @param currentTotalSize - Current total inline size for limit checking
 * @returns Object with block and inlineSize (0 for ResourceLink, blob.size for inline)
 */
export async function blobToContentBlockWithLimit(
  blob: Blob,
  mimeType: string,
  resourceUri: string,
  maxSize: number = MAX_INLINE_ASSET_SIZE,
  currentTotalSize: number = 0
): Promise<{ block: ContentBlock; inlineSize: number }> {
  const name = resourceUri.split('/').pop() || resourceUri;

  // Check individual size limit
  if (blob.size > maxSize) {
    return { block: createResourceLink(resourceUri, name, mimeType), inlineSize: 0 };
  }

  // Check total size limit
  if (currentTotalSize > MAX_TOTAL_INLINE_SIZE) {
    return { block: createResourceLink(resourceUri, name, mimeType), inlineSize: 0 };
  }

  // Convert to inline content
  const block = await blobToContentBlock(blob, mimeType, resourceUri);
  return { block, inlineSize: blob.size };
}
