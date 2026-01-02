# SiYuan SQL Cheatsheet

> Quick reference for querying SiYuan's SQLite database via the MCP API

---

## Quick Reference

### Essential Queries

```sql
-- All documents
SELECT id, hpath as title, updated FROM blocks WHERE type = 'd' ORDER BY updated DESC;

-- Search content (use FTS5 for speed, LIKE for simplicity)
SELECT id, type, substr(content, 1, 100) FROM blocks WHERE content LIKE '%keyword%';

-- Document content (all blocks in a doc)
SELECT * FROM blocks WHERE root_id = 'DOC_ID' ORDER BY sort;
```

---

## Block Type Queries

### By Type

```sql
-- Filter by type: d=doc, p=para, h=heading, c=code, l=list, i=item, t=table, b=quote
SELECT * FROM blocks WHERE type = 'p';                      -- All paragraphs
SELECT * FROM blocks WHERE type = 'h' AND subtype = 'h2';   -- H2 headings only
SELECT * FROM blocks WHERE type = 'i' AND subtype = 't';    -- Task list items
```

### Type Statistics

```sql
SELECT 
    type,
    subtype,
    COUNT(*) as count,
    SUM(length) as total_chars,
    ROUND(AVG(length), 1) as avg_length
FROM blocks
GROUP BY type, subtype
ORDER BY count DESC;
```

---

## Full-Text Search (FTS5)

```sql
-- Case-insensitive search with relevance ranking (lower score = more relevant)
-- Syntax: 'word1 word2' (AND), 'a OR b', 'a NOT b', '"exact phrase"', 'prefix*', 'col:term'
SELECT id, hpath, substr(content, 1, 100), bm25(blocks_fts_case_insensitive) as score
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'search terms'
ORDER BY score LIMIT 20;

-- Case-sensitive search (use blocks_fts instead)
SELECT id, content FROM blocks_fts WHERE blocks_fts MATCH 'API';

-- Snippet: extract matching text with context (column 11 = content)
SELECT id, snippet(blocks_fts_case_insensitive, 11, '<mark>', '</mark>', '...', 32) as snippet
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'keyword' LIMIT 10;

-- Highlight: mark all matches in full content
SELECT id, highlight(blocks_fts_case_insensitive, 11, '[', ']') as highlighted
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'keyword';
```

---

## Notebook Queries

### List Notebooks

```sql
SELECT DISTINCT 
    box as notebook_id,
    COUNT(*) as block_count,
    SUM(CASE WHEN type = 'd' THEN 1 ELSE 0 END) as doc_count,
    MAX(updated) as last_updated
FROM blocks
GROUP BY box
ORDER BY last_updated DESC;
```

### Notebook Statistics

```sql
SELECT 
    box,
    type,
    COUNT(*) as count,
    SUM(length) as total_chars
FROM blocks
GROUP BY box, type
ORDER BY box, count DESC;
```

---

## Date/Time Queries

### Parse Timestamps

```sql
-- Format as readable date
SELECT 
    id,
    substr(created, 1, 4) || '-' ||
    substr(created, 5, 2) || '-' ||
    substr(created, 7, 2) as date_created
FROM blocks;

-- Full datetime
SELECT 
    id,
    substr(updated, 1, 4) || '-' ||
    substr(updated, 5, 2) || '-' ||
    substr(updated, 7, 2) || ' ' ||
    substr(updated, 9, 2) || ':' ||
    substr(updated, 11, 2) as datetime_updated
FROM blocks;
```

### Time-Based Filters

```sql
-- Today's changes (assuming YYYYMMDD format)
SELECT * FROM blocks WHERE updated >= '20260102000000';

-- This month
SELECT * FROM blocks WHERE updated LIKE '202601%';

-- Last 7 days worth of content
SELECT * FROM blocks WHERE substr(updated, 1, 8) >= '20251226';

-- Activity by month
SELECT 
    substr(created, 1, 6) as month,
    COUNT(*) as blocks_created,
    SUM(length) as chars_written
FROM blocks
GROUP BY substr(created, 1, 6)
ORDER BY month DESC;
```

---

## Window Functions

```sql
-- Numbering, ranking, running totals, lag/lead, percentiles
SELECT
    ROW_NUMBER() OVER (ORDER BY updated DESC) as row_num,          -- Sequential numbering
    ROW_NUMBER() OVER (PARTITION BY box ORDER BY length DESC) as rank_in_box,  -- Rank within group
    SUM(length) OVER (ORDER BY created) as running_total,          -- Cumulative sum
    LAG(updated) OVER (ORDER BY updated) as prev_update,           -- Previous row value
    LEAD(updated) OVER (ORDER BY updated) as next_update,          -- Next row value
    NTILE(4) OVER (ORDER BY length) as quartile                    -- Divide into N buckets
FROM blocks WHERE type = 'p' LIMIT 20;
```

