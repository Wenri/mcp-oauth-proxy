import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

declare global {
    /**
     * Tool definition for SiYuan MCP tools
     * Matches the SDK's registerTool API structure
     */
    interface McpTool<T> {
        /** The unique name of the tool */
        name: string;

        /** Human-readable title for the tool */
        title?: string;

        /** The description of the tool */
        description: string;

        /**
         * The Zod schema for validating tool input arguments
         * This should be a record of Zod validators
         * For tools with no parameters, use {} (empty object)
         */
        inputSchema?: Record<string, z.ZodType<any>>;

        /**
         * The Zod schema for validating tool output (optional)
         * When provided, enables structuredContent in responses
         */
        outputSchema?: Record<string, z.ZodType<any>>;

        /** The handler function for the tool */
        handler: (args: T, extra: any) => Promise<CallToolResult>;

        /** Optional hints about tool behavior */
        annotations?: {
            readOnlyHint?: boolean;    // If true, the tool does not modify its environment
            destructiveHint?: boolean; // If true, the tool may perform destructive updates
            idempotentHint?: boolean;  // If true, repeated calls with same args have no additional effect
            openWorldHint?: boolean;   // If true, tool interacts with external entities
        }
    }
}

