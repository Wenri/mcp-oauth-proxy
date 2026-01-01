/**
 * MCP response helpers
 * From upstream - unchanged
 */

export function createSuccessResponse(message: string) {
  return {
    content: [{ type: 'text', text: message }],
  };
}

export function createErrorResponse(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createJsonResponse(data: any) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
