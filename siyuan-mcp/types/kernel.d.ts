/**
 * SiYuan Kernel Type Definitions
 * Derived from kernel source code in siyuan-note/siyuan
 *
 * Copyright (c) 2023 frostime. All rights reserved.
 * Updated with strict types from kernel Go structs.
 */

// ============================================================================
// ID Types
// ============================================================================

type DocumentId = string;
type BlockId = string;
type NotebookId = string;
type PreviousID = BlockId;
type ParentID = BlockId | DocumentId;

// ============================================================================
// Block Types (from kernel/sql/block.go)
// ============================================================================

/**
 * Block type abbreviations used in SQL database.
 * Source: kernel/treenode/node.go TypeAbbr()
 */
type BlockType =
  | 'd'      // Document
  | 's'      // Super Block
  | 'h'      // Heading
  | 't'      // Table (HTML table)
  | 'i'      // List Item
  | 'p'      // Paragraph
  | 'f'      // Math Block (formula)
  | 'l'      // List
  | 'c'      // Code Block
  | 'm'      // Math Block (inline)
  | 'tb'     // Table Block
  | 'b'      // Blockquote
  | 'html'   // HTML Block
  | 'av'     // Attribute View (Database)
  | 'audio'  // Audio
  | 'video'  // Video
  | 'iframe' // IFrame
  | 'widget' // Widget
  | 'query_embed'; // Query Embed

/**
 * Block subtype abbreviations.
 * Source: kernel/treenode/node.go SubTypeAbbr()
 */
type BlockSubType =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'  // Heading levels
  | 'o' | 'u' | 't'  // Ordered/Unordered/Task list
  | '';  // No subtype

/**
 * Block from SQL database query (snake_case field names).
 * Source: kernel/sql/block.go Block struct
 */
type Block = {
  id: BlockId;
  parent_id: BlockId;
  root_id: DocumentId;
  hash: string;
  box: NotebookId;
  path: string;
  hpath: string;
  name: string;
  alias: string;
  memo: string;
  tag: string;
  content: string;
  fcontent: string;
  markdown: string;
  length: number;
  type: BlockType;
  subtype: BlockSubType;
  ial: string;  // IAL as string in SQL, parsed as object in API
  sort: number;
  created: string;  // Format: YYYYMMDDHHmmss
  updated: string;  // Format: YYYYMMDDHHmmss
};

// ============================================================================
// Notebook Types (from kernel/model/box.go and kernel/conf/box.go)
// ============================================================================

/**
 * Notebook (Box) from lsNotebooks API.
 * Source: kernel/model/box.go Box struct
 */
type Notebook = {
  id: NotebookId;
  name: string;
  icon: string;
  sort: number;
  sortMode: number;
  closed: boolean;
  newFlashcardCount: number;
  dueFlashcardCount: number;
  flashcardCount: number;
};

/**
 * Notebook configuration.
 * Source: kernel/conf/box.go BoxConf struct
 */
type NotebookConf = {
  name: string;
  sort: number;
  icon: string;
  closed: boolean;
  refCreateSaveBox: string;
  refCreateSavePath: string;
  docCreateSaveBox: string;
  docCreateSavePath: string;
  dailyNoteSavePath: string;
  dailyNoteTemplatePath: string;
  sortMode: number;
};

/**
 * Response from getNotebookConf API.
 */
type NotebookConfResponse = {
  box: NotebookId;
  conf: NotebookConf;
  name: string;
};

/**
 * Notebook info/statistics from getNotebookInfo API.
 * Source: kernel/model/box.go BoxInfo struct
 */
type BoxInfo = {
  id: NotebookId;
  name: string;
  docCount: number;
  size: number;
  hSize: string;
  mtime: number;
  cTime: number;
  hMtime: string;
  hCtime: string;
};

// ============================================================================
// Transaction Types (from kernel/model/transaction.go)
// ============================================================================

