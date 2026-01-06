/**
 * Tools index - exports all tool providers
 */

export { McpToolsProvider, createNewDoc, createNewDocWithParentId } from './baseToolProvider';
export { DocReadToolProvider } from './docRead';
export { DocWriteToolProvider } from './docWrite';
export { BlockWriteToolProvider } from './blockWrite';
export { SqlToolProvider } from './sql';
export { SearchToolProvider } from './search';
export { AttributeToolProvider } from './attributes';
export { DailyNoteToolProvider } from './dailynote';
export { FlashcardToolProvider } from './flashCard';
export { DocVectorSearchProvider } from './vectorSearch';
export { RelationToolProvider } from './relation';
export { AssetToolProvider } from './assets';
export { FileSystemToolProvider } from './filesystem';
export { UtilityToolProvider } from './utility';

import { McpToolsProvider } from './baseToolProvider';
import { DocReadToolProvider } from './docRead';
import { DocWriteToolProvider } from './docWrite';
import { BlockWriteToolProvider } from './blockWrite';
import { SqlToolProvider } from './sql';
import { SearchToolProvider } from './search';
import { AttributeToolProvider } from './attributes';
import { DailyNoteToolProvider } from './dailynote';
import { FlashcardToolProvider } from './flashCard';
import { DocVectorSearchProvider } from './vectorSearch';
import { RelationToolProvider } from './relation';
import { AssetToolProvider } from './assets';
import { FileSystemToolProvider } from './filesystem';
import { UtilityToolProvider } from './utility';

/** Tool category with name and provider */
interface ToolCategory {
  name: string;
  provider: McpToolsProvider;
}

/** Get all tool providers with category names */
export function getAllToolCategories(): ToolCategory[] {
  return [
    { name: 'Document Reading', provider: new DocReadToolProvider() },
    { name: 'Document Writing', provider: new DocWriteToolProvider() },
    { name: 'Block Writing', provider: new BlockWriteToolProvider() },
    { name: 'SQL & Search', provider: new SqlToolProvider() },
    { name: 'Search', provider: new SearchToolProvider() },
    { name: 'Attributes', provider: new AttributeToolProvider() },
    { name: 'Daily Notes & Notebooks', provider: new DailyNoteToolProvider() },
    { name: 'Flashcards', provider: new FlashcardToolProvider() },
    { name: 'Vector Search / RAG', provider: new DocVectorSearchProvider() },
    { name: 'Relations', provider: new RelationToolProvider() },
    { name: 'Assets', provider: new AssetToolProvider() },
    { name: 'File System', provider: new FileSystemToolProvider() },
    { name: 'Utilities', provider: new UtilityToolProvider() },
  ];
}

/**
 * Get all tool providers
 */
export function getAllToolProviders(): McpToolsProvider[] {
  return getAllToolCategories().map(c => c.provider);
}

/**
 * Generate tool signatures documentation from all providers
 */
export async function generateAllToolSignatures(): Promise<string> {
  const categories = getAllToolCategories();
  const lines: string[] = [
    '# SiYuan MCP Tool Signatures',
    '',
    'Auto-generated from Zod schemas.',
    '',
  ];

  for (const { name, provider } of categories) {
    try {
      const signatures = await provider.getSignatures();
      if (signatures.length === 0) continue;

      lines.push(`## ${name}`);
      lines.push('');
      lines.push('```typescript');
      lines.push(...signatures);
      lines.push('```');
      lines.push('');
    } catch {
      // Skip providers that fail (e.g., RAG not configured)
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('## Legend');
  lines.push('');
  lines.push('- `param?` — Optional parameter');
  lines.push('- `→` — Returns');
  lines.push('- `field?` — Optional field in output');

  return lines.join('\n');
}

/**
 * Generate full type documentation from all providers
 */
export async function generateAllToolTypes(): Promise<string> {
  const categories = getAllToolCategories();
  const lines: string[] = [
    '# SiYuan MCP Tool Type Reference',
    '',
    'Auto-generated from Zod schemas.',
    '',
    '---',
    '',
  ];

  for (const { name, provider } of categories) {
    try {
      const typeDocs = await provider.getTypeDocs();
      if (typeDocs.length === 0) continue;

      lines.push(`## ${name}`);
      lines.push('');
      lines.push(...typeDocs);
      lines.push('');
      lines.push('---');
      lines.push('');
    } catch {
      // Skip providers that fail (e.g., RAG not configured)
    }
  }

  // Add notes section
  lines.push('## Notes');
  lines.push('');
  lines.push('1. **Optional fields with `?`**: These fields may be omitted in the response');
  lines.push('2. **hpath support**: Most tools accepting `id` also accept hpath format (e.g., "/NotebookName/Doc")');
  lines.push('3. **Batch operations**: Tools with `ids` array support batch operations with partial failure reporting');

  return lines.join('\n');
}
