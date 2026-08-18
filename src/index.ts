import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DAVClient, freeBusyQuery } from 'tsdav';
import { z } from 'zod';
import { calendarsFor, calendarFor, createICalendar, EventInput, objectResult, simpleCalendar, simpleEvent, simpleFreeBusy, updateICalendar } from './calendar';
import { Connection, connectionSchema, createEncryptedToken, decodeConnectionToken, secureUrl } from './token';
import { homePage as reactHomePage } from './ui';

interface Env { CONNECTION_TOKEN_KEY?: string }
const range = { start: z.string(), end: z.string() };
const calendar = { calendarUrl: secureUrl.optional() };
const eventFields = { summary: z.string().optional(), start: z.string().optional(), end: z.string().optional(), description: z.string().optional(), location: z.string().optional(), status: z.string().optional(), recurrenceRule: z.string().optional() };

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }
function securityHeaders(): HeadersInit { return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }; }
function clientFor(connection: Connection) { return new DAVClient({ serverUrl: connection.serverUrl, credentials: { username: connection.username, password: connection.password }, authMethod: 'Basic', defaultAccountType: 'caldav' }); }

function homePage(origin: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CalDAV MCP Forwarder</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.5; }
    h1 { margin-bottom: .25rem; } .muted { color: #777; }
    .card { border: 1px solid #8885; border-radius: 12px; padding: 1rem; margin: 1rem 0; }
    ol { padding-left: 1.4rem; } li { margin: .4rem 0; }
    label { display: block; font-weight: 600; margin-top: .8rem; }
    input, textarea { box-sizing: border-box; width: 100%; padding: .65rem; margin-top: .25rem; border: 1px solid #8888; border-radius: 6px; font: inherit; }
    textarea { min-height: 7rem; resize: vertical; } button { cursor: pointer; padding: .65rem 1rem; margin: .8rem .4rem 0 0; border: 0; border-radius: 6px; font-weight: 600; }
    .primary { background: #2563eb; color: white; } .secondary { background: #8883; }
    .warning { background: #f59e0b22; border-left: 4px solid #f59e0b; padding: .7rem; }
    output { display: block; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: .8rem; }
  </style>
</head>
<body>
  <h1>CalDAV MCP Forwarder</h1>
  <p class="muted">Connect your AI assistant to a CalDAV calendar in three steps.</p>
  <ol><li>Enter your CalDAV details below.</li><li>Make a token.</li><li>Paste the generated MCP URL into your AI assistant.</li></ol>
  <div class="warning"><strong>Use an app password</strong> when your calendar provider supports it. Your details are sent over HTTPS only to create the encrypted token.</div>
  <section class="card">
    <h2>1. Calendar details</h2>
    <label for="provider">Calendar provider</label><select id="provider"><option value="">Choose a provider</option><option value="nextcloud">Nextcloud</option><option value="fastmail">Fastmail</option><option value="icloud">iCloud</option><option value="other">Other</option></select>
    <p id="providerHelp" class="muted">Choose a provider for a quick hint, or choose Other.</p>
    <label for="serverUrl">CalDAV server URL</label><input id="serverUrl" type="url" placeholder="https://caldav.example.com" autocomplete="url" required>
    <label for="calendarUrl">Calendar URL <span class="muted">(optional — leave blank to discover calendars)</span></label><input id="calendarUrl" type="url" placeholder="https://caldav.example.com/calendars/user/work/">
    <label for="username">Username</label><input id="username" autocomplete="username">
    <label for="password">App password</label><input id="password" type="password" autocomplete="current-password">
    <p class="muted">Your details are sent over HTTPS to create an encrypted token. This token does not expire. Rotate <code>CONNECTION_TOKEN_KEY</code> to revoke existing tokens.</p>
    <button class="primary" id="makeEncrypted">Make secure token</button>
    <output id="made" aria-live="polite"></output>
  </section>
  <section class="card">
    <h2>2. Connect your AI assistant</h2>
    <p>Copy the URL or configuration below into your MCP-compatible AI assistant.</p>
    <label for="mcpUrl">MCP URL</label><textarea id="mcpUrl" readonly placeholder="Your MCP URL will appear here"></textarea><button class="secondary" id="copyUrl">Copy MCP URL</button>
    <label for="config">Configuration</label><textarea id="config" readonly placeholder="Your configuration will appear here"></textarea><button class="secondary" id="copyConfig">Copy configuration</button>
    <output id="connectStatus" aria-live="polite"></output>
  </section>
  <details class="card">
    <summary><strong>Decode a token</strong></summary>
    <p>Tokens are intentionally opaque. For safety, this public page cannot decode credentials.</p>
    <label for="token">Token</label><textarea id="token" placeholder="Paste a token here"></textarea>
    <button class="secondary" id="decode">Decode token</button><output id="decoded" aria-live="polite"></output>
  </details>
  <p class="muted">Need help? Use an app password and check your provider’s CalDAV settings. The server administrator must configure <code>CONNECTION_TOKEN_KEY</code> for secure tokens.</p>
<script>
const $ = (id) => document.getElementById(id);
const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, ''); };
const bytes = (text) => new TextEncoder().encode(text);
const connection = () => { if (!$('serverUrl').value || !$('username').value || !$('password').value) throw new Error('Enter the server URL, username, and app password.'); const value = { serverUrl: $('serverUrl').value, username: $('username').value, password: $('password').value }; if ($('calendarUrl').value) value.calendarUrl = $('calendarUrl').value; return value; };
const show = (element, value) => { element.textContent = value; };
$('provider').onchange = () => { const hints = { nextcloud: 'Nextcloud usually uses an app password and a calendar URL from the Calendar app.', fastmail: 'Fastmail uses an app-specific password and its CalDAV server URL.', icloud: 'iCloud requires an app-specific password; use the CalDAV URL from Apple’s account settings.', other: 'Use the CalDAV URL and app password supplied by your provider.' }; show($('providerHelp'), hints[$('provider').value] || 'Choose a provider for a quick hint, or choose Other.'); };
const finish = (token) => { const url = '${origin}/mcp/' + token; $('token').value = token; $('mcpUrl').value = url; $('config').value = JSON.stringify({ mcpServers: { caldav: { type: 'http', url } } }, null, 2); show($('made'), 'Token created. Copy the MCP URL or configuration below.'); };
$('makeEncrypted').onclick = async () => { try { const response = await fetch('/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(connection()) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not create token.'); finish(body.token); } catch (e) { show($('made'), e.message); } };
$('copyUrl').onclick = async () => { if (!$('mcpUrl').value) return show($('connectStatus'), 'Make a token first.'); await navigator.clipboard.writeText($('mcpUrl').value); show($('connectStatus'), 'MCP URL copied.'); };
$('copyConfig').onclick = async () => { if (!$('config').value) return show($('connectStatus'), 'Make a token first.'); await navigator.clipboard.writeText($('config').value); show($('connectStatus'), 'Configuration copied.'); };
$('decode').onclick = () => show($('decoded'), 'Tokens are encrypted and cannot be decoded in the public browser tool.');
</script>
</body></html>`;
  return new Response(html, { headers: { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
}

function createServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'caldav-forwarder', version: '1.0.0' });
  const client = clientFor(connection);
  const login = async () => { await client.login(); return client; };

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
    const c = await login(); const objects = await c.fetchCalendarObjects({ calendar: { url: new URL('.', eventUrl).toString() }, objectUrls: [eventUrl] });
    if (!objects[0]) throw new Error('Event not found.'); return objectResult(objects[0]);
  });
  server.registerTool('create_event', { description: 'Create an event in the selected calendar. Uses explicit calendarUrl, then the token calendarUrl, otherwise the first available calendar. Required: summary, start, end. Returns the created event url.', inputSchema: { ...calendar, ...eventFields, summary: z.string().min(1), start: z.string(), end: z.string(), filename: z.string().regex(/^[^/]+\.ics$/).optional(), attendees: z.array(z.string()).optional() } }, async (input) => {
    const c = await login(); const cal = await calendarFor(c, input.calendarUrl, connection.calendarUrl); const response = await c.createCalendarObject({ calendar: cal, filename: input.filename ?? `${crypto.randomUUID()}.ics`, iCalString: createICalendar(input as EventInput) });
    return result({ url: response.headers.get('location') });
  });
  server.registerTool('update_event', { description: 'Update an event using its HTTPS eventUrl and current iCalendar data. Provide only fields to change; omitted fields stay unchanged. Returns the event url.', inputSchema: { eventUrl: secureUrl, data: z.string().min(1), ...eventFields } }, async ({ eventUrl, data, ...input }) => {
    const c = await login(); await c.updateCalendarObject({ calendarObject: { url: eventUrl, data: updateICalendar(data, input) } }); return result({ url: eventUrl });
  });
  server.registerTool('delete_event', { description: 'Permanently delete an event by its HTTPS eventUrl. Confirm this destructive action before calling. Provide etag when available. Returns the event url and deleted: true.', inputSchema: { eventUrl: secureUrl, etag: z.string().max(512).optional() } }, async ({ eventUrl, etag }) => {
    const c = await login(); await c.deleteCalendarObject({ calendarObject: { url: eventUrl, etag } }); return result({ url: eventUrl, deleted: true });
  });
  server.registerTool('get_free_busy', { description: 'Get free/busy data for the required start and end range. Uses the optional HTTPS url or the CalDAV server URL from the connection. Returns only iCalendar free/busy data.', inputSchema: { url: secureUrl.optional(), ...range } }, async ({ url, start, end }) => result(simpleFreeBusy(await freeBusyQuery({ url: url ?? connection.serverUrl, timeRange: { start, end }, headers: {} }))));
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
  if (!url.pathname.startsWith('/mcp/')) return Response.json({ error: 'Not found.' }, { status: 404, headers: securityHeaders() });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: securityHeaders() });
  if (url.pathname.length > 4096) return Response.json({ error: 'Invalid request.' }, { status: 400, headers: securityHeaders() });
  try {
    const connection = await decodeConnectionToken(url.pathname.slice(5), env.CONNECTION_TOKEN_KEY, false);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(connection).connect(transport); return await transport.handleRequest(request);
  } catch { return Response.json({ error: 'Invalid request.' }, { status: 400, headers: securityHeaders() }); }
} };
