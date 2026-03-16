/**
 * Tests for pure functions in syapi/custom.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getUpdateString,
  generateBlockId,
  transfromAttrToIAL,
  isValidIdFormat,
  escapeSqlString,
  checkIdValid,
} from '../workers/mcp-backend/syapi/custom';

describe('isValidIdFormat', () => {
  it('accepts valid block IDs', () => {
    expect(isValidIdFormat('20241231120000-abc1234')).toBe(true);
    expect(isValidIdFormat('20230101000000-ABCDEFG')).toBe(true);
    expect(isValidIdFormat('20260316120000-a1b2c3d')).toBe(true);
  });

  it('rejects invalid IDs', () => {
    expect(isValidIdFormat('')).toBe(false);
    expect(isValidIdFormat('not-an-id')).toBe(false);
    expect(isValidIdFormat('20241231120000')).toBe(false);       // missing suffix
    expect(isValidIdFormat('20241231120000-abc')).toBe(false);    // suffix too short
    expect(isValidIdFormat('20241231120000-abc12345')).toBe(false); // suffix too long
    expect(isValidIdFormat('2024123112000X-abc1234')).toBe(false);  // non-digit in prefix
  });
});

describe('escapeSqlString', () => {
  it('escapes single quotes', () => {
    expect(escapeSqlString("it's")).toBe("it''s");
    expect(escapeSqlString("'hello'")).toBe("''hello''");
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeSqlString('hello')).toBe('hello');
    expect(escapeSqlString('')).toBe('');
  });
});

describe('checkIdValid', () => {
  it('does not throw for valid IDs', () => {
    expect(() => checkIdValid('20241231120000-abc1234')).not.toThrow();
  });

  it('throws for invalid IDs', () => {
    expect(() => checkIdValid('bad-id')).toThrow('format is incorrect');
  });
});

describe('getUpdateString', () => {
  it('returns 14-character timestamp', () => {
    const result = getUpdateString();
    expect(result).toMatch(/^\d{14}$/);
  });

  it('starts with current year', () => {
    const result = getUpdateString();
    const year = new Date().getFullYear().toString();
    expect(result.startsWith(year)).toBe(true);
  });
});

describe('generateBlockId', () => {
  it('matches block ID format', () => {
    const id = generateBlockId();
    expect(isValidIdFormat(id)).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateBlockId()));
    expect(ids.size).toBe(50);
  });
});

describe('transfromAttrToIAL', () => {
  it('converts attributes to IAL format', () => {
    const result = transfromAttrToIAL({ id: '123', name: 'test' });
    expect(result).toBe('{: id="123" name="test"}');
  });

  it('returns null for empty attributes', () => {
    expect(transfromAttrToIAL({})).toBeNull();
  });

  it('handles single attribute', () => {
    const result = transfromAttrToIAL({ custom: 'value' });
    expect(result).toBe('{: custom="value"}');
  });
});
