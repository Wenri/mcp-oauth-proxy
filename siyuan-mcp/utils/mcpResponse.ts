/**
 * MCP response helpers
 * Adapted from upstream
 */

interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

interface McpResponse {
  content: McpContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: any;
}

/**
 * Success response helper
 */
export function createSuccessResponse(text: string, metadata?: Record<string, any>): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    _meta: metadata,
  };
}

/**
 * JSON response helper
 */
export function createJsonResponse(data: any, otherData: any[] | null = null): McpResponse {
  if (Array.isArray(data)) {
    data = { result: data };
  }
  const result: McpContent[] = [
    {
      type: 'text',
      text: JSON.stringify(data, null, 2),
    },
  ];
  if (otherData != null) {
    result.push(...(otherData as McpContent[]));
  }
  return {
    content: result,
    structuredContent: data,
  };
}

/**
 * Error response helper
 */
export function createErrorResponse(errorMessage: string): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text: errorMessage,
      },
    ],
    isError: true,
  };
}
