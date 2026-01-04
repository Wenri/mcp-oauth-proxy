import type { CallToolResult, ImageContent, AudioContent, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import YAML from "yaml";

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
