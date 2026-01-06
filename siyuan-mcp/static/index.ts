/**
 * Static file exports
 * All files are exported with kebab-case names matching their filenames
 */

import databaseSchemaContent from './siyuan-database-schema.md';
import sqlCheatsheetContent from './siyuan-sql-cheatsheet.md';
import querySyntaxContent from './query_syntax.md';
import promptCreateCardsCNContent from './prompt_create_cards_system_CN.md';
import promptQueryCNContent from './prompt_dynamic_query_system_CN.md';
import { generateAllToolSignatures, generateAllToolTypes } from '../tools';

// Named exports for direct import (static files)
export const databaseSchema = databaseSchemaContent;
export const sqlCheatsheet = sqlCheatsheetContent;
export const querySyntax = querySyntaxContent;
export const promptCreateCardsCN = promptCreateCardsCNContent;
export const promptQueryCN = promptQueryCNContent;

// Dynamic exports (generated from Zod schemas)
export const getToolTypes = generateAllToolTypes;
export const getToolSignatures = generateAllToolSignatures;

/** Map of URL paths to static content for HTTP serving */
export const files: Record<string, string> = {
  'database-schema': databaseSchema,
  'sql-cheatsheet': sqlCheatsheet,
  'query-syntax': querySyntax,
  'prompt-create-cards-cn': promptCreateCardsCN,
  'prompt-query-cn': promptQueryCN,
};

/** Map of URL paths to dynamic content generators */
export const dynamicFiles: Record<string, () => Promise<string>> = {
  'tool-types': getToolTypes,
  'tool-signatures': getToolSignatures,
};

/** Get content by path (supports both static and dynamic) */
export async function getFileContent(path: string): Promise<string | null> {
  if (path in files) {
    return files[path];
  }
  if (path in dynamicFiles) {
    return dynamicFiles[path]();
  }
  return null;
}
