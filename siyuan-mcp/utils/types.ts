/**
 * Shared type definitions and Zod schemas
 */

import { z } from 'zod';

/** JSON-serializable value type (recursive) */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Zod schema for JSON-serializable values (recursive) */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);
