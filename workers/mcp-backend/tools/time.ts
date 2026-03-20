import { z } from 'zod';
import { createJsonResponse } from '../utils/mcpResponse';
import { McpToolsProvider, defineTool } from './baseToolProvider';
import { lang } from '../utils/lang';

export class TimeToolProvider extends McpToolsProvider {
  async getTools(): Promise<McpTool[]> {
    return [
      defineTool({
        name: 'get_current_time',
        description: lang('tool_get_current_time'),
        inputSchema: z.object({}),
        outputSchema: z.object({
          iso: z.string().describe('ISO 8601 formatted timestamp'),
          year: z.number().describe('Year (e.g., 2024)'),
          month: z.string().describe('Month (01-12)'),
          day: z.string().describe('Day of month (01-31)'),
          hour: z.string().describe('Hour (00-23)'),
          minute: z.string().describe('Minute (00-59)'),
          second: z.string().describe('Second (00-59)'),
          dayOfWeek: z.string().describe('Day of week (e.g., "Monday")'),
          formattedDate: z.string().describe('Formatted date (YYYY-MM-DD)'),
          formattedTime: z.string().describe('Formatted time (HH:MM:SS)'),
          formattedDateTime: z.string().describe('Formatted datetime (YYYY-MM-DD HH:MM:SS)'),
          timezoneOffset: z.number().describe('Timezone offset in minutes'),
          unixTimestamp: z.number().describe('Unix timestamp in seconds'),
        }),
        handler: getCurrentTimeHandler,
        title: lang('tool_title_get_current_time'),
        annotations: {
          readOnlyHint: true,
        },
      }),
    ];
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
