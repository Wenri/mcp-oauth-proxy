/**
 * Static file exports
 * All files are exported with kebab-case names matching their filenames
 */

import databaseSchemaContent from './siyuan-database-schema.md';
import sqlCheatsheetContent from './siyuan-sql-cheatsheet.md';
import querySyntaxContent from './query_syntax.md';
import promptCreateCardsCNContent from './prompt_create_cards_system_CN.md';
import promptQueryCNContent from './prompt_dynamic_query_system_CN.md';

// Named exports for direct import
export const databaseSchema = databaseSchemaContent;
export const sqlCheatsheet = sqlCheatsheetContent;
export const querySyntax = querySyntaxContent;
export const promptCreateCardsCN = promptCreateCardsCNContent;
export const promptQueryCN = promptQueryCNContent;

/** Map of URL paths to content for HTTP serving */
export const files: Record<string, string> = {
  'database-schema': databaseSchema,
  'sql-cheatsheet': sqlCheatsheet,
  'query-syntax': querySyntax,
  'prompt-create-cards-cn': promptCreateCardsCN,
  'prompt-query-cn': promptQueryCN,
};
