# SiYuan Database Schema Reference

> SQLite 3.38.0 | FTS5 Full-Text Search | Custom "siyuan" Tokenizer

## Overview

SiYuan uses SQLite as its backend database for storing notes, blocks, and metadata. The database supports full-text search via FTS5 virtual tables with a custom tokenizer optimized for note-taking.

**Database Location**: `<workspace>/temp/siyuan.db`

---

## Core Tables

### `blocks` — Main Content Table

The primary table storing all content blocks (paragraphs, headings, lists, code, etc.).

```sql
CREATE TABLE blocks (
    id          TEXT,    -- Block ID: YYYYMMDDHHmmss-7chars (e.g., "20250327231901-03xpxmd")
    parent_id   TEXT,    -- Parent block ID (for hierarchy)
    root_id     TEXT,    -- Document root block ID
    hash        TEXT,    -- Content hash for change detection
    box         TEXT,    -- Notebook ID
    path        TEXT,    -- File path within notebook (e.g., "/20250327231901-03xpxmd.sy")
    hpath       TEXT,    -- Human-readable path (e.g., "/Document Title")
    name        TEXT,    -- Block name (for named blocks)
    alias       TEXT,    -- Block aliases
    memo        TEXT,    -- Block memo/notes
    tag         TEXT,    -- Tags associated with block
    content     TEXT,    -- Plain text content (searchable)
    fcontent    TEXT,    -- Full content including children
    markdown    TEXT,    -- Original markdown source
    length      INTEGER, -- Content length in characters
    type        TEXT,    -- Block type code (see Block Types)
    subtype     TEXT,    -- Block subtype (see Subtypes)
    ial         TEXT,    -- Inline Attribute List (JSON-like metadata)
    sort        INTEGER, -- Sort order within parent
    created     TEXT,    -- Creation timestamp: YYYYMMDDHHmmss
    updated     TEXT     -- Last update timestamp: YYYYMMDDHHmmss
);

-- Indexes
CREATE INDEX idx_blocks_id ON blocks(id);
CREATE INDEX idx_blocks_parent_id ON blocks(parent_id);
CREATE INDEX idx_blocks_root_id ON blocks(root_id);
```

#### Block Types

| Type | Name | Subtype | Description |
|------|------|---------|-------------|
| `d` | Document | — | Root document block |
| `p` | Paragraph | — | Text paragraph |
| `h` | Heading | `h1`-`h6` | Heading levels 1-6 |
| `l` | List | `o`, `u`, `t` | List container (ordered/unordered/task) |
| `i` | List Item | `o`, `u`, `t` | Individual list item |
| `c` | Code Block | — | Fenced code block |
| `m` | Math Block | — | LaTeX math formula block |
| `t` | Table | — | Table container |
| `tb` | Thematic Break | — | Horizontal rule / divider |
| `b` | Blockquote | — | Quote block |
| `s` | Super Block | — | Layout container |
| `html` | HTML Block | — | Raw HTML content |
| `audio` | Audio | — | Audio player block |
| `video` | Video | — | Video player block |
| `iframe` | IFrame | — | Embedded iframe content |
| `widget` | Widget | — | Widget/plugin block |
| `query_embed` | Query Embed | — | Embedded query results |
| `av` | Attribute View | — | Database/attribute table view |

#### Block Subtypes

| Subtype | Parent Type | Description |
|---------|-------------|-------------|
| `h1`-`h6` | `h` | Heading levels 1-6 |
| `o` | `l`, `i` | Ordered list/item |
| `u` | `l`, `i` | Unordered list/item |
| `t` | `l`, `i` | Task list/item |

#### IAL (Inline Attribute List) Format

The `ial` field stores block metadata in a custom format:

```
{: id="20250327231901-03xpxmd" title="Document Title" type="doc" updated="20250401120000" custom-attr="value"}
```

Common IAL attributes:
- `id` — Block ID
- `title` — Document/block title  
- `type` — Block type
- `updated` — Last modification time
- `custom-*` — User-defined attributes

---

### `refs` — Block References

Stores references (links) between blocks.

