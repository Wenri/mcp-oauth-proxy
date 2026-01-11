/**
 * Shared type definitions and Zod schemas
 */

import { z } from 'zod';

/** JSON-serializable value type (recursive) */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Non-recursive JSON value schema for MCP tool input schemas.
 * Uses z.unknown() for nested values to avoid cyclic references that break JSON Schema serialization.
 */
export const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
