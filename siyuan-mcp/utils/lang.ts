/**
 * Internationalization utility
 * Simplified version - returns English strings
 */

const translations: Record<string, string> = {
  tool_append_dailynote: 'Append markdown content to the daily note of a specified notebook.',
  tool_title_list_notebook: 'List Notebooks',
  tool_title_database_schema: 'Database Schema',
  tool_title_query_syntax: 'Query Syntax',
  tool_title_generate_answer_with_doc: 'Generate Answer with Documents (RAG)',
  sse_warning: 'SSE connection established',
};

export function lang(key: string): string {
  return translations[key] || key;
}
