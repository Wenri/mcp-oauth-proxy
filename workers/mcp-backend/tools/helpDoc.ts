/**
 * Help documentation tools - provide SiYuan syntax references
 * Ported from upstream syplugin-anMCPServer
 */

import { z } from 'zod';
import { createSuccessResponse } from '../utils/mcpResponse';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { lang } from '../utils/lang';
import { getMdSyntaxCN, getSuperblockCN, getTemplateActionCN } from '../static';

export class HelpDocToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_markdown_syntax_help',
        description: 'Provides help with the Markdown syntax used in SiYuan, including SQL embed blocks, block references, and super block layout syntax.',
        inputSchema: z.object({}),
        handler: markdownHelpHandler,
        title: lang('tool_title_markdown_syntax_help'),
        annotations: {
          readOnlyHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_template_function_help',
        description: 'Provides help with the template functions available in SiYuan, including .action{} syntax, Sprig functions, and built-in variables.',
        inputSchema: z.object({}),
        handler: templateFunctionHelpHandler,
        title: lang('tool_title_template_function_help'),
        annotations: {
          readOnlyHint: true,
        },
      }),
    ];
  }
}

async function markdownHelpHandler() {
  return createSuccessResponse(getMdSyntaxCN() + '\n\n' + getSuperblockCN());
}

async function templateFunctionHelpHandler() {
  return createSuccessResponse(getTemplateActionCN());
}
