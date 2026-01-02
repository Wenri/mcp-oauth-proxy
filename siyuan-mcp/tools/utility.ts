/**
 * Utility tools for SiYuan
 */

import { z } from 'zod';
import { createErrorResponse, createSuccessResponse, createJsonResponse } from '../utils/mcpResponse';
import { pushMsgAPI, reindexDoc, flushTransaction } from '../syapi';
import { McpToolsProvider } from './baseToolProvider';
import { debugPush } from '../logger';
import { lang } from '../utils/lang';
import { isValidStr } from '../utils/commonCheck';

export class UtilityToolProvider extends McpToolsProvider<any> {
  async getTools(): Promise<McpTool<any>[]> {
    return [
      {
        name: 'get_current_time',
        description: lang('tool_get_current_time'),
        schema: {},
        handler: getCurrentTimeHandler,
        title: lang('tool_title_get_current_time'),
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: 'siyuan_push_notification',
        description:
          'Push a notification message to the SiYuan UI. Useful for notifying the user about task progress or completion.',
        schema: {
          message: z.string().describe('The notification message to display'),
          timeout: z
            .number()
            .optional()
            .describe('How long to show the notification in milliseconds (default: 7000)'),
        },
        handler: pushNotificationHandler,
        title: lang('tool_title_push_notification'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      {
        name: 'siyuan_reindex_doc',
        description:
          'Reindex a document tree. Useful after batch operations to ensure the index is up to date.',
        schema: {
          path: z.string().describe('The document path to reindex (e.g., "/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy")'),
        },
        handler: reindexDocHandler,
        title: lang('tool_title_reindex_doc'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      {
        name: 'siyuan_flush_transaction',
        description:
          'Flush pending database transactions. Call this after write operations (insert/update/delete blocks) if you need to immediately query the updated data. SiYuan uses async write queues for performance, so this ensures all pending writes are committed.',
        schema: {},
        handler: flushTransactionHandler,
        title: lang('tool_title_flush_transaction'),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    ];
  }
}

async function pushNotificationHandler(params: { message: string; timeout?: number }) {
  const { message, timeout = 7000 } = params;
  debugPush('Push notification API called');

  if (!isValidStr(message)) {
    return createErrorResponse('Message cannot be empty.');
  }

  const result = await pushMsgAPI(message, timeout);
  if (result === 0) {
    return createSuccessResponse('Notification sent successfully.');
  } else {
    return createErrorResponse('Failed to send notification.');
  }
}

async function reindexDocHandler(params: { path: string }) {
  const { path } = params;
  debugPush('Reindex doc API called');

  if (!isValidStr(path)) {
    return createErrorResponse('Path cannot be empty.');
  }

  const result = await reindexDoc(path);
  if (result === 0) {
    return createSuccessResponse(`Successfully reindexed: ${path}`);
  } else {
    return createErrorResponse('Failed to reindex document.');
  }
}

async function flushTransactionHandler() {
  debugPush('Flush transaction API called');

  const result = await flushTransaction();
  if (result === 0) {
    return createSuccessResponse('Database transactions flushed successfully.');
  } else {
    return createErrorResponse('Failed to flush transactions.');
  }
}

async function getCurrentTimeHandler() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const dayOfWeek = now.toLocaleString('en-US', { weekday: 'long' });

  const timeInfo = {
    iso: now.toISOString(),
    year: year,
    month: month,
    day: day,
    hour: hours,
    minute: minutes,
    second: seconds,
    dayOfWeek: dayOfWeek,
    formattedDate: `${year}-${month}-${day}`,
    formattedTime: `${hours}:${minutes}:${seconds}`,
    formattedDateTime: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
    timezoneOffset: now.getTimezoneOffset(),
    unixTimestamp: Math.floor(now.getTime() / 1000),
  };

  return createJsonResponse(timeInfo);
}