/**
 * Operation within a transaction.
 * Source: kernel/model/transaction.go Operation struct (lines 1805-1836)
 */
type Operation = {
  action: string;
  data: unknown;
  id: BlockId;
  parentID: BlockId;
  previousID: BlockId;
  nextID: BlockId;
  retData: unknown;
  blockIDs: BlockId[];
  blockID: BlockId;
  deckID: string;
  avID: string;
  srcIDs: string[];
  srcs: Array<Record<string, unknown>>;
  isDetached: boolean;
  name: string;
  type: string;
  format: string;
  keyID: string;
};

/**
 * Transaction containing operations.
 * Source: kernel/model/transaction.go Transaction struct (lines 1839-1855)
 */
type Transaction = {
  timestamp: number;
  doOperations: Operation[];
  undoOperations: Operation[];
};

/**
 * Simplified block operation result from insert/update/delete APIs.
 * This is what doOperations[0] typically contains for block operations.
 */
type BlockOperation = {
  id: BlockId;
  action: string;
  data: string;
  parentID?: BlockId;
  previousID?: BlockId;
  nextID?: BlockId;
  retData?: unknown;
};

// ============================================================================
// Block Info Types (from kernel/model/blockinfo.go)
// ============================================================================

/**
 * Attribute view reference.
 * Source: kernel/model/blockinfo.go AttrView struct
 */
type AttrView = {
  id: string;
  name: string;
};

/**
 * Document info from getDocInfo API.
 * Source: kernel/model/blockinfo.go BlockInfo struct
 */
type DocInfo = {
  id: DocumentId;
  rootID: DocumentId;
  name: string;
  refCount: number;
  subFileCount: number;
  refIDs: string[];
  ial: Record<string, string>;
  icon: string;
  attrViews: AttrView[];
};

// ============================================================================
// Statistics Types (from kernel/util/websocket.go)
// ============================================================================

/**
 * Tree/block statistics.
 * Source: kernel/util/websocket.go BlockStatResult struct
 */
type TreeStat = {
  runeCount: number;
  wordCount: number;
  linkCount: number;
  imageCount: number;
  refCount: number;
  blockCount: number;
};

// ============================================================================
// File Types (from kernel/model/file.go)
// ============================================================================

/**
 * File/document in file tree.
 * Source: kernel/model/file.go File struct
 */
type IFile = {
  path: string;
  name: string;       // Document title (ial["title"])
  icon: string;
  name1: string;      // Document name attribute (ial["name"])
  alias: string;
  memo: string;
  bookmark: string;
  id: DocumentId;
  count: number;
  size: number;
  hSize: string;
  mtime: number;
  ctime: number;
  hMtime: string;
  hCtime: string;
  sort: number;
  subFileCount: number;
  hidden: boolean;
  newFlashcardCount: number;
  dueFlashcardCount: number;
  flashcardCount: number;
};

// ============================================================================
// Outline Types (from kernel/model/outline.go and block.go)
// ============================================================================

/**
 * Outline item for document TOC.
 * Uses Block structure with children for hierarchy.
 * Source: kernel/model/block.go Block struct (API version)
 */
type OutlineBlock = {
  id: BlockId;
  rootID: DocumentId;
  box: NotebookId;
  path: string;
  content: string;
  type: string;
  subType: string;
  depth: number;
  count: number;
  folded: boolean;
  children: OutlineBlock[];
};

/**
 * Outline path entry.
 * Source: kernel/model/block.go Path struct
 * Note: blocks and children have omitempty in kernel
 */
type OutlinePath = {
  id: BlockId;
  box: NotebookId;
  name: string;
  hPath: string;
  type: string;
  nodeType: string;
  subType: string;
  blocks?: OutlineBlock[];
  children?: OutlinePath[];
  depth: number;
  count: number;
  folded: boolean;
  updated: string;
  created: string;
};

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Standard SiYuan API response wrapper.
 */
type APIResponse<T = unknown> = {
  code: number;
  msg: string;
  data: T;
};

