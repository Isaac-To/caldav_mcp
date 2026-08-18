import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DAVClient, freeBusyQuery } from 'tsdav';
import { z } from 'zod';
import { calendarFor, createICalendar, EventInput, objectResult, updateICalendar } from './calendar';
import { Connection, decodeConnectionToken } from './token';

interface Env { CONNECTION_TOKEN_KEY?: string }
const range = { start: z.string(), end: z.string() };
const calendar = { calendarUrl: z.string().url().optional() };
const eventFields = { summary: z.string().optional(), start: z.string().optional(), end: z.string().optional(), description: z.string().optional(), location: z.string().optional(), status: z.string().optional(), recurrenceRule: z.string().optional() };

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }
function clientFor(connection: Connection) { return new DAVClient({ serverUrl: connection.serverUrl, credentials: { username: connection.username, password: connection.password }, authMethod: 'Basic', defaultAccountType: 'caldav' }); }

function createServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'caldav-forwarder', version: '1.0.0' });
  const client = clientFor(connection);
  const login = async () => { await client.login(); return client; };

  server.registerTool('list_calendars', { description: 'List calendars available in the CalDAV account.', inputSchema: {} }, async () => result(await (await login()).fetchCalendars()));
  server.registerTool('list_events', { description: 'List events in a calendar and optional time range.', inputSchema: { ...calendar, ...range, expand: z.boolean().optional() } }, async ({ calendarUrl, start, end, expand }) => {
    const c = await login(); const cal = await calendarFor(c, calendarUrl, connection.calendarUrl);
    return result(await c.fetchCalendarObjects({ calendar: cal, timeRange: { start, end }, expand }));
  });
  server.registerTool('search_events', { description: 'Search event data in a calendar and optional time range.', inputSchema: { ...calendar, ...range, query: z.string().min(1) } }, async ({ calendarUrl, start, end, query }) => {
    const c = await login(); const cal = await calendarFor(c, calendarUrl, connection.calendarUrl); const objects = await c.fetchCalendarObjects({ calendar: cal, timeRange: { start, end } });
    return result(objects.filter((item) => String(item.data ?? '').toLowerCase().includes(query.toLowerCase())));
  });
  server.registerTool('get_event', { description: 'Read one event by its calendar object URL.', inputSchema: { eventUrl: z.string().url() } }, async ({ eventUrl }) => {
    const c = await login(); const objects = await c.fetchCalendarObjects({ calendar: { url: new URL('.', eventUrl).toString() }, objectUrls: [eventUrl] });
    if (!objects[0]) throw new Error('Event not found.'); return objectResult(objects[0]);
  });
  server.registerTool('create_event', { description: 'Create an event in a calendar.', inputSchema: { ...calendar, ...eventFields, summary: z.string().min(1), start: z.string(), end: z.string(), filename: z.string().regex(/^[^/]+\.ics$/).optional(), attendees: z.array(z.string()).optional() } }, async (input) => {
    const c = await login(); const cal = await calendarFor(c, input.calendarUrl, connection.calendarUrl); const response = await c.createCalendarObject({ calendar: cal, filename: input.filename ?? `${crypto.randomUUID()}.ics`, iCalString: createICalendar(input as EventInput) });
    return result({ status: response.status, url: response.headers.get('location') });
  });
  server.registerTool('update_event', { description: 'Update an existing event using its object URL and current iCalendar data.', inputSchema: { eventUrl: z.string().url(), data: z.string().min(1), ...eventFields } }, async ({ eventUrl, data, ...input }) => {
    const c = await login(); const response = await c.updateCalendarObject({ calendarObject: { url: eventUrl, data: updateICalendar(data, input) } }); return result({ status: response.status });
  });
  server.registerTool('delete_event', { description: 'Delete an event by its calendar object URL.', inputSchema: { eventUrl: z.string().url(), etag: z.string().optional() } }, async ({ eventUrl, etag }) => {
    const c = await login(); const response = await c.deleteCalendarObject({ calendarObject: { url: eventUrl, etag } }); return result({ status: response.status });
  });
  server.registerTool('get_free_busy', { description: 'Get free/busy data for a time range.', inputSchema: { url: z.string().url().optional(), ...range } }, async ({ url, start, end }) => result(await freeBusyQuery({ url: url ?? connection.serverUrl, timeRange: { start, end }, headers: {} })));
  return server;
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/') return new Response('CalDAV MCP Forwarder. Connect at /mcp/<connection-token>.', { headers: { 'content-type': 'text/plain' } });
  if (!url.pathname.startsWith('/mcp/')) return Response.json({ error: 'Not found' }, { status: 404 });
  if (request.method !== 'POST') return Response.json({ error: 'Use POST for the stateless MCP endpoint.' }, { status: 405 });
  try {
    const connection = await decodeConnectionToken(url.pathname.slice(5), env.CONNECTION_TOKEN_KEY);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(connection).connect(transport); return await transport.handleRequest(request);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status: 400 }); }
} };
