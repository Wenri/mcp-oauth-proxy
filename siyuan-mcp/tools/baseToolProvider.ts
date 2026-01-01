/**
 * Base tool provider interface
 * From upstream - unchanged
 */

import { z } from 'zod';

export interface McpTool<T extends z.ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  handler: (params: z.infer<z.ZodObject<T>>, extra?: any) => Promise<any>;
  title?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean; // If true, tool interacts with external entities
  };
}

export abstract class McpToolsProvider<T extends z.ZodRawShape> {
  abstract getTools(): Promise<McpTool<T>[]>;
}
