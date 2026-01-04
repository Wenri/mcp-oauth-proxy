import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

/**
 * Success response helper
 */
export function createSuccessResponse(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * JSON response helper - returns both text and structured content
 */
export function createJsonResponse(data: unknown, extraContent: TextContent[] = []): CallToolResult {
  const normalized = Array.isArray(data) ? { result: data } : data;
  return {
    content: [
      { type: "text", text: JSON.stringify(normalized, null, 2) },
      ...extraContent,
    ],
    structuredContent: normalized as Record<string, unknown>,
  };
}

/**
 * Error response helper
 */
export function createErrorResponse(errorMessage: string): CallToolResult {
  return {
    content: [{ type: "text", text: errorMessage }],
    isError: true,
  };
}
