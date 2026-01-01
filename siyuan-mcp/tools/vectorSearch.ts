/**
 * Vector search / RAG tools
 * Adapted from upstream - removed browser-only exports
 *
 * CHANGE FROM UPSTREAM: Removed window["OpaqueGlassAPI"] browser export
 */

import { z } from 'zod';
import { createErrorResponse, createJsonResponse } from '../utils/mcpResponse';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush, errorPush, logPush } from '../logger';
import { lang } from '../utils/lang';
import { getPlatformContext } from '../platform';

// RAG provider interface
interface RAGProvider {
  query(question: string, topK?: number): Promise<any>;
  health(): Promise<any>;
}

// Create RAG provider from config
function createRAGProvider(): RAGProvider | null {
  const ctx = getPlatformContext();
  const ragConfig = ctx.config.rag;

  if (!ragConfig?.baseUrl) {
    return null;
  }

  const baseUrl = ragConfig.baseUrl.endsWith('/')
    ? ragConfig.baseUrl + 'api/v1'
    : ragConfig.baseUrl + '/api/v1';
  const apiKey = ragConfig.apiKey || '';

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };

  return {
    async query(question: string, topK = 5): Promise<any> {
      const url = `${baseUrl}/query`;
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: question, top_k: topK }),
      });
      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(`RAG query failed: ${resp.status} - ${msg}`);
      }
      const result = await resp.json();
      return result.result;
    },

    async health(): Promise<any> {
      const url = `${baseUrl}/health`;
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers,
        });
        if (!resp.ok) {
          return null;
        }
        return await resp.json();
      } catch {
        return null;
      }
    },
  };
}

export class DocVectorSearchProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    const provider = createRAGProvider();
    if (!provider) {
      logPush('RAG not configured: RAG tools will not be loaded');
      return [];
    }

    const healthResult = await provider.health();
    if (healthResult == null) {
      logPush('Connection with RAG backend ERROR: RAG tools will not be loaded', healthResult);
      return [];
    }

    return [
      {
        name: 'siyuan_generate_answer_with_doc',
        description:
          'This tool provides a Retrieval-Augmented Generation (RAG) based Q&A capability. It generates context-aware answers using only the notes that the user has explicitly indexed from their siyuan-notes. Please note: the tool does not access or use all documents—only those that have been indexed by the user.',
        schema: {
          question: z.string().describe('Describe question about note here'),
        },
        handler: (params: { question: string }, extra: any) =>
          answerWithRAG(params, extra, provider),
        title: lang('tool_title_generate_answer_with_doc'),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    ];
  }
}

async function answerWithRAG(
  params: { question: string },
  extra: any,
  provider: RAGProvider
) {
  const { question } = params;
  debugPush('RAG API called');

  const maxDuration = 120 * 1000; // 120 seconds

  try {
    const resultPromise = provider.query(question);
    const result = await Promise.race([
      resultPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RAG query timeout (120s)')), maxDuration)
      ),
    ]);

    logPush('RAG result', result);
    return createJsonResponse(result);
  } catch (err: any) {
    errorPush('RAG API error', err);
    return createErrorResponse(
      'The tool call failed. ' +
        (err?.message ||
          'There was a problem with the connection to the RAG service. Please remind the user to troubleshoot the problem.')
    );
  }
}
