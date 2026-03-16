/**
 * Tests for search result filtering/transformation functions
 * (pure functions that don't depend on getConfig or API calls)
 */

import { describe, it, expect } from 'vitest';
import {
  filterGroupSearchBlocksResult,
  getSearchResultString,
  filterSearchBlocksResult,
} from '../workers/mcp-backend/utils/resultFilter';

describe('getSearchResultString', () => {
  it('returns markdown when available', () => {
    expect(getSearchResultString({ markdown: '# Hello', fcontent: 'fallback' })).toBe('# Hello');
  });

  it('falls back to fcontent', () => {
    expect(getSearchResultString({ markdown: '', fcontent: 'fallback content' })).toBe('fallback content');
    expect(getSearchResultString({ fcontent: 'only fcontent' })).toBe('only fcontent');
  });

  it('returns empty string when nothing available', () => {
    expect(getSearchResultString({})).toBe('');
  });
});

describe('filterGroupSearchBlocksResult', () => {
  it('transforms grouped results', () => {
    const input = [
      {
        box: 'notebook-1',
        path: '/path.sy',
        rootID: 'doc-1',
        content: 'My Document',
        hPath: '/Notebook/My Document',
        tag: 'tag1',
        memo: '',
        children: [
          { markdown: 'child content', fcontent: '' },
        ],
      },
    ];
    const result = filterGroupSearchBlocksResult(input);
    expect(result).toEqual([
      {
        notebookId: 'notebook-1',
        path: '/path.sy',
        docId: 'doc-1',
        docName: 'My Document',
        hPath: '/Notebook/My Document',
        tag: 'tag1',
        memo: '',
        children: ['child content'],
      },
    ]);
  });

  it('handles null input', () => {
    expect(filterGroupSearchBlocksResult(null as any)).toEqual([]);
  });

  it('handles items without children', () => {
    const input = [{ box: 'nb', path: '/', rootID: 'id', content: 'doc', hPath: '/doc', tag: '', memo: '' }];
    const result = filterGroupSearchBlocksResult(input);
    expect(result[0].children).toEqual([]);
  });
});

describe('filterSearchBlocksResult', () => {
  it('transforms flat results', () => {
    const input = [
      {
        box: 'notebook-1',
        path: '/path.sy',
        rootID: 'doc-1',
        id: 'block-1',
        markdown: 'block content',
        hPath: '/Notebook/Doc',
        tag: 'tag1',
        memo: 'note',
        alias: 'alias1',
      },
    ];
    const result = filterSearchBlocksResult(input);
    expect(result).toEqual([
      {
        notebookId: 'notebook-1',
        path: '/path.sy',
        docId: 'doc-1',
        blockId: 'block-1',
        content: 'block content',
        docHumanPath: '/Notebook/Doc',
        tag: 'tag1',
        memo: 'note',
        alias: 'alias1',
      },
    ]);
  });

  it('handles null input', () => {
    expect(filterSearchBlocksResult(null as any)).toEqual([]);
  });
});
