/**
 * Tests for common validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isValidStr,
  isBlankStr,
  isMobile,
  isSelectQuery,
  isNonParentBlockType,
  isNonContainerBlockType,
  assertApiResult,
  assertNonEmptyArray,
  extractDocumentId,
} from '../workers/mcp-backend/utils/commonCheck';

describe('isValidStr', () => {
  it('returns false for invalid values', () => {
    expect(isValidStr(undefined)).toBe(false);
    expect(isValidStr(null)).toBe(false);
    expect(isValidStr('')).toBe(false);
  });

  it('returns true for valid strings', () => {
    expect(isValidStr('hello')).toBe(true);
    expect(isValidStr(' ')).toBe(true);
    expect(isValidStr('0')).toBe(true);
  });
});

describe('isBlankStr', () => {
  it('returns true for blank values', () => {
    expect(isBlankStr(undefined)).toBe(true);
    expect(isBlankStr(null)).toBe(true);
    expect(isBlankStr('')).toBe(true);
    expect(isBlankStr('   ')).toBe(true);
    expect(isBlankStr('\t\n')).toBe(true);
  });

  it('returns false for non-blank strings', () => {
    expect(isBlankStr('hello')).toBe(false);
    expect(isBlankStr(' a ')).toBe(false);
  });
});

describe('isMobile', () => {
  it('always returns false in CF Worker context', () => {
    expect(isMobile()).toBe(false);
  });
});

describe('isSelectQuery', () => {
  it('detects SELECT queries', () => {
    expect(isSelectQuery('SELECT * FROM blocks')).toBe(true);
    expect(isSelectQuery('select * from blocks')).toBe(true);
    expect(isSelectQuery('  SELECT * FROM blocks')).toBe(true);
  });

  it('rejects non-SELECT queries', () => {
    expect(isSelectQuery('INSERT INTO blocks')).toBe(false);
    expect(isSelectQuery('DELETE FROM blocks')).toBe(false);
    expect(isSelectQuery('UPDATE blocks SET')).toBe(false);
  });
});

describe('isNonParentBlockType / isNonContainerBlockType', () => {
  it('identifies non-parent block types', () => {
    expect(isNonParentBlockType('p')).toBe(true);
    expect(isNonParentBlockType('c')).toBe(true);
    expect(isNonParentBlockType('audio')).toBe(true);
    expect(isNonParentBlockType('video')).toBe(true);
    expect(isNonParentBlockType('widget')).toBe(true);
    expect(isNonParentBlockType('query_embed')).toBe(true);
  });

  it('rejects parent block types', () => {
    expect(isNonParentBlockType('d')).toBe(false);
    expect(isNonParentBlockType('h')).toBe(false);
    expect(isNonParentBlockType('l')).toBe(false);
    expect(isNonParentBlockType('b')).toBe(false);
    expect(isNonParentBlockType('s')).toBe(false);
  });

  it('isNonContainerBlockType includes headings', () => {
    expect(isNonContainerBlockType('h')).toBe(true);
    expect(isNonContainerBlockType('p')).toBe(true);
    // Container types
    expect(isNonContainerBlockType('d')).toBe(false);
    expect(isNonContainerBlockType('l')).toBe(false);
  });
});

describe('assertApiResult', () => {
  it('returns value when non-null', () => {
    expect(assertApiResult('value', 'test')).toBe('value');
    expect(assertApiResult(0, 'test')).toBe(0);
    expect(assertApiResult(false, 'test')).toBe(false);
  });

  it('throws on null/undefined', () => {
    expect(() => assertApiResult(null, 'test op')).toThrow('Failed to test op.');
    expect(() => assertApiResult(undefined, 'test op')).toThrow('Failed to test op.');
  });
});

describe('assertNonEmptyArray', () => {
  it('returns non-empty arrays', () => {
    expect(assertNonEmptyArray([1, 2], 'items')).toEqual([1, 2]);
  });

  it('throws on empty/null arrays', () => {
    expect(() => assertNonEmptyArray([], 'item')).toThrow('At least one item is required.');
    expect(() => assertNonEmptyArray(null, 'item')).toThrow('At least one item is required.');
    expect(() => assertNonEmptyArray(undefined, 'item')).toThrow('At least one item is required.');
  });
});

describe('extractDocumentId', () => {
  it('returns id for document blocks', () => {
    const block = { type: 'd', id: 'doc-id', root_id: 'root-id' } as Block;
    expect(extractDocumentId(block)).toBe('doc-id');
  });

  it('returns root_id for non-document blocks', () => {
    const block = { type: 'p', id: 'block-id', root_id: 'doc-id' } as Block;
    expect(extractDocumentId(block)).toBe('doc-id');
  });

  it('throws when no document ID available', () => {
    const block = { type: 'p', id: '', root_id: '' } as Block;
    expect(() => extractDocumentId(block)).toThrow('Could not determine the document ID.');
  });
});
