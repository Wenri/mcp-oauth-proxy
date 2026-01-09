/**
 * Utility to generate documentation from Zod schemas (Zod v4 compatible)
 */

import * as z from 'zod';

/**
 * Extract a concise type string from a Zod schema using runtime checks
 */
function zodToTypeString(schema: z.ZodType, depth = 0): string {
  // Get the internal type name via _zod.def.type
  const def = (schema as { _zod?: { def?: { type?: string } } })._zod?.def;
  const typeName = def?.type;

  // Fallback: check constructor name
  const ctorName = schema.constructor?.name ?? '';

  if (typeName === 'string' || ctorName === 'ZodString') return 'string';
  if (typeName === 'number' || ctorName === 'ZodNumber') return 'number';
  if (typeName === 'boolean' || ctorName === 'ZodBoolean') return 'boolean';
  if (typeName === 'null' || ctorName === 'ZodNull') return 'null';
  if (typeName === 'undefined' || ctorName === 'ZodUndefined') return 'undefined';
  if (typeName === 'any' || ctorName === 'ZodAny') return 'any';
  if (typeName === 'unknown' || ctorName === 'ZodUnknown') return 'unknown';

  if (typeName === 'literal' || ctorName === 'ZodLiteral') {
    const value = (def as { values?: unknown })?.values;
    return value !== undefined ? JSON.stringify(value) : 'literal';
  }

  if (typeName === 'enum' || ctorName === 'ZodEnum') {
    const values = (def as { values?: readonly string[] })?.values;
    if (Array.isArray(values)) {
      return values.map(v => `'${v}'`).join(' | ');
    }
    return 'enum';
  }

  if (typeName === 'array' || ctorName === 'ZodArray') {
    const element = (def as { element?: z.ZodType })?.element;
    if (element) {
      return `${zodToTypeString(element, depth)}[]`;
    }
    return 'unknown[]';
  }

  if (typeName === 'object' || ctorName === 'ZodObject') {
    if (depth > 1) return '{...}';
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    if (!shape) return '{}';

    const fields = Object.entries(shape).map(([key, value]) => {
      const fieldSchema = value as z.ZodType;
      const isOptional = fieldSchema.isOptional?.() ?? false;
      return `${key}${isOptional ? '?' : ''}`;
    });
    return `{ ${fields.join(', ')} }`;
  }

  if (typeName === 'optional' || ctorName === 'ZodOptional') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? zodToTypeString(inner, depth) : 'unknown';
  }

  if (typeName === 'nullable' || ctorName === 'ZodNullable') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? `${zodToTypeString(inner, depth)} | null` : 'unknown | null';
  }

  if (typeName === 'default' || ctorName === 'ZodDefault') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? zodToTypeString(inner, depth) : 'unknown';
  }

  if (typeName === 'union' || ctorName === 'ZodUnion') {
    const options = (def as { options?: z.ZodType[] })?.options;
    if (Array.isArray(options)) {
      return options.map(opt => zodToTypeString(opt, depth)).join(' | ');
    }
    return 'unknown';
  }

  if (typeName === 'record' || ctorName === 'ZodRecord') {
    return 'Record<string, string>';
  }

  if (typeName === 'lazy' || ctorName === 'ZodLazy') {
    return 'recursive';
  }

  return 'unknown';
}

/**
 * Generate input parameter signature from Zod object schema
 */
function generateInputSignature(schema: z.ZodType | undefined): string {
  if (!schema) return '';

  const ctorName = schema.constructor?.name ?? '';
  if (ctorName !== 'ZodObject') return '';

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (!shape) return '';

  const params = Object.entries(shape).map(([key, value]) => {
    const fieldSchema = value as z.ZodType;
    const isOptional = fieldSchema.isOptional?.() ?? false;
    return `${key}${isOptional ? '?' : ''}`;
  });

  return params.join(', ');
}

/**
 * Generate output type signature from Zod object schema
 */
function generateOutputSignature(schema: z.ZodType | undefined): string {
  if (!schema) return 'void';
  return zodToTypeString(schema, 0);
}

/**
 * Tool definition interface
 */
interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: z.ZodType;
  outputSchema?: z.ZodType;
}

/**
 * Generate a one-line signature for a tool
 */
export function generateToolSignature(tool: ToolDef): string {
  const input = generateInputSignature(tool.inputSchema);
  const output = generateOutputSignature(tool.outputSchema);

  return `${tool.name}(${input}) → ${output}`;
}

/**
 * Generate signatures for multiple tools, grouped by category
 */
export function generateToolSignatures(
  tools: ToolDef[],
  categoryName?: string
): string {
  const lines = tools.map(tool => generateToolSignature(tool));
  if (categoryName) {
    return `## ${categoryName}\n\n\`\`\`typescript\n${lines.join('\n')}\n\`\`\``;
  }
  return lines.join('\n');
}

/**
 * Generate full documentation for a tool including description
 */
export function generateToolDoc(tool: ToolDef): string {
  const signature = generateToolSignature(tool);
  const desc = tool.description ? `\n${tool.description}` : '';
  return `### \`${tool.name}\`${desc}\n\n\`\`\`typescript\n${signature}\n\`\`\``;
}

/**
 * Extract detailed type definition from a Zod schema (for documentation)
 */