/**
 * Block attributes (IAL - Inline Attribute List).
 */
type BlockAttrs = Record<string, string>;

/**
 * Child block info from getChildBlocks API.
 * Source: kernel/model/block.go ChildBlock struct
 */
type ChildBlock = {
  id: BlockId;
  type: string;
  subType?: string;
  content?: string;
  markdown?: string;
};

/**
 * Backlink item (Path struct) from getBacklink2 API.
 * Source: kernel/model/block.go Path struct
 */
type BacklinkPath = {
  id: BlockId;
  box: NotebookId;
  name: string;
  hPath: string;
  type: string;
  nodeType: string;
  subType: string;
  blocks?: OutlineBlock[];
  children?: BacklinkPath[];
  depth: number;
  count: number;
  folded: boolean;
  updated: string;
  created: string;
};

/**
 * Backlink result from getBacklink2 API.
 */
type BacklinkResult = {
  boxID: NotebookId;
  backlinks: BacklinkPath[];
  backmentions: BacklinkPath[];
  linkRefsCount: number;
  mentionsCount: number;
};

/**
 * Flashcard deck.
 */
type RiffDeck = {
  id: string;
  name: string;
  size: number;
  created: string;
  updated: string;
};

/**
 * Search result block.
 */
type SearchBlock = {
  id: BlockId;
  rootID: DocumentId;
  box: NotebookId;
  path: string;
  hPath: string;
  content: string;
  fcontent: string;
  ial: Record<string, string>;
  type: string;
  subType: string;
};

/**
 * Full text search result.
 */
type FullTextSearchResult = {
  blocks: SearchBlock[];
  matchedBlockCount: number;
  matchedRootCount: number;
  pageCount: number;
};

/**
 * Asset in database.
 * Source: kernel/sql/asset.go
 */
type AssetDBItem = {
  id: string;
  block_id: BlockId;
  root_id: DocumentId;
  box: NotebookId;
  docpath: string;
  path: string;
  name: string;
  title: string;
  hash: string;
};

/**
 * Upload result from asset upload API.
 */
type UploadResult = {
  succMap: Record<string, string>;
  errFiles: string[];
};

/**
 * Directory entry from readDir API.
 */
type DirEntry = {
  isDir: boolean;
  isSymlink: boolean;
  name: string;
  updated: number;
};

/**
 * Export markdown content result.
 */
type ExportMdResult = {
  hPath: string;
  content: string;
};

// ============================================================================
// Kramdown Types
// ============================================================================

/**
 * Result from getBlockKramdown API.
 */
type KramdownResult = {
  id: BlockId;
  kramdown: string;
};

// ============================================================================
// Document Tree Types
// ============================================================================

/**
 * Document tree node from listDocTree API.
 */
type DocTreeNode = {
  id: DocumentId;
  box: NotebookId;
  path: string;
  hPath: string;
  name: string;
  icon: string;
  children: DocTreeNode[];
};

// ============================================================================
// Search Filter Types (from kernel/model/search.go)
// ============================================================================

/**
 * Block type filter for search queries.
 * Source: kernel/model/search.go TypeFilter struct
 */
type BlockTypeFilter = {
  audioBlock: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  databaseBlock: boolean;
  document: boolean;
  embedBlock: boolean;
  heading: boolean;
  htmlBlock: boolean;
  iframeBlock: boolean;
  list: boolean;
  listItem: boolean;
  mathBlock: boolean;
  paragraph: boolean;
  superBlock: boolean;
  table: boolean;
  videoBlock: boolean;
  widgetBlock: boolean;
};

/**
 * Full-text search query parameters.
 * Source: kernel/model/search.go fullTextSearchBlock params
 */
type FullTextSearchQuery = {
  query: string;
  method?: number;
  types?: BlockTypeFilter;
  paths?: string[];
  groupBy?: number;
  orderBy?: number;
  page?: number;
  reqId?: number;
  pageSize?: number;
};
