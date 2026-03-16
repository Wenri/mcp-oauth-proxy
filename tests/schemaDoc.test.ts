/**
 * Tests for schema documentation generator
 */

import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import {
  generateToolSignature,
  generateToolSignatures,
  generateToolDoc,
  generateToolTypeDoc,
} from '../workers/mcp-backend/utils/schemaDoc';

describe('generateToolSignature', () => {
  it('generates signature for tool with input and output', () => {
    const tool = {
      name: 'test_tool',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().optional(),
      }),
      outputSchema: z.object({
        result: z.string(),
      }),
    };
    const sig = generateToolSignature(tool);
    expect(sig).toBe('test_tool(id, name?) \u2192 { result }');
  });

  it('generates signature for tool with no output', () => {
    const tool = {
      name: 'simple_tool',
      inputSchema: z.object({ query: z.string() }),
    };
    const sig = generateToolSignature(tool);
    expect(sig).toBe('simple_tool(query) \u2192 void');
  });

  it('generates signature for tool with no input', () => {
    const tool = { name: 'no_input_tool' };
    const sig = generateToolSignature(tool);
    expect(sig).toBe('no_input_tool() \u2192 void');
  });
});

describe('generateToolSignatures', () => {
  it('groups tools by category', () => {
    const tools = [
      { name: 'tool_a', inputSchema: z.object({ id: z.string() }) },
      { name: 'tool_b' },
    ];
    const result = generateToolSignatures(tools, 'My Category');
    expect(result).toContain('## My Category');
    expect(result).toContain('tool_a(id)');
    expect(result).toContain('tool_b()');
  });

  it('returns plain list without category', () => {
    const tools = [{ name: 'tool_a' }];
    const result = generateToolSignatures(tools);
    expect(result).not.toContain('##');
    expect(result).toContain('tool_a()');
  });
});

describe('generateToolDoc', () => {
  it('includes description', () => {
    const tool = {
      name: 'my_tool',
      description: 'Does something useful',
      inputSchema: z.object({ id: z.string() }),
    };
    const doc = generateToolDoc(tool);
    expect(doc).toContain('### `my_tool`');
    expect(doc).toContain('Does something useful');
    expect(doc).toContain('my_tool(id)');
  });
});

describe('generateToolTypeDoc', () => {
  it('generates type documentation for input and output', () => {
    const tool = {
      name: 'typed_tool',
      description: 'A typed tool',
      inputSchema: z.object({
        id: z.string(),
        count: z.number().optional(),
      }),
      outputSchema: z.object({
        result: z.string(),
      }),
    };
    const doc = generateToolTypeDoc(tool);
    expect(doc).toContain('### `typed_tool`');
    expect(doc).toContain('A typed tool');
    expect(doc).toContain('// Input');
    expect(doc).toContain('// Output');
    expect(doc).toContain('id: string');
    expect(doc).toContain('count?: number');
    expect(doc).toContain('result: string');
  });
});
