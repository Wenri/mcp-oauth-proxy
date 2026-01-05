import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

declare global {
    /**
     * Infer handler argument types from a Zod schema record
     */
    type InferSchemaArgs<TSchema extends Record<string, z.ZodTypeAny>> = {
        [K in keyof TSchema]: z.infer<TSchema[K]>
    };

    /**
     * Tool definition for SiYuan MCP tools
     * Matches the SDK's registerTool API structure
     *
     * @template TSchema - The Zod schema record type, defaults to empty for tools with no params
     */
    interface McpTool<TSchema extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>> {
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
        inputSchema?: TSchema;

        /**
         * The Zod schema for validating tool output (optional)
         * When provided, enables structuredContent in responses
         */
        outputSchema?: Record<string, z.ZodTypeAny>;

        /**
         * The handler function for the tool
         * Args type is inferred from inputSchema
         * Using method syntax for bivariance to allow heterogeneous tool arrays
         */
        handler(args: InferSchemaArgs<TSchema>, extra?: unknown): Promise<CallToolResult>;

        /** Optional hints about tool behavior */
        annotations?: {
            readOnlyHint?: boolean;    // If true, the tool does not modify its environment
            destructiveHint?: boolean; // If true, the tool may perform destructive updates
            idempotentHint?: boolean;  // If true, repeated calls with same args have no additional effect
            openWorldHint?: boolean;   // If true, tool interacts with external entities
        }
    }
}

