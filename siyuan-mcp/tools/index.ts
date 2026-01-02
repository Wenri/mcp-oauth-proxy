/**
 * Tools index - exports all tool providers
 */

export { McpToolsProvider } from './baseToolProvider';
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
export { TimeToolProvider } from './time';
export { AssetToolProvider } from './assets';
export { FileSystemToolProvider } from './filesystem';

// Re-export shared functions
export { createNewDoc, createNewDocWithParentId } from './sharedFunction';

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
import { TimeToolProvider } from './time';
import { AssetToolProvider } from './assets';
import { FileSystemToolProvider } from './filesystem';

/**
 * Get all tool providers
 */
export function getAllToolProviders(): McpToolsProvider<any>[] {
  return [
    new DocReadToolProvider(),
    new DocWriteToolProvider(),
    new BlockWriteToolProvider(),
    new SqlToolProvider(),
    new SearchToolProvider(),
    new AttributeToolProvider(),
    new DailyNoteToolProvider(),
    new FlashcardToolProvider(),
    new DocVectorSearchProvider(),
    new RelationToolProvider(),
    new TimeToolProvider(),
    new AssetToolProvider(),
    new FileSystemToolProvider(),
  ];
}
