import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DAVClient, freeBusyQuery } from 'tsdav';
import { z } from 'zod';
import { calendarsFor, calendarFor, createICalendar, EventInput, objectResult, simpleCalendar, simpleEvent, simpleFreeBusy, updateICalendar } from './calendar';
import { Connection, connectionSchema, createEncryptedToken, decodeConnectionToken, sameSecureOrigin, secureUrl } from './token';
import { homePage as reactHomePage } from './ui';

interface Env { CONNECTION_TOKEN_KEY?: string }
const range = { start: z.string(), end: z.string() };
const calendar = { calendarUrl: secureUrl.optional() };
const eventFields = { summary: z.string().optional(), start: z.string().optional(), end: z.string().optional(), description: z.string().optional(), location: z.string().optional(), status: z.string().optional(), recurrenceRule: z.string().optional() };

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }
function securityHeaders(): HeadersInit { return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }; }
function clientFor(connection: Connection) { return new DAVClient({ serverUrl: connection.serverUrl, credentials: { username: connection.username, password: connection.password }, authMethod: 'Basic', defaultAccountType: 'caldav' }); }

function createServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'caldav-forwarder', version: '1.0.0' });
  const client = clientFor(connection);
  const login = async () => { await client.login(); return client; };
  const trustedUrl = (value: string, label: string) => {
    if (!sameSecureOrigin(value, connection.serverUrl)) throw new Error(`${label} must belong to the configured CalDAV server.`);
    return value;
  };

  server.registerTool('list_calendars', { description: 'List calendars available in the CalDAV account. Use a returned url as calendarUrl for one calendar. If calendarUrl is omitted from list_events or search_events, they search all calendars unless the connection token has a configured calendarUrl.', inputSchema: {} }, async () => result((await (await login()).fetchCalendars()).map(simpleCalendar)));
  server.registerTool('list_events', { description: 'List events within the required start and end range. If calendarUrl is provided, use only that calendar. If omitted, use the token calendarUrl when configured; otherwise use all calendars. Returns url, etag, and iCalendar data.', inputSchema: { ...calendar, ...range, expand: z.boolean().optional() } }, async ({ calendarUrl, start, end, expand }) => {
    const c = await login(); const calendars = await calendarsFor(c, calendarUrl, connection.calendarUrl);
    const events = (await Promise.all(calendars.map((cal) => c.fetchCalendarObjects({ calendar: cal, timeRange: { start, end }, expand })))).flat();
    return result(events.map(simpleEvent));
  });
  server.registerTool('search_events', { description: 'Search event iCalendar data for query within the required start and end range. Calendar selection follows list_events: explicit calendarUrl, then token calendarUrl, otherwise all calendars. Returns matching event url, etag, and data.', inputSchema: { ...calendar, ...range, query: z.string().min(1) } }, async ({ calendarUrl, start, end, query }) => {
    const c = await login(); const calendars = await calendarsFor(c, calendarUrl, connection.calendarUrl); const objects = (await Promise.all(calendars.map((cal) => c.fetchCalendarObjects({ calendar: cal, timeRange: { start, end } })))).flat();
    return result(objects.filter((item) => String(item.data ?? '').toLowerCase().includes(query.toLowerCase())).map(simpleEvent));
  });
  server.registerTool('get_event', { description: 'Read one event by its HTTPS calendar object URL. Requires the current eventUrl and returns url, etag, and iCalendar data.', inputSchema: { eventUrl: secureUrl } }, async ({ eventUrl }) => {
    trustedUrl(eventUrl, 'eventUrl');
    const c = await login(); const objects = await c.fetchCalendarObjects({ calendar: { url: new URL('.', eventUrl).toString() }, objectUrls: [eventUrl] });
    if (!objects[0]) throw new Error('Event not found.'); return objectResult(objects[0]);
  });
  server.registerTool('create_event', { description: 'Create an event in the selected calendar. Uses explicit calendarUrl, then the token calendarUrl, otherwise the first available calendar. Required: summary, start, end. Returns the created event url.', inputSchema: { ...calendar, ...eventFields, summary: z.string().min(1), start: z.string(), end: z.string(), filename: z.string().regex(/^[^/]+\.ics$/).optional(), attendees: z.array(z.string()).optional() } }, async (input) => {
    const c = await login(); const cal = await calendarFor(c, input.calendarUrl, connection.calendarUrl); const response = await c.createCalendarObject({ calendar: cal, filename: input.filename ?? `${crypto.randomUUID()}.ics`, iCalString: createICalendar(input as EventInput) });
    return result({ url: response.headers.get('location') });
  });
  server.registerTool('update_event', { description: 'Update an event using its HTTPS eventUrl and current iCalendar data. Provide only fields to change; omitted fields stay unchanged. Returns the event url.', inputSchema: { eventUrl: secureUrl, data: z.string().min(1), etag: z.string().max(512).optional(), ...eventFields } }, async ({ eventUrl, data, etag, ...input }) => {
    trustedUrl(eventUrl, 'eventUrl');
    const c = await login(); await c.updateCalendarObject({ calendarObject: { url: eventUrl, etag, data: updateICalendar(data, input) } }); return result({ url: eventUrl, etag });
  });
  server.registerTool('delete_event', { description: 'Permanently delete an event by its HTTPS eventUrl. Confirm this destructive action before calling. Provide etag when available. Returns the event url and deleted: true.', inputSchema: { eventUrl: secureUrl, etag: z.string().max(512).optional() } }, async ({ eventUrl, etag }) => {
    trustedUrl(eventUrl, 'eventUrl');
    const c = await login(); await c.deleteCalendarObject({ calendarObject: { url: eventUrl, etag } }); return result({ url: eventUrl, deleted: true });
  });
  server.registerTool('get_free_busy', { description: 'Get free/busy data for the required start and end range. Uses the optional HTTPS url or the CalDAV server URL from the connection. Returns only iCalendar free/busy data.', inputSchema: { url: secureUrl.optional(), ...range } }, async ({ url, start, end }) => {
    const target = url ? trustedUrl(url, 'url') : connection.serverUrl;
    return result(simpleFreeBusy(await freeBusyQuery({ url: target, timeRange: { start, end }, headers: {} })));
  });
  return server;
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/') return reactHomePage(url.origin);
  if (url.pathname === '/token') {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: securityHeaders() });
    if (!env.CONNECTION_TOKEN_KEY) return Response.json({ error: 'Token creation is not configured.' }, { status: 503, headers: securityHeaders() });
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return Response.json({ error: 'JSON required.' }, { status: 415, headers: securityHeaders() });
    try {
      const input = connectionSchema.parse(await request.json());
      const token = await createEncryptedToken(input, env.CONNECTION_TOKEN_KEY);
      return Response.json({ token }, { headers: securityHeaders() });
    } catch { return Response.json({ error: 'Invalid connection details.' }, { status: 400, headers: securityHeaders() }); }
  }
  if (url.pathname === '/connection-test') {
    if (!env.CONNECTION_TOKEN_KEY) return Response.json({ error: 'Connection testing is not configured.' }, { status: 503, headers: securityHeaders() });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: securityHeaders() });
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return Response.json({ error: 'JSON required.' }, { status: 415, headers: securityHeaders() });
    try {
      const connection = connectionSchema.parse(await request.json());
      const client = clientFor(connection);
      await client.login();
      const calendars = (await client.fetchCalendars()).map(simpleCalendar);
      return Response.json({ calendars }, { headers: securityHeaders() });
    } catch { return Response.json({ error: 'Could not connect. Check the server URL, username, and app password.' }, { status: 400, headers: securityHeaders() }); }
  }
  if (!url.pathname.startsWith('/mcp/')) return Response.json({ error: 'Not found.' }, { status: 404, headers: securityHeaders() });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: securityHeaders() });
  if (url.pathname.length > 4096) return Response.json({ error: 'Invalid request.' }, { status: 400, headers: securityHeaders() });
  try {
    const connection = await decodeConnectionToken(url.pathname.slice(5), env.CONNECTION_TOKEN_KEY, false);
    const target = request.headers.get('origin');
    if (target && target !== url.origin) return Response.json({ error: 'Invalid request.' }, { status: 403, headers: securityHeaders() });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(connection).connect(transport); return await transport.handleRequest(request);
  } catch { return Response.json({ error: 'Invalid request.' }, { status: 400, headers: securityHeaders() }); }
} };
