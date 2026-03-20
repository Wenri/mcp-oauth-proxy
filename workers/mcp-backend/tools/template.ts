/**
 * Template tools - create, search, render, and manage SiYuan templates
 * Ported from upstream syplugin-anMCPServer
 */

import { z } from 'zod';
import { createSuccessResponse, createArrayResponse, createJsonResponse } from '../utils/mcpResponse';
import { searchTemplateAPI, renderTemplateAPI, renderSprigAPI, insertBlockOriginAPI, getFileAPIv2, putFileAPI, removeFileAPI } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { validateBlockAccess } from '../utils/resultFilter';
import { validatePath } from '../utils/commonCheck';
import { wrapTemplateFilePath } from '../utils/common';
import { getConfig } from '../server';

export class TemplateToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_create_template',
        description: 'Create a new template file or overwrite an existing one in the SiYuan workspace. Templates are stored as .md files under /data/templates/.',
        inputSchema: z.object({
          name: z.string().describe('Template name (e.g., "daily-log" or "subfolder/template"). Must be a valid filename without .md extension.'),
          content: z.string().describe('The raw content of the template.'),
          override: z.boolean().optional().describe('If true, overwrites an existing template with the same name. Defaults to false.'),
        }),
        handler: createTemplateHandler,
        title: lang('tool_title_create_template'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_search_template',
        description: 'Search for existing templates within the SiYuan workspace using a keyword. Returns a list of matching template names.',
        inputSchema: z.object({
          k: z.string().describe('Keyword to search for in template names. Use empty string to list all templates.'),
        }),
        handler: searchTemplateHandler,
        title: lang('tool_title_search_template'),
        annotations: {
          readOnlyHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_render_template',
        description: 'Render a template and insert the result into a specified document. The template is rendered with the document as context, then the rendered content is prepended to the document.',
        inputSchema: z.object({
          id: z.string().describe('Document ID or hpath (e.g., "/NotebookName/Doc") where the template content will be inserted.'),
          name: z.string().describe('The name of the template file to render and insert.'),
        }),
        handler: renderTemplateHandler,
        title: lang('tool_title_render_template'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_get_raw_template',
        description: 'Retrieve the raw source content of a template file. Useful for inspecting or editing the template structure.',
        inputSchema: z.object({
          name: z.string().describe('The name of the template to retrieve.'),
        }),
        handler: getRawTemplateHandler,
        title: lang('tool_title_get_raw_template'),
        annotations: {
          readOnlyHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_remove_template',
        description: 'Delete a template file from the workspace. This action is permanent.',
        inputSchema: z.object({
          name: z.string().describe('The name of the template file to remove.'),
        }),
        handler: removeTemplateHandler,
        title: lang('tool_title_remove_template'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_preview_rendered_template',
        description: 'Generate the rendered DOM of a template without modifying the document. Use this to check the output or get the content for further processing before any insertion.',
        inputSchema: z.object({
          id: z.string().describe('Document ID or hpath (e.g., "/NotebookName/Doc") to provide data context for rendering.'),
          name: z.string().describe('The name of the template file to preview.'),
        }),
        handler: previewRenderedTemplateHandler,
        title: lang('tool_title_preview_rendered_template'),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_render_sprig_template',
        description: 'Render a Sprig template string. Useful for testing template expressions without creating a template file.',
        inputSchema: z.object({
          sprigTemplate: z.string().describe('The Sprig template content to render.'),
        }),
        handler: renderSprigHandler,
        title: lang('tool_title_render_sprig_template'),
        annotations: {
          readOnlyHint: true,
        },
      }),
    ];
  }
}

// ===== Helpers =====

function validateTemplateName(name: string): { isValid: boolean; reason?: string } {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return { isValid: false, reason: 'Template name cannot be empty' };
  }
  if (name.startsWith('/') || name.startsWith('\\')) {
    return { isValid: false, reason: 'Template name cannot start with "/" or "\\"' };
  }
  if (name.endsWith('/') || name.endsWith('\\')) {
    return { isValid: false, reason: 'Template name cannot end with "/" or "\\"' };
  }
  return validatePath(name);
}

async function getTemplateItemByName(name: string): Promise<{ content: string; path: string } | null> {
  const response = await searchTemplateAPI(name.replaceAll('/', ' '));
  if (!response.length) {
    return null;
  }
  for (const item of response) {
    const cleanedName = item.content.replaceAll('<mark>', '').replaceAll('</mark>', '');
    if (cleanedName === name || (cleanedName.startsWith('/') && cleanedName.substring(1) === name)) {
      return item;
    }
  }
  return null;
}

