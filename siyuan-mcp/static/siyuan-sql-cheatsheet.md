# SiYuan SQL Cheatsheet

> Quick reference for querying SiYuan's SQLite database via the MCP API

---

## Quick Reference

### Essential Queries

```sql
-- All documents
SELECT id, hpath as title, updated FROM blocks WHERE type = 'd' ORDER BY updated DESC;

-- Search content (simple)
SELECT id, type, substr(content, 1, 100) FROM blocks WHERE content LIKE '%keyword%';

-- Full-text search (fast)
SELECT id, content, bm25(blocks_fts_case_insensitive) as score
FROM blocks_fts_case_insensitive 
WHERE blocks_fts_case_insensitive MATCH 'search terms'
ORDER BY score LIMIT 20;

-- Block hierarchy (children of a block)
SELECT * FROM blocks WHERE parent_id = 'BLOCK_ID';

-- Document content (all blocks in a doc)
SELECT * FROM blocks WHERE root_id = 'DOC_ID' ORDER BY sort;
```

---

## Block Type Queries

### By Type

```sql
-- All paragraphs
SELECT * FROM blocks WHERE type = 'p';

-- All headings (h1, h2, h3)
SELECT * FROM blocks WHERE type = 'h';
SELECT * FROM blocks WHERE type = 'h' AND subtype = 'h1';  -- Just h1

-- All code blocks
SELECT * FROM blocks WHERE type = 'c';

-- All list items
SELECT * FROM blocks WHERE type = 'i';

-- Ordered vs unordered lists
SELECT * FROM blocks WHERE type = 'l' AND subtype = 'o';  -- Ordered
SELECT * FROM blocks WHERE type = 'l' AND subtype = 'u';  -- Unordered
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

### Basic Search

```sql
-- Simple match (case-insensitive)
SELECT id, content, bm25(blocks_fts_case_insensitive) as relevance
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'neural network'
ORDER BY relevance;

-- Case-sensitive search
SELECT id, content FROM blocks_fts
WHERE blocks_fts MATCH 'API';
```

### Advanced FTS5 Syntax

```sql
-- AND (implicit)
... MATCH 'machine learning'       -- Both words required

-- OR
... MATCH 'neural OR network'      -- Either word

-- NOT
... MATCH 'python NOT javascript'  -- Exclude term

-- Phrase (exact)
... MATCH '"machine learning"'     -- Exact phrase

-- Prefix
... MATCH 'neuro*'                 -- Words starting with neuro

-- Column-specific
... MATCH 'content:training'       -- Search only content column
... MATCH 'tag:research'           -- Search only tags

-- Complex boolean
... MATCH '(neural OR deep) AND (learning OR training) NOT pytorch'
```

### FTS5 Functions

```sql
-- Highlighted snippets
SELECT 
    id,
    snippet(blocks_fts_case_insensitive, 11, '<mark>', '</mark>', '...', 32) as snippet
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'training'
LIMIT 10;

-- BM25 relevance ranking
SELECT id, content, bm25(blocks_fts_case_insensitive) as score
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'model'
ORDER BY score;  -- Lower = more relevant

-- Highlight matches
SELECT 
    highlight(blocks_fts_case_insensitive, 11, '[', ']') as highlighted_content
FROM blocks_fts_case_insensitive
WHERE blocks_fts_case_insensitive MATCH 'loss';
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

### Row Numbering

```sql
SELECT 
    ROW_NUMBER() OVER (ORDER BY updated DESC) as row_num,
    id, type, substr(content, 1, 50)
FROM blocks
LIMIT 20;
```

### Ranking Within Groups

```sql
SELECT 
    box,
    id,
    length,
    ROW_NUMBER() OVER (PARTITION BY box ORDER BY length DESC) as rank_in_notebook
FROM blocks
WHERE type = 'p';
```

### Running Totals

```sql
SELECT 
    id,
    length,
    SUM(length) OVER (ORDER BY created) as running_total
FROM blocks
WHERE type = 'd';
```

### Lag/Lead (Previous/Next Values)

```sql
SELECT 
    id,
    updated,
    LAG(updated) OVER (ORDER BY updated) as prev_update,
    LEAD(updated) OVER (ORDER BY updated) as next_update
FROM blocks
WHERE type = 'd';
```

### Percentiles

```sql
SELECT 
    id,
    length,
    NTILE(4) OVER (ORDER BY length) as quartile,
    PERCENT_RANK() OVER (ORDER BY length) as percentile
FROM blocks
WHERE type = 'p' AND length > 0;
```

---