```sql
CREATE TABLE refs (
    id                  TEXT,    -- Reference ID
    def_block_id        TEXT,    -- Target (definition) block ID
    def_block_parent_id TEXT,    -- Target's parent block ID
    def_block_root_id   TEXT,    -- Target's document ID
    def_block_path      TEXT,    -- Target's file path
    block_id            TEXT,    -- Source block ID (where ref appears)
    root_id             TEXT,    -- Source document ID
    box                 TEXT,    -- Notebook ID
    path                TEXT,    -- Source file path
    content             TEXT,    -- Reference anchor text
    markdown            TEXT,    -- Reference markdown
    type                TEXT     -- Reference type
);
```

Reference syntax in content: `((block-id "anchor text"))`

---

### `attributes` — Custom Block Attributes

Stores custom attributes set on blocks.

```sql
CREATE TABLE attributes (
    id        TEXT,    -- Attribute record ID
    name      TEXT,    -- Attribute name (e.g., "custom-priority")
    value     TEXT,    -- Attribute value
    type      TEXT,    -- Attribute type
    block_id  TEXT,    -- Associated block ID
    root_id   TEXT,    -- Document ID
    box       TEXT,    -- Notebook ID
    path      TEXT     -- File path
);

CREATE INDEX idx_attributes_block_id ON attributes(block_id);
CREATE INDEX idx_attributes_root_id ON attributes(root_id);
```

---

### `assets` — Embedded Assets

Tracks assets (images, files) embedded in documents.

```sql
CREATE TABLE assets (
    id        TEXT,    -- Asset ID
    block_id  TEXT,    -- Block containing the asset
    root_id   TEXT,    -- Document ID
    box       TEXT,    -- Notebook ID
    docpath   TEXT,    -- Document path
    path      TEXT,    -- Asset file path
    name      TEXT,    -- Asset filename
    title     TEXT,    -- Asset title/alt text
    hash      TEXT     -- File hash
);

CREATE INDEX idx_assets_root_id ON assets(root_id);
```

---

### `spans` — Inline Formatting Spans

Stores inline formatted text spans (bold, italic, links, etc.).

```sql
CREATE TABLE spans (
    id        TEXT,    -- Span ID
    block_id  TEXT,    -- Parent block ID
    root_id   TEXT,    -- Document ID
    box       TEXT,    -- Notebook ID
    path      TEXT,    -- File path
    content   TEXT,    -- Span text content
    markdown  TEXT,    -- Span markdown
    type      TEXT,    -- Span type (e.g., "textmark")
    ial       TEXT     -- Span attributes
);

CREATE INDEX idx_spans_root_id ON spans(root_id);
```

---

### `file_annotation_refs` — PDF Annotations

Links PDF annotations to blocks.

```sql
CREATE TABLE file_annotation_refs (
    id            TEXT,    -- Reference ID
    file_path     TEXT,    -- PDF file path
    annotation_id TEXT,    -- Annotation ID within PDF
    block_id      TEXT,    -- Associated block ID
    root_id       TEXT,    -- Document ID
    box           TEXT,    -- Notebook ID
    path          TEXT,    -- Document path
    content       TEXT,    -- Annotation content
    type          TEXT     -- Annotation type
);
```

---

### `stat` — Database Statistics

Key-value store for database metadata.

```sql
CREATE TABLE stat (
    key   TEXT,    -- Statistic name
    value TEXT     -- Statistic value
);
```

---

## Full-Text Search Tables

### `blocks_fts` — Case-Sensitive FTS5 Index

```sql
CREATE VIRTUAL TABLE blocks_fts USING fts5(
    id          UNINDEXED,  -- Not searchable
    parent_id   UNINDEXED,
    root_id     UNINDEXED,
    hash        UNINDEXED,
    box         UNINDEXED,
    path        UNINDEXED,
    hpath,                   -- Searchable: human path
    name,                    -- Searchable: block name
    alias,                   -- Searchable: aliases
    memo,                    -- Searchable: memos
    tag,                     -- Searchable: tags
    content,                 -- Searchable: main content
    fcontent,                -- Searchable: full content
    markdown    UNINDEXED,
    length      UNINDEXED,
    type        UNINDEXED,
    subtype     UNINDEXED,
    ial,                     -- Searchable: attributes
    sort        UNINDEXED,
    created     UNINDEXED,
    updated     UNINDEXED,
    tokenize="siyuan"        -- Custom tokenizer
);
```

