/**
 * Tests for MCP response helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  createSuccessResponse,
  createJsonResponse,
  createArrayResponse,
  createImageContent,
  createAudioContent,
  createErrorResponse,
  createTextResource,
  createBlobResource,
  createResourceLink,
} from '../workers/mcp-backend/utils/mcpResponse';

describe('createSuccessResponse', () => {
  it('creates text response', () => {
    const result = createSuccessResponse('Done');
    expect(result.content).toEqual([{ type: 'text', text: 'Done' }]);
    expect(result.isError).toBeUndefined();
  });

  it('includes extra content', () => {
    const image = createImageContent('base64data', 'image/png');
    const result = createSuccessResponse('Here is the image', [image]);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Here is the image' });
    expect(result.content[1]).toEqual({ type: 'image', data: 'base64data', mimeType: 'image/png' });
  });
});

describe('createJsonResponse', () => {
  it('creates response with YAML text and structured content', () => {
    const result = createJsonResponse({ id: '123', name: 'test' });
    expect(result.content[0].type).toBe('text');
    expect(result.structuredContent).toEqual({ id: '123', name: 'test' });
  });

  it('handles non-serializable data gracefully', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // Should not throw - falls back to error info
    const result = createJsonResponse(circular as any);
    expect(result.content).toBeDefined();
  });
});

describe('createArrayResponse', () => {
  it('wraps array with count', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = createArrayResponse(items, 'blocks');
    expect(result.structuredContent).toEqual({
      count: 2,
      blocks: [{ id: '1' }, { id: '2' }],
    });
  });

  it('includes context fields', () => {
    const result = createArrayResponse([], 'rows', { query: 'SELECT *' });
    expect(result.structuredContent).toEqual({
      count: 0,
      query: 'SELECT *',
      rows: [],
    });
  });
});

describe('createErrorResponse', () => {
  it('sets isError flag', () => {
    const result = createErrorResponse('Something failed');
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Something failed' });
  });

  it('includes structured data', () => {
    const result = createErrorResponse('Partial failure', {
      deleted: ['a'],
      failed: ['b'],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      deleted: ['a'],
      failed: ['b'],
    });
  });
});

describe('content factories', () => {
  it('createImageContent', () => {
    const img = createImageContent('abc123', 'image/png');
    expect(img).toEqual({ type: 'image', data: 'abc123', mimeType: 'image/png' });
  });

  it('createAudioContent', () => {
    const audio = createAudioContent('xyz789', 'audio/mpeg');
    expect(audio).toEqual({ type: 'audio', data: 'xyz789', mimeType: 'audio/mpeg' });
  });

  it('createTextResource', () => {
    const res = createTextResource('file:///test.txt', 'content', 'text/plain');
    expect(res).toEqual({
      type: 'resource',
      resource: { uri: 'file:///test.txt', mimeType: 'text/plain', text: 'content' },
    });
  });

  it('createBlobResource', () => {
    const res = createBlobResource('file:///test.bin', 'base64data', 'application/pdf');
    expect(res).toEqual({
      type: 'resource',
      resource: { uri: 'file:///test.bin', mimeType: 'application/pdf', blob: 'base64data' },
    });
  });

  it('createResourceLink', () => {
    const link = createResourceLink('syfile:///data/file.pdf', 'file.pdf', 'application/pdf');
    expect(link).toEqual({
      type: 'resource_link',
      uri: 'syfile:///data/file.pdf',
      name: 'file.pdf',
      mimeType: 'application/pdf',
    });
  });
});
