import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

declare global {
    /**
     * Tool definition for SiYuan MCP tools
     * Matches the SDK's registerTool API structure
     *
     * @template TInput - The Zod schema type for input validation
     * @template TOutput - The Zod schema type for output validation
     */
    interface McpTool<
        TInput extends z.ZodType = z.ZodType,
        TOutput extends z.ZodType = z.ZodType
    > {
        /** The unique name of the tool */
        name: string;

        /** Human-readable title for the tool */
        title?: string;

        /** The description of the tool */
        description: string;

        /**
         * The Zod schema for validating tool input arguments
         * Must be a pre-constructed z.object() schema (not raw shape) for CF Workers compatibility
         */
        inputSchema?: TInput;

        /**
         * The Zod schema for validating tool output (optional)
         * When provided, enables structuredContent in responses
         * Must be a pre-constructed z.object() schema (not raw shape) for CF Workers compatibility
         */
        outputSchema?: TOutput;

        /**
         * The handler function for the tool
         * Args type is inferred from inputSchema via z.infer<TInput>
         */
        handler(args: z.infer<TInput>, extra?: unknown): Promise<CallToolResult>;

        /** Optional hints about tool behavior */
        annotations?: {
            readOnlyHint?: boolean;    // If true, the tool does not modify its environment
            destructiveHint?: boolean; // If true, the tool may perform destructive updates
            idempotentHint?: boolean;  // If true, repeated calls with same args have no additional effect
            openWorldHint?: boolean;   // If true, tool interacts with external entities
        }
    }

    /**
     * Helper function to define a tool with type inference
     * Automatically infers handler args type from inputSchema
     */
    function defineTool<
        TInput extends z.ZodType,
        TOutput extends z.ZodType = z.ZodType
    >(tool: McpTool<TInput, TOutput>): McpTool<TInput, TOutput>;
}