### `blocks_fts_case_insensitive` — Case-Insensitive FTS5 Index

Identical structure with `tokenize="siyuan case_insensitive"`.

### FTS5 Shadow Tables

Each FTS5 virtual table creates internal shadow tables:

| Table | Purpose |
|-------|---------|
| `*_data` | Stores FTS index data as BLOBs |
| `*_idx` | Term index with segment/page references |
| `*_content` | Original content (columns c0-c20) |
| `*_docsize` | Document size statistics |
| `*_config` | FTS configuration (version, etc.) |

---

## ID Format

SiYuan uses a consistent ID format across all entities:

```
YYYYMMDDHHmmss-xxxxxxx
│              │
│              └── 7-character random suffix
└── 14-digit timestamp (creation time)
```

Examples:
- Block: `20250327231901-03xpxmd`
- Notebook: `20250324183604-yhr5qrs`

---

## Timestamp Format

All timestamps use the format `YYYYMMDDHHmmss` (14 digits):

```sql
-- Parse to readable date
SELECT 
    substr(created, 1, 4) || '-' ||
    substr(created, 5, 2) || '-' ||
    substr(created, 7, 2) || ' ' ||
    substr(created, 9, 2) || ':' ||
    substr(created, 11, 2) || ':' ||
    substr(created, 13, 2) as created_date
FROM blocks;
```

---

## Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                         NOTEBOOK (box)                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    DOCUMENT (type='d')                  │ │
│  │  id = root_id for all child blocks                     │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  BLOCKS (p, h, l, i, c, t, b, s, html)           │  │ │
│  │  │  parent_id → parent block                        │  │ │
│  │  │  root_id → document                              │  │ │
│  │  │  ┌────────────────────────────────────────────┐  │  │ │
│  │  │  │  SPANS (inline formatting)                 │  │  │ │
│  │  │  │  block_id → containing block              │  │  │ │
│  │  │  └────────────────────────────────────────────┘  │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  REFS (block references)                         │  │ │
│  │  │  block_id → source, def_block_id → target       │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  ATTRIBUTES (custom block attributes)            │  │ │
│  │  │  block_id → associated block                    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  ASSETS (embedded files)                         │  │ │
│  │  │  block_id → containing block                    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Query Hints

### Default LIMIT

All SQL queries without an explicit `LIMIT` will have `LIMIT 64` applied by SiYuan's query engine.

### Block Hierarchy

Blocks are organized in a hierarchy:

- **Content Blocks (Leaf)**: Contain actual content — `p`, `h`, `c`, `m`, `t`, etc.
  - `content` and `markdown` fields contain the block's own content
- **Container Blocks**: Contain other blocks — `l` (list), `i` (list item), `b` (quote), `s` (super block)
  - `content` and `markdown` fields contain all nested content
  - `parent_id` points to the immediate parent container
- **Document Block**: Contains all blocks in a document — `d`
  - `content` field contains the document title
  - All blocks have `root_id` pointing to their document

### Special Attributes

**Daily Note**: Documents that are daily notes have a special attribute:
```
custom-dailynote-YYYYMMDD=YYYYMMDD
```
Example: `custom-dailynote-20240101=20240101` marks a document as the daily note for Jan 1, 2024.

**Bookmarks**: Blocks with `bookmark=<name>` attribute are added to the named bookmark.

**Task Lists**: Task list items have markdown format:
- Incomplete: `* [ ] Task text`
- Complete: `* [x] Task text`

### Backlinks

To find all blocks that reference a specific block:
```sql
SELECT * FROM blocks WHERE id IN (
    SELECT block_id FROM refs WHERE def_block_id = '<target_block_id>'
)
```

---

## Notes

1. **Read-Only Access**: The MCP API provides read-only SQL access; write operations don't persist.

2. **No CTEs**: `WITH` clauses are blocked at the API level.

3. **No Direct Shadow Table Access**: Querying FTS shadow tables directly returns errors.

4. **Custom Tokenizer**: The "siyuan" tokenizer is optimized for mixed CJK/Latin text.

5. **User-Defined Attributes**: Custom attributes must have `custom-` prefix (e.g., `custom-priority`).
