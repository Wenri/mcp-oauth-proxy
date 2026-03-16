/**
 * Tests for content resolver utilities
 */

import { describe, it, expect } from 'vitest';
import {
  getMimeType,
  inferContentType,
  ResolvedContent,
  UrlFetchError,
} from '../workers/mcp-backend/utils/contentResolver';

describe('getMimeType', () => {
  it('resolves common extensions', () => {
    expect(getMimeType('image.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
    expect(getMimeType('data.json')).toBe('application/json');
    expect(getMimeType('style.css')).toBe('text/css');
    expect(getMimeType('page.html')).toBe('text/html');
    expect(getMimeType('song.mp3')).toBe('audio/mpeg');
    expect(getMimeType('video.mp4')).toBe('video/mp4');
    expect(getMimeType('archive.zip')).toBe('application/zip');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('noext')).toBe('application/octet-stream');
  });

  it('is case-insensitive via lowercase', () => {
    // getMimeType does .toLowerCase() on extension
    expect(getMimeType('IMAGE.PNG')).toBe('image/png');
  });
});

describe('inferContentType', () => {
  it('infers json for objects', () => {
    expect(inferContentType({ key: 'value' })).toBe('json');
  });

  it('infers json for arrays', () => {
    expect(inferContentType([1, 2, 3])).toBe('json');
  });

  it('returns default type for strings', () => {
    expect(inferContentType('hello')).toBe('text');
    expect(inferContentType('hello', 'base64')).toBe('base64');
  });
});

describe('ResolvedContent', () => {
  it('creates text content', async () => {
    const content = await ResolvedContent.from('Hello, World!', 'text', 'hello.txt');
    expect(content.type).toBe('text/plain');
    expect(content.fileName).toBe('hello.txt');
    expect(await content.text()).toBe('Hello, World!');
  });

  it('creates JSON content from object', async () => {
    const obj = { key: 'value', num: 42 };
    const content = await ResolvedContent.from(obj, 'json', 'data.json');
    expect(content.type).toBe('application/json');
    const parsed = JSON.parse(await content.text());
    expect(parsed).toEqual(obj);
  });

  it('creates base64 content', async () => {
    const base64 = btoa('binary data');
    const content = await ResolvedContent.from(base64, 'base64', 'file.bin');
    expect(content.type).toBe('application/octet-stream');
    const bytes = new Uint8Array(await content.arrayBuffer());
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('binary data');
  });

  it('creates hex content', async () => {
    const hex = '48656c6c6f'; // "Hello"
    const content = await ResolvedContent.from(hex, 'hex', 'test.bin');
    const bytes = new Uint8Array(await content.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('Hello');
  });

  it('handles 0x prefix in hex', async () => {
    const hex = '0x48656c6c6f';
    const content = await ResolvedContent.from(hex, 'hex', 'test.bin');
    const bytes = new Uint8Array(await content.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('Hello');
  });

  it('throws for non-string text content', async () => {
    await expect(
      ResolvedContent.from({ key: 'val' } as any, 'text')
    ).rejects.toThrow('Text content must be a string');
  });

  it('throws for non-string URL content', async () => {
    await expect(
      ResolvedContent.from({ key: 'val' } as any, 'url')
    ).rejects.toThrow('URL content must be a string');
  });
});

describe('UrlFetchError', () => {
  it('has correct properties', () => {
    const err = new UrlFetchError('test error', 'TIMEOUT');
    expect(err.message).toBe('test error');
    expect(err.code).toBe('TIMEOUT');
    expect(err.name).toBe('UrlFetchError');
    expect(err.statusCode).toBeUndefined();
  });

  it('includes status code when provided', () => {
    const err = new UrlFetchError('not found', 'HTTP_ERROR', 404);
    expect(err.statusCode).toBe(404);
  });
});
