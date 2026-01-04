/**
 * Resources index - exports all resource providers
 */

export { McpResourceProvider } from './baseResourceProvider';
export type { ResourceContext } from './baseResourceProvider';
export { DocumentationResourceProvider } from './documentation';
export { BlockResourceProvider } from './blocks';
export { PathResourceProvider } from './paths';

import { McpResourceProvider } from './baseResourceProvider';
import { DocumentationResourceProvider } from './documentation';
import { BlockResourceProvider } from './blocks';
import { PathResourceProvider } from './paths';

/**
 * Get all resource providers
 */
export function getAllResourceProviders(): McpResourceProvider[] {
  return [
    new DocumentationResourceProvider(),
    new BlockResourceProvider(),
    new PathResourceProvider(),
  ];
}