---

## JSON Functions

```sql
-- Build JSON object from block data
SELECT json_object('id', id, 'type', type, 'len', length) as block_json
FROM blocks LIMIT 5;

-- Aggregate results as JSON array
SELECT json_group_array(json_object('type', type, 'count', cnt))
FROM (SELECT type, COUNT(*) as cnt FROM blocks GROUP BY type);

-- Extract from IAL (block attributes stored as JSON-like string)
SELECT id, json_extract(ial, '$.updated') as updated FROM blocks WHERE ial LIKE '%custom-%';
```

---

## String Functions & Pattern Matching

```sql
-- Common string functions
SELECT id,
    length(content) as len,              -- Character count
    substr(content, 1, 100) as preview,  -- Substring
    instr(content, 'key') as pos         -- Find position (0 if not found)
FROM blocks WHERE type = 'p' LIMIT 10;

-- Pattern matching: LIKE (case-insensitive), GLOB (case-sensitive), REGEXP
SELECT * FROM blocks WHERE content LIKE '%keyword%';                    -- Contains
SELECT * FROM blocks WHERE content GLOB '*[A-Z]*';                      -- Has uppercase
SELECT * FROM blocks WHERE content REGEXP '\d{4}-\d{2}-\d{2}';          -- Date pattern
```

---

## Aggregate Functions

```sql
-- Basic aggregates
SELECT 
    COUNT(*) as total,
    COUNT(DISTINCT type) as unique_types,
    SUM(length) as total_chars,
    AVG(length) as avg_length,
    MIN(length) as min_length,
    MAX(length) as max_length
FROM blocks;

-- Group concatenation
SELECT 
    type,
    GROUP_CONCAT(DISTINCT subtype) as subtypes
FROM blocks
GROUP BY type;

-- Total (like SUM but returns 0.0 for empty sets)
SELECT TOTAL(length) FROM blocks WHERE type = 'nonexistent';
```

---

## Subqueries

```sql
-- Blocks in documents with "research" in title (IN subquery)
SELECT * FROM blocks WHERE root_id IN (
    SELECT id FROM blocks WHERE type = 'd' AND hpath LIKE '%research%'
);

-- Documents that contain code blocks (EXISTS subquery)
SELECT * FROM blocks d WHERE type = 'd'
AND EXISTS (SELECT 1 FROM blocks c WHERE c.root_id = d.id AND c.type = 'c');

-- Derived table in FROM clause
SELECT type, avg_len FROM (SELECT type, AVG(length) as avg_len FROM blocks GROUP BY type) WHERE avg_len > 100;
```

---

## Set Operations

```sql
-- UNION: combine headings and long paragraphs (deduplicated; UNION ALL keeps dupes)
SELECT id, 'h' as src FROM blocks WHERE type = 'h'
UNION SELECT id, 'p' as src FROM blocks WHERE type = 'p' AND length > 500;

-- EXCEPT: paragraphs excluding short ones; INTERSECT: docs with both code and h1
SELECT id FROM blocks WHERE type = 'p' EXCEPT SELECT id FROM blocks WHERE length < 100;
```

---

## Hierarchy Traversal

### Child Documents (Subdocs)

```sql
-- Get all subdocuments of a document
SELECT id, hpath as title, updated FROM blocks
WHERE path LIKE '%/DOC_ID/%' AND type = 'd'
ORDER BY hpath;

-- Get direct child documents only (one level deep)
SELECT id, hpath as title, updated FROM blocks
WHERE path LIKE '/DOC_ID/%.sy'
AND path NOT LIKE '/DOC_ID/%/%.sy'
AND type = 'd';
```

### Parent-Child

```sql
-- Get immediate children
SELECT * FROM blocks WHERE parent_id = 'PARENT_BLOCK_ID';

-- Get parent
SELECT p.* FROM blocks p
JOIN blocks c ON c.parent_id = p.id
WHERE c.id = 'CHILD_BLOCK_ID';

-- Count children per block
SELECT 
    parent_id,
    COUNT(*) as child_count
FROM blocks
WHERE parent_id != ''
GROUP BY parent_id
ORDER BY child_count DESC;
```

### Document Structure

```sql
-- All blocks in document with depth indicator
SELECT 
    b.id,
    b.type,
    b.subtype,
    substr(b.content, 1, 50) as preview,
    (SELECT COUNT(*) FROM blocks p WHERE b.path LIKE p.path || '%' AND p.type = 'd') as depth_estimate
FROM blocks b
WHERE b.root_id = 'DOC_ID'
ORDER BY b.sort;
```

---

## Database Introspection

