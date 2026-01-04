/**
 * Resources index - exports all resource providers
 */

export { McpResourceProvider } from './baseResourceProvider';
export type { ResourceContext } from './baseResourceProvider';
export { DocumentationResourceProvider } from './documentation';
export { NotebookResourceProvider } from './notebooks';
export { DocumentResourceProvider } from './documents';
export { BlockResourceProvider } from './blocks';

import { McpResourceProvider } from './baseResourceProvider';
import { DocumentationResourceProvider } from './documentation';
import { NotebookResourceProvider } from './notebooks';
import { DocumentResourceProvider } from './documents';
import { BlockResourceProvider } from './blocks';

/**
 * Get all resource providers
 */
export function getAllResourceProviders(): McpResourceProvider[] {
  return [
    new DocumentationResourceProvider(),
    new NotebookResourceProvider(),
    new DocumentResourceProvider(),
    new BlockResourceProvider(),
  ];
}