## JSON Functions

### Create JSON

```sql
SELECT json_object(
    'id', id,
    'type', type,
    'length', length
) as block_json
FROM blocks
LIMIT 5;
```

### Aggregate to JSON Array

```sql
SELECT json_group_array(
    json_object('type', type, 'count', cnt)
) as type_distribution
FROM (
    SELECT type, COUNT(*) as cnt 
    FROM blocks 
    GROUP BY type
);
```

### Parse JSON (if stored)

```sql
SELECT 
    json_extract('{"name":"test","value":123}', '$.name') as name,
    json_extract('{"name":"test","value":123}', '$.value') as value;
```

### JSON Tree Traversal

```sql
SELECT * FROM json_tree('{"a":{"b":1},"c":[1,2,3]}');
```

---

## String Functions

### Common Operations

```sql
-- Length
SELECT id, length(content) as char_count FROM blocks;

-- Substring
SELECT substr(content, 1, 100) as preview FROM blocks;

-- Find position
SELECT instr(content, 'keyword') as position FROM blocks;

-- Replace
SELECT replace(content, 'old', 'new') FROM blocks;

-- Case conversion
SELECT upper(type), lower(content) FROM blocks;

-- Trim whitespace
SELECT trim(content), ltrim(content), rtrim(content) FROM blocks;
```

### Pattern Matching

```sql
-- LIKE (simple patterns)
SELECT * FROM blocks WHERE content LIKE '%neural%';      -- Contains
SELECT * FROM blocks WHERE content LIKE 'The%';          -- Starts with
SELECT * FROM blocks WHERE content LIKE '%ing';          -- Ends with
SELECT * FROM blocks WHERE content LIKE '_est';          -- Single char wildcard

-- GLOB (case-sensitive, Unix-style)
SELECT * FROM blocks WHERE content GLOB '*Neural*';     -- Case-sensitive
SELECT * FROM blocks WHERE content GLOB '[A-Z]*';       -- Starts with uppercase

-- REGEXP (if available)
SELECT * FROM blocks WHERE content REGEXP '\d{4}-\d{2}-\d{2}';  -- Date pattern
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

### In WHERE Clause

```sql
-- Blocks in documents with "research" in title
SELECT * FROM blocks
WHERE root_id IN (
    SELECT id FROM blocks 
    WHERE type = 'd' AND hpath LIKE '%research%'
);

-- Largest blocks per type
SELECT * FROM blocks b1
WHERE length = (
    SELECT MAX(length) FROM blocks b2 WHERE b2.type = b1.type
);
```

### In FROM Clause (Derived Tables)

```sql
SELECT type, avg_len
FROM (
    SELECT type, AVG(length) as avg_len
    FROM blocks
    GROUP BY type
) subq
WHERE avg_len > 100;
```

### EXISTS

```sql
-- Documents that have code blocks
SELECT * FROM blocks d
WHERE type = 'd'
AND EXISTS (
    SELECT 1 FROM blocks c 
    WHERE c.root_id = d.id AND c.type = 'c'
);
```

---

## Set Operations

```sql
-- UNION (combine, deduplicate)
SELECT id, 'heading' as source FROM blocks WHERE type = 'h'
UNION
SELECT id, 'paragraph' as source FROM blocks WHERE type = 'p' AND length > 500;

-- UNION ALL (combine, keep duplicates)
SELECT id FROM blocks WHERE type = 'h'
UNION ALL
SELECT id FROM blocks WHERE type = 'p';

-- EXCEPT (difference)
SELECT id FROM blocks WHERE type = 'p'
EXCEPT
SELECT id FROM blocks WHERE length < 100;

-- INTERSECT (common)
SELECT root_id FROM blocks WHERE type = 'c'
INTERSECT
SELECT root_id FROM blocks WHERE type = 'h' AND subtype = 'h1';
```

---

## Hierarchy Traversal

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

## Pragmas (Database Introspection)

```sql
-- Database info
SELECT * FROM pragma_database_list;
SELECT * FROM pragma_page_count;
SELECT * FROM pragma_freelist_count;

-- Table info
SELECT * FROM pragma_table_list;
SELECT * FROM pragma_table_info('blocks');

-- Index info
SELECT * FROM pragma_index_list('blocks');

-- All functions
SELECT DISTINCT name FROM pragma_function_list ORDER BY name;

-- All modules
SELECT * FROM pragma_module_list;

-- SQLite version
SELECT sqlite_version();
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

## Known Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| CTEs (`WITH` clause) | ❌ Blocked | API returns "Not a SELECT statement" |
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
