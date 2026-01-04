import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

declare global {
    /**
     * Tool definition for SiYuan MCP tools
     */
    interface McpTool<T> {
        /**
         * The name of the tool
         */
        name: string;

        /**
         * The description of the tool
         */
        description: string;

        /**
         * The Zod schema for validating tool arguments
         * This should be a record of Zod validators
         * For tools with no parameters, use {} (empty object)
         */
        schema: Record<string, z.ZodType<any>> | undefined;

        /**
         * The handler function for the tool
         */
        handler: (args: T, extra: any) => Promise<CallToolResult>;
        
        title?: string;      // Human-readable title for the tool

        /**
         * The tool annotations
         */
        annotations?: {        // Optional hints about tool behavior
            readOnlyHint?: boolean;    // If true, the tool does not modify its environment
            destructiveHint?: boolean; // If true, the tool may perform destructive updates
            idempotentHint?: boolean;  // If true, repeated calls with same args have no additional effect
            openWorldHint?: boolean;   // If true, tool interacts with external entities
        }
    }
}
