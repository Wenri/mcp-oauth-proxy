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
import mdSyntaxCNContent from './data_md_syntax_CN.txt';
import superblockCNContent from './data_superblock_CN.txt';
import templateActionCNContent from './data_template_action_CN.txt';
import promptTemplateCNContent from './prompt_template_CN.txt';
import { generateAllToolSignatures, generateAllToolTypes } from '../tools';

// Getter functions for static content (defers access to runtime)
export const getDatabaseSchema = () => databaseSchemaContent;
export const getSqlCheatsheet = () => sqlCheatsheetContent;
export const getQuerySyntax = () => querySyntaxContent;
export const getPromptCreateCardsCN = () => promptCreateCardsCNContent;
export const getPromptQueryCN = () => promptQueryCNContent;
export const getMdSyntaxCN = () => mdSyntaxCNContent;
export const getSuperblockCN = () => superblockCNContent;
export const getTemplateActionCN = () => templateActionCNContent;
export const getPromptTemplateCN = () => promptTemplateCNContent;

// Legacy named exports for prompts (used by siyuan-mcp/index.ts)
export const promptCreateCardsCN = promptCreateCardsCNContent;
export const promptQueryCN = promptQueryCNContent;

// Dynamic exports (generated from Zod schemas)
export const getToolTypes = generateAllToolTypes;
export const getToolSignatures = generateAllToolSignatures;

/** Static content registry */
const staticFiles: Record<string, string> = {
  'database-schema': databaseSchemaContent,
  'sql-cheatsheet': sqlCheatsheetContent,
  'query-syntax': querySyntaxContent,
  'prompt-create-cards-cn': promptCreateCardsCNContent,
  'prompt-query-cn': promptQueryCNContent,
  'md-syntax-cn': mdSyntaxCNContent,
  'superblock-cn': superblockCNContent,
  'template-actions-cn': templateActionCNContent,
};

/** Dynamic content registry */
const dynamicFiles: Record<string, () => Promise<string>> = {
  'tool-types': getToolTypes,
  'tool-signatures': getToolSignatures,
};

/** Get content by path (supports both static and dynamic) */
export async function getFileContent(path: string): Promise<string | null> {
  if (path in staticFiles) {
    return staticFiles[path];
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