function zodToDetailedType(schema: z.ZodType, indent = 0): string {
  const pad = '  '.repeat(indent);
  const def = (schema as { _zod?: { def?: { type?: string } } })._zod?.def;
  const typeName = def?.type;
  const ctorName = schema.constructor?.name ?? '';

  // Primitives
  if (typeName === 'string' || ctorName === 'ZodString') return 'string';
  if (typeName === 'number' || ctorName === 'ZodNumber') return 'number';
  if (typeName === 'boolean' || ctorName === 'ZodBoolean') return 'boolean';
  if (typeName === 'null' || ctorName === 'ZodNull') return 'null';
  if (typeName === 'undefined' || ctorName === 'ZodUndefined') return 'undefined';
  if (typeName === 'any' || ctorName === 'ZodAny') return 'any';
  if (typeName === 'unknown' || ctorName === 'ZodUnknown') return 'unknown';

  if (typeName === 'literal' || ctorName === 'ZodLiteral') {
    const value = (def as { values?: unknown })?.values;
    return value !== undefined ? JSON.stringify(value) : 'literal';
  }

  if (typeName === 'enum' || ctorName === 'ZodEnum') {
    const values = (def as { values?: readonly string[] })?.values;
    if (Array.isArray(values)) {
      return values.map(v => `'${v}'`).join(' | ');
    }
    return 'enum';
  }

  if (typeName === 'array' || ctorName === 'ZodArray') {
    const element = (def as { element?: z.ZodType })?.element;
    if (element) {
      const inner = zodToDetailedType(element, indent);
      // For complex inner types, format nicely
      if (inner.includes('\n')) {
        return `Array<\n${inner}\n${pad}>`;
      }
      return `${inner}[]`;
    }
    return 'unknown[]';
  }

  if (typeName === 'object' || ctorName === 'ZodObject') {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    if (!shape || Object.keys(shape).length === 0) return '{}';

    const lines: string[] = ['{'];
    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodType;
      const isOptional = fieldSchema.isOptional?.() ?? false;
      const fieldDef = (fieldSchema as { _zod?: { def?: { description?: string } } })._zod?.def;
      const fieldDesc = (fieldSchema as { description?: string }).description ?? fieldDef?.description;

      // Unwrap optional/default to get inner type
      let innerSchema = fieldSchema;
      const innerDef = (fieldSchema as { _zod?: { def?: { type?: string; innerType?: z.ZodType } } })._zod?.def;
      if (innerDef?.type === 'optional' || innerDef?.type === 'default') {
        innerSchema = innerDef.innerType ?? fieldSchema;
      }

      const fieldType = zodToDetailedType(innerSchema, indent + 1);
      const optionalMark = isOptional ? '?' : '';
      const descComment = fieldDesc ? `  // ${fieldDesc}` : '';

      lines.push(`${pad}  ${key}${optionalMark}: ${fieldType};${descComment}`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }

  if (typeName === 'optional' || ctorName === 'ZodOptional') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? zodToDetailedType(inner, indent) : 'unknown';
  }

  if (typeName === 'nullable' || ctorName === 'ZodNullable') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? `${zodToDetailedType(inner, indent)} | null` : 'unknown | null';
  }

  if (typeName === 'default' || ctorName === 'ZodDefault') {
    const inner = (def as { innerType?: z.ZodType })?.innerType;
    return inner ? zodToDetailedType(inner, indent) : 'unknown';
  }

  if (typeName === 'union' || ctorName === 'ZodUnion') {
    const options = (def as { options?: z.ZodType[] })?.options;
    if (Array.isArray(options)) {
      return options.map(opt => zodToDetailedType(opt, indent)).join(' | ');
    }
    return 'unknown';
  }

  if (typeName === 'record' || ctorName === 'ZodRecord') {
    const valueType = (def as { valueType?: z.ZodType })?.valueType;
    const valueStr = valueType ? zodToDetailedType(valueType, indent) : 'unknown';
    return `Record<string, ${valueStr}>`;
  }

  if (typeName === 'lazy' || ctorName === 'ZodLazy') {
    return 'recursive';
  }

  return 'unknown';
}

/**
 * Generate full type definition documentation for a tool
 */
export function generateToolTypeDoc(tool: ToolDef): string {
  const lines: string[] = [];

  lines.push(`### \`${tool.name}\``);
  lines.push('');
  if (tool.description) {
    lines.push(tool.description);
    lines.push('');
  }

  lines.push('```typescript');

  // Input type
  if (tool.inputSchema) {
    const inputType = zodToDetailedType(tool.inputSchema);
    lines.push(`// Input`);
    lines.push(`interface Input ${inputType}`);
    lines.push('');
  }

  // Output type
  if (tool.outputSchema) {
    const outputType = zodToDetailedType(tool.outputSchema);
    lines.push(`// Output`);
    if (outputType.includes('\n')) {
      lines.push(`interface Output ${outputType}`);
    } else {
      lines.push(`type Output = ${outputType};`);
    }
  } else {
    lines.push(`// Output: void`);
  }

  lines.push('```');

  return lines.join('\n');
}

/**
 * Generate full type documentation for multiple tools
 */
export function generateToolTypeDocs(
  tools: ToolDef[],
  categoryName?: string
): string {
  const docs = tools.map(tool => generateToolTypeDoc(tool));
  if (categoryName) {
    return `## ${categoryName}\n\n${docs.join('\n\n')}`;
  }
  return docs.join('\n\n');
}
