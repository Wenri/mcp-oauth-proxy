/**
 * Tests for common utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  parseDateString,
  generateUUID,
  base64ToBlob,
  blobToBase64Object,
  extractNodeParagraphIds,
} from '../workers/mcp-backend/utils/common';

describe('parseDateString', () => {
  it('parses valid date string', () => {
    const date = parseDateString('20241231120000');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2024);
    expect(date!.getMonth()).toBe(11); // 0-indexed
    expect(date!.getDate()).toBe(31);
    expect(date!.getHours()).toBe(12);
    expect(date!.getMinutes()).toBe(0);
    expect(date!.getSeconds()).toBe(0);
  });

  it('returns null for wrong length', () => {
    expect(parseDateString('2024')).toBeNull();
    expect(parseDateString('')).toBeNull();
    expect(parseDateString('123456789012345')).toBeNull();
  });

  it('parses midnight correctly', () => {
    const date = parseDateString('20260101000000');
    expect(date).not.toBeNull();
    expect(date!.getHours()).toBe(0);
  });
});

describe('generateUUID', () => {
  it('generates valid UUID v4 format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique values', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });
});

describe('base64ToBlob / blobToBase64Object', () => {
  it('converts base64 to blob', () => {
    const base64 = btoa('hello world');
    const blob = base64ToBlob(base64, 'text/plain');
    expect(blob.size).toBe(11);
    expect(blob.type).toBe('text/plain');
  });

  it('handles data URL prefix', () => {
    const base64 = `data:text/plain;base64,${btoa('test')}`;
    const blob = base64ToBlob(base64, 'text/plain');
    expect(blob.size).toBe(4);
  });

  it('roundtrips through blobToBase64Object', async () => {
    const original = 'hello world';
    const blob = base64ToBlob(btoa(original), 'text/plain');
    const obj = await blobToBase64Object(blob);
    expect(obj.mimeType).toBe('text/plain');
    expect(obj.type).toBe('text');
    expect(atob(obj.data)).toBe(original);
  });
});

describe('extractNodeParagraphIds', () => {
  it('extracts paragraph node IDs from HTML', () => {
    const html = `
      <div data-type="NodeParagraph" data-node-id="20241231120000-abc1234">text</div>
      <div data-type="NodeParagraph" data-node-id="20241231120000-def5678">more</div>
    `;
    const ids = extractNodeParagraphIds(html);
    expect(ids).toEqual(['20241231120000-abc1234', '20241231120000-def5678']);
  });

  it('returns empty array for non-matching HTML', () => {
    expect(extractNodeParagraphIds('<p>no ids here</p>')).toEqual([]);
    expect(extractNodeParagraphIds('')).toEqual([]);
  });

  it('ignores non-paragraph nodes', () => {
    const html = '<div data-type="NodeHeading" data-node-id="20241231120000-abc1234">heading</div>';
    expect(extractNodeParagraphIds(html)).toEqual([]);
  });
});
