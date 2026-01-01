/**
 * Internationalization utility
 * Simplified version - returns English strings
 */

const translations: Record<string, string> = {
  // Tool descriptions
  tool_append_dailynote: 'Append markdown content to the daily note of a specified notebook.',
  tool_get_current_time: 'Get current time information',

  // Tool titles
  tool_title_append_block: 'Append Block',
  tool_title_append_markdown_to_doc: 'Append Markdown to Document',
  tool_title_append_to_dailynote: 'Append to Daily Note',
  tool_title_create_new_note_with_markdown_content: 'Create New Note with Markdown',
  tool_title_database_schema: 'Database Schema',
  tool_title_generate_answer_with_doc: 'Generate Answer with Documents (RAG)',
  tool_title_get_block_attributes: 'Get Block Attributes',
  tool_title_get_block_kramdown: 'Get Block Kramdown',
  tool_title_get_current_time: 'Get Current Time',
  tool_title_insert_block: 'Insert Block',
  tool_title_list_notebook: 'List Notebooks',
  tool_title_prepend_block: 'Prepend Block',
  tool_title_query_sql: 'Query SQL',
  tool_title_query_syntax: 'Query Syntax',
  tool_title_read_doc_content_markdown: 'Read Document Content (Markdown)',
  tool_title_search: 'Search',
  tool_title_set_block_attributes: 'Set Block Attributes',
  tool_title_update_block: 'Update Block',

  // Other
  sse_warning: 'SSE connection established',
};

export function lang(key: string): string {
  return translations[key] || key;
}
