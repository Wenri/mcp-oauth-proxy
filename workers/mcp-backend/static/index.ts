/**
 * Static file exports
 *
 * Uses getter functions to avoid module initialization order issues
 * with text imports in Wrangler's bundler.
 */

import databaseSchemaContent from './siyuan-database-schema.txt';
import sqlCheatsheetContent from './siyuan-sql-cheatsheet.txt';
import querySyntaxContent from './query_syntax.txt';
import promptCreateCardsCNContent from './prompt_create_cards_system_CN.txt';
import promptQueryCNContent from './prompt_dynamic_query_system_CN.txt';
import { generateAllToolSignatures, generateAllToolTypes } from '../tools';

// Getter functions for static content (defers access to runtime)
export const getDatabaseSchema = () => databaseSchemaContent;
export const getSqlCheatsheet = () => sqlCheatsheetContent;
export const getQuerySyntax = () => querySyntaxContent;
export const getPromptCreateCardsCN = () => promptCreateCardsCNContent;
export const getPromptQueryCN = () => promptQueryCNContent;

// Legacy named exports for prompts (used by siyuan-mcp/index.ts)
export const promptCreateCardsCN = promptCreateCardsCNContent;
export const promptQueryCN = promptQueryCNContent;

// Dynamic exports (generated from Zod schemas)
export const getToolTypes = generateAllToolTypes;
export const getToolSignatures = generateAllToolSignatures;

/** Static content registry */
const staticFiles: Record<string, () => string> = {
  'database-schema': getDatabaseSchema,
  'sql-cheatsheet': getSqlCheatsheet,
  'query-syntax': getQuerySyntax,
  'prompt-create-cards-cn': getPromptCreateCardsCN,
  'prompt-query-cn': getPromptQueryCN,
};

/** Dynamic content registry */
const dynamicFiles: Record<string, () => Promise<string>> = {
  'tool-types': getToolTypes,
  'tool-signatures': getToolSignatures,
};

/** Get content by path (supports both static and dynamic) */
export async function getFileContent(path: string): Promise<string | null> {
  if (path in staticFiles) {
    return staticFiles[path]();
  }
  if (path in dynamicFiles) {
    return dynamicFiles[path]();
  }
  return null;
}

/** Get all available static file paths */
export function getStaticFilePaths(): string[] {
  return Object.keys(staticFiles);
}
