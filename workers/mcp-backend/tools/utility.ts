/**
 * Utility tools for SiYuan
 */

import { z } from 'zod';
import { createJsonResponse } from '../utils/mcpResponse';
import { pushMsgAPI, reindexDoc, flushTransaction } from '../syapi';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { isValidStr } from '../utils/commonCheck';


export class UtilityToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'siyuan_push_notification',
        description:
          'Push a notification message to the SiYuan UI. Useful for notifying the user about task progress or completion.',
        inputSchema: z.object({
          message: z.string().describe('The notification message to display'),
          timeout: z
            .number()
            .optional()
            .default(7000)
            .describe('How long to show the notification in milliseconds (default: 7000)'),
        }),
        outputSchema: z.object({
          success: z.boolean().describe('Whether the notification was sent successfully'),
        }),
        handler: pushNotificationHandler,
        title: lang('tool_title_push_notification'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      }),
      defineTool({
        name: 'siyuan_reindex_doc',
        description:
          'Reindex a document tree. Useful after batch operations to ensure the index is up to date.',
        inputSchema: z.object({
          path: z.string().describe('The document path to reindex (e.g., "/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy")'),
        }),
        outputSchema: z.object({
          success: z.boolean().describe('Whether the reindex operation succeeded'),
          path: z.string().describe('The path that was reindexed'),
        }),
        handler: reindexDocHandler,
        title: lang('tool_title_reindex_doc'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
      defineTool({
        name: 'siyuan_flush_transaction',
        description:
          'Flush pending database transactions. Call this after write operations (insert/update/delete blocks) if you need to immediately query the updated data. SiYuan uses async write queues for performance, so this ensures all pending writes are committed.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          success: z.boolean().describe('Whether the flush operation succeeded'),
        }),
        handler: flushTransactionHandler,
        title: lang('tool_title_flush_transaction'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      }),
    ];
  }
}

async function pushNotificationHandler(params: { message: string; timeout?: number }) {
  const { message, timeout = 7000 } = params;
  debugPush('Push notification API called');

  if (!isValidStr(message)) {
    throw new Error('Message cannot be empty.');
  }

  const result = await pushMsgAPI(message, timeout);
  const success = result === 0;
  return createJsonResponse({ success });
}

async function reindexDocHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Reindex doc API called');

  if (!isValidStr(path)) {
    throw new Error('Path cannot be empty.');
  }

  const result = await reindexDoc(path);
  const success = result === 0;
  return createJsonResponse({ success, path });
}

async function flushTransactionHandler() {
  debugPush('Flush transaction API called');

  const result = await flushTransaction();
  const success = result === 0;
  return createJsonResponse({ success });
}
