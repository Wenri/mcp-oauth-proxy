/**
 * Base tool provider and shared functions
 */

import type { z } from 'zod';
import { createDocWithMdAPI } from '../syapi';
import { generateToolSignature, generateToolTypeDoc } from '../utils/schemaDoc';


/**
 * Helper function to define a tool with type inference.
 * Automatically infers handler args type from inputSchema.
 *
 * @example
 * defineTool({
 *   name: 'get_block',
 *   description: 'Get a block by ID',
 *   inputSchema: z.object({ id: z.string() }),
 *   handler: async (args) => {
 *     // args.id is inferred as string
 *   }
 * })
 */
export function defineTool<
  TInput extends z.ZodType,
  TOutput extends z.ZodType = z.ZodType
>(tool: McpTool<TInput, TOutput>): McpTool<TInput, TOutput> {
  return tool;
}

export abstract class McpToolsProvider {
  abstract getTools(): Promise<McpTool[]>;

  /** Generate signatures for all tools in this provider */
  async getSignatures(): Promise<string[]> {
    const tools = await this.getTools();
    return tools.map(tool => generateToolSignature(tool));
  }

  /** Generate full type documentation for all tools in this provider */
  async getTypeDocs(): Promise<string[]> {
    const tools = await this.getTools();
    return tools.map(tool => generateToolTypeDoc(tool));
  }
}

export async function createNewDoc(
  notebookId: NotebookId,
  parentDocId: DocumentId,
  title: string,
  content: string
): Promise<DocumentId | null> {
  const hpath = `/${parentDocId}/${title}`;
  const docId = await createDocWithMdAPI(notebookId, hpath, content);
  return docId;
}
