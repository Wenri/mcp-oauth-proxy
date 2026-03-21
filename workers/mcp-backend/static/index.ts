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

// Named content exports
export {
  databaseSchemaContent,
  sqlCheatsheetContent,
  querySyntaxContent,
  promptCreateCardsCNContent,
  promptQueryCNContent,
  mdSyntaxCNContent,
  superblockCNContent,
  templateActionCNContent,
  promptTemplateCNContent,
};

/** Static content registry */
export const staticFiles: Record<string, string> = {
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
export const dynamicFiles: Record<string, () => Promise<string>> = {
  'tool-types': generateAllToolTypes,
  'tool-signatures': generateAllToolSignatures,
};