// ===== Handlers =====

async function createTemplateHandler(params: { name: string; content: string; override?: boolean }) {
  const { name, content, override } = params;
  debugPush('Create template called:', name);

  const validationResult = validateTemplateName(name);
  if (!validationResult.isValid) {
    throw new Error(`Invalid template name: ${validationResult.reason}`);
  }

  const templatePath = wrapTemplateFilePath(name);

  if (!override) {
    const existing = await getFileAPIv2(templatePath);
    if (existing) {
      throw new Error(`Template "${name}" already exists. Set override=true to overwrite.`);
    }
  }

  await putFileAPI(templatePath, content);
  return createSuccessResponse(`Template created: ${name}`);
}

async function searchTemplateHandler(params: { k: string }) {
  const { k } = params;
  debugPush('Search template called:', k);

  const results = await searchTemplateAPI(k);
  const templates = results.map(item => ({
    name: item.content.replaceAll('<mark>', '').replaceAll('</mark>', ''),
  }));

  return createArrayResponse(templates, 'templates');
}

async function renderTemplateHandler(params: { id: DocumentId; name: string }) {
  const { id, name } = params;
  debugPush('Render template called:', id, name);

  const docInfo = await validateBlockAccess(id, true);

  const validationResult = validateTemplateName(name);
  if (!validationResult.isValid) {
    throw new Error(`Invalid template name: ${validationResult.reason}`);
  }

  const templateItem = await getTemplateItemByName(name);
  if (!templateItem) {
    throw new Error(`Template not found: ${name}`);
  }

  const renderedDom = await renderTemplateAPI(docInfo.id, templateItem.path);
  const transactions = await insertBlockOriginAPI({
    data: renderedDom,
    dataType: 'dom',
    parentID: docInfo.id,
  });

  const insertedId = transactions?.[0]?.doOperations?.[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to determine inserted block ID from insertBlockOriginAPI result');
  }

  return createSuccessResponse(insertedId);
}

async function getRawTemplateHandler(params: { name: string }) {
  const { name } = params;
  debugPush('Get raw template called:', name);

  const validationResult = validateTemplateName(name);
  if (!validationResult.isValid) {
    throw new Error(`Invalid template name: ${validationResult.reason}`);
  }

  const templateItem = await getTemplateItemByName(name);
  if (!templateItem) {
    throw new Error(`Template not found: ${name}`);
  }

  // Strip workspace dir prefix to get relative path
  const config = getConfig();
  const workspaceDir = config.system?.workspaceDir || '';
  const relativePath = workspaceDir && templateItem.path.startsWith(workspaceDir)
    ? templateItem.path.substring(workspaceDir.length)
    : wrapTemplateFilePath(name);

  const response = await getFileAPIv2(relativePath);
  if (!response) {
    throw new Error(`Failed to read template file: ${name}`);
  }

  const text = await response.text();
  return createSuccessResponse(text);
}

async function removeTemplateHandler(params: { name: string }) {
  const { name } = params;
  debugPush('Remove template called:', name);

  const validationResult = validateTemplateName(name);
  if (!validationResult.isValid) {
    throw new Error(`Invalid template name: ${validationResult.reason}`);
  }

  const result = await removeFileAPI(wrapTemplateFilePath(name));
  if (!result) {
    throw new Error(`Failed to remove template: ${name}`);
  }

  return createSuccessResponse(`Template removed: ${name}`);
}

async function renderSprigHandler(params: { sprigTemplate: string }) {
  const { sprigTemplate } = params;
  debugPush('Render sprig template called');

  const result = await renderSprigAPI(sprigTemplate);
  return createSuccessResponse(result);
}

async function previewRenderedTemplateHandler(params: { id: DocumentId; name: string }) {
  const { id, name } = params;
  debugPush('Preview rendered template called:', id, name);

  const docInfo = await validateBlockAccess(id, true);

  const validationResult = validateTemplateName(name);
  if (!validationResult.isValid) {
    throw new Error(`Invalid template name: ${validationResult.reason}`);
  }

  const templateItem = await getTemplateItemByName(name);
  if (!templateItem) {
    throw new Error(`Template not found: ${name}`);
  }

  const renderedDom = await renderTemplateAPI(docInfo.id, templateItem.path);
  return createJsonResponse({ renderedDom });
}