```sql
SELECT sqlite_version();                                    -- SQLite version
SELECT * FROM pragma_table_list;                            -- All tables
SELECT * FROM pragma_table_info('blocks');                  -- Column info
SELECT DISTINCT name FROM pragma_function_list ORDER BY name; -- Available functions
```

---

## References & Backlinks

### Find Backlinks to a Block

```sql
-- All blocks that reference a specific block
SELECT b.* FROM blocks b
WHERE b.id IN (
    SELECT block_id FROM refs WHERE def_block_id = 'TARGET_BLOCK_ID'
);

-- Backlinks with context
SELECT
    r.block_id as source_block,
    r.content as anchor_text,
    b.hpath as source_doc,
    b.type as source_type
FROM refs r
JOIN blocks b ON b.id = r.block_id
WHERE r.def_block_id = 'TARGET_BLOCK_ID';
```

### Unreferenced Documents (Orphans)

```sql
-- Documents that no one links to
SELECT id, hpath as title, updated FROM blocks
WHERE type = 'd'
AND id NOT IN (SELECT def_block_root_id FROM refs)
ORDER BY updated DESC;
```

### Most Referenced Blocks

```sql
SELECT
    def_block_id,
    COUNT(*) as ref_count,
    MAX(b.hpath) as in_doc
FROM refs r
JOIN blocks b ON b.id = r.def_block_id
GROUP BY def_block_id
ORDER BY ref_count DESC
LIMIT 20;
```

---

## Daily Notes

```sql
-- Daily notes use custom-dailynote-YYYYMMDD attribute
-- Recent daily notes
SELECT b.id, b.hpath as title, a.value as date, b.updated
FROM blocks b JOIN attributes a ON a.block_id = b.id
WHERE a.name LIKE 'custom-dailynote-%'
ORDER BY a.value DESC LIMIT 30;

-- Today's daily note (replace YYYYMMDD with actual date)
SELECT b.* FROM blocks b JOIN attributes a ON a.block_id = b.id
WHERE a.name = 'custom-dailynote-20260102' AND b.type = 'd';

-- Date range filter: a.value >= '20251201' AND a.value <= '20251231'
-- Month filter: a.name LIKE 'custom-dailynote-202512%'
```

---

## Task Lists

```sql
-- Task items: type='i' subtype='t', incomplete='[ ]', completed='[x]'
-- Incomplete tasks
SELECT id, root_id, substr(markdown, 1, 100) as task FROM blocks
WHERE type = 'i' AND subtype = 't' AND markdown LIKE '%[ ]%'
ORDER BY updated DESC;

-- Completed tasks (change [ ] to [x])
-- Add time filter: AND updated >= '20251226000000'
-- Join for doc path: JOIN blocks d ON d.id = b.root_id → d.hpath as document
```

---

## Random Selection

```sql
-- Random document
SELECT * FROM blocks WHERE type = 'd' ORDER BY random() LIMIT 1;

-- Random heading from a specific document
SELECT * FROM blocks
WHERE root_id = 'DOC_ID' AND type = 'h'
ORDER BY random() LIMIT 1;

-- Random paragraph with content
SELECT * FROM blocks
WHERE type = 'p' AND length > 100
ORDER BY random() LIMIT 1;
```

---

## Search Results Grouped by Document

```sql
-- Find documents with match count (LIKE version)
SELECT
    root_id,
    MAX(CASE WHEN type = 'd' THEN hpath END) as doc_title,
    COUNT(*) as match_count,
    MAX(updated) as last_updated
FROM blocks
WHERE (content || tag || name || alias || memo) LIKE '%keyword%'
GROUP BY root_id
ORDER BY match_count DESC, last_updated DESC
LIMIT 20;

-- Fast grouped search with FTS5
SELECT root_id, COUNT(*) as matches, MAX(hpath) as doc_path
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'keyword'
GROUP BY root_id
ORDER BY matches DESC LIMIT 20;
```

---

## Useful Patterns

### Content Analysis

```sql
-- Word frequency (approximate)
SELECT 
    substr(content, 1, instr(content || ' ', ' ') - 1) as first_word,
    COUNT(*) as frequency
FROM blocks
WHERE type = 'p' AND content != ''
GROUP BY first_word
ORDER BY frequency DESC
LIMIT 20;
```

### Document Summary

```sql
SELECT 
    d.id,
    d.hpath as title,
    (SELECT COUNT(*) FROM blocks WHERE root_id = d.id) as block_count,
    (SELECT SUM(length) FROM blocks WHERE root_id = d.id) as total_chars,
    (SELECT COUNT(*) FROM blocks WHERE root_id = d.id AND type = 'c') as code_blocks,
    d.created,
    d.updated
FROM blocks d
WHERE d.type = 'd'
ORDER BY d.updated DESC;
```

### Find Duplicates

```sql
SELECT content, COUNT(*) as occurrences
FROM blocks
WHERE type = 'p' AND length > 50
GROUP BY content
HAVING COUNT(*) > 1;
```

### Recent Activity Timeline

```sql
SELECT 
    substr(updated, 1, 8) as date,
    COUNT(*) as changes,
    COUNT(DISTINCT root_id) as docs_touched
FROM blocks
GROUP BY substr(updated, 1, 8)
ORDER BY date DESC
LIMIT 30;
```

---

## Available Functions Reference

### Core Functions
`abs`, `char`, `coalesce`, `glob`, `hex`, `ifnull`, `iif`, `instr`, `length`, `like`, `lower`, `ltrim`, `max`, `min`, `nullif`, `printf`, `quote`, `random`, `randomblob`, `replace`, `round`, `rtrim`, `sign`, `substr`, `substring`, `trim`, `typeof`, `unicode`, `unlikely`, `upper`, `zeroblob`

### Date/Time
`date`, `datetime`, `julianday`, `strftime`, `time`, `unixepoch`, `current_date`, `current_time`, `current_timestamp`

### Aggregate
`avg`, `count`, `group_concat`, `max`, `min`, `sum`, `total`

### Window
`cume_dist`, `dense_rank`, `first_value`, `lag`, `last_value`, `lead`, `nth_value`, `ntile`, `percent_rank`, `rank`, `row_number`

### JSON
`json`, `json_array`, `json_array_length`, `json_extract`, `json_group_array`, `json_group_object`, `json_insert`, `json_object`, `json_patch`, `json_quote`, `json_remove`, `json_replace`, `json_set`, `json_type`, `json_valid`, `->`, `->>`

### FTS5
`bm25`, `highlight`, `snippet`, `offsets`, `matchinfo`, `optimize`, `fts5`, `fts5_source_id`

### Other
`changes`, `last_insert_rowid`, `load_extension`, `total_changes`, `likelihood`, `likely`, `regexp`

---

## Advanced: CTE Pattern for Grouped Search

The following CTE-based query searches content and groups results by document, with pagination support. This is a powerful pattern for building search interfaces.

```sql
WITH document_id_temp AS (
  SELECT root_id,
    MAX(CASE WHEN type = 'd' THEN (content || tag || name || alias || memo) END) documentContent
  FROM blocks
  WHERE type IN ('d', 'h', 'c', 'm', 't', 'p', 'html', 'av')
  GROUP BY root_id
  HAVING GROUP_CONCAT((content || tag || name || alias || memo)) LIKE '%关键词%'
  ORDER BY (documentContent LIKE '%关键词%') DESC, MAX(updated) DESC
)
SELECT *,
  (content || tag || name || alias || memo) AS concatContent,
  (SELECT COUNT(1) FROM document_id_temp) as documentCount
FROM blocks
WHERE type IN ('d', 'h', 'c', 'm', 't', 'p', 'html', 'av')
AND (
  id IN (SELECT root_id FROM document_id_temp LIMIT 10 OFFSET 0)
  OR (
    root_id IN (SELECT root_id FROM document_id_temp LIMIT 10 OFFSET 0)
    AND (concatContent LIKE '%关键词%')
  )
)
ORDER BY sort ASC, (concatContent LIKE '%关键词%') DESC, updated DESC
LIMIT 2048;
```

**How it works:**
1. CTE finds matching documents ordered by relevance (title match first, then by update time)
2. Main query returns document blocks + matching content blocks within those documents
3. `documentCount` provides total matching documents for pagination
4. `LIMIT 10 OFFSET 0` controls page size and position

**Tip:** Replace `关键词` with your search term. Adjust `LIMIT 10 OFFSET 0` for pagination.

---

## Known Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| CTEs (`WITH` clause) | ✅ Supported | Use for complex grouped queries |
| Write operations | ❌ No persist | Execute but don't save |
| Temp tables | ❌ Not visible | Created but can't query |
| FTS shadow tables | ❌ Error | "id format incorrect" |
| `VALUES` clause | ❌ Syntax error | Use subqueries instead |
| `generate_series` | ❌ Not available | — |
| Multiple statements | ⚠️ Partial | Only first SELECT returned |

---

## Tips

1. **Use FTS for text search** — Much faster than `LIKE '%term%'`
2. **Index columns are fast** — `id`, `parent_id`, `root_id` have indexes
3. **Limit large results** — Always use `LIMIT` for exploratory queries
4. **Use case-insensitive FTS** — `blocks_fts_case_insensitive` for user searches
5. **Parse timestamps with substr** — No native date parsing for SiYuan format
