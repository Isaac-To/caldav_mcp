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
  <p class="muted">Stateless calendar access for MCP-compatible assistants.</p>
  <div class="warning"><strong>Privacy:</strong> token values contain CalDAV credentials. This page processes them in your browser, but do not use this tool on a shared or untrusted computer. Use encrypted tokens for production.</div>
  <section class="card">
    <h2>Make a connection token</h2>
    <p>Use <strong>Development token</strong> for local testing. It is only encoded, not encrypted. Use <strong>Encrypted token</strong> when <code>CONNECTION_TOKEN_KEY</code> is configured on the Worker.</p>
    <label for="serverUrl">CalDAV server URL</label><input id="serverUrl" type="url" placeholder="https://caldav.example.com" autocomplete="url">
    <label for="calendarUrl">Calendar URL <span class="muted">(optional)</span></label><input id="calendarUrl" type="url" placeholder="https://caldav.example.com/calendars/user/work/">
    <label for="username">Username</label><input id="username" autocomplete="username">
    <label for="password">App password</label><input id="password" type="password" autocomplete="current-password">
    <label for="expiresAt">Expires in hours <span class="muted">(optional)</span></label><input id="expiresAt" type="number" min="1" placeholder="24">
    <label for="secret">Encryption key <span class="muted">(only for encrypted tokens)</span></label><input id="secret" type="password" placeholder="URL-safe base64 key">
    <button class="primary" id="makeDev">Make development token</button><button class="primary" id="makeEncrypted">Make encrypted token</button>
    <output id="made" aria-live="polite"></output>
  </section>
  <section class="card">
    <h2>Decode a token</h2>
    <p>Decoding happens locally in this browser. Encrypted tokens require the same encryption key used by the Worker.</p>
    <label for="token">Token</label><textarea id="token" placeholder="Paste a token here"></textarea>
    <button class="secondary" id="decode">Decode token</button><output id="decoded" aria-live="polite"></output>
  </section>
  <section class="card"><h2>Connect your MCP client</h2><p>Use this URL after generating a token:</p><output>${origin}/mcp/&lt;token&gt;</output><p>See the <a href="/README.md">README</a> for MCP client configuration and tool details.</p></section>
<script>
const $ = (id) => document.getElementById(id);
const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, ''); };
const bytes = (text) => new TextEncoder().encode(text);
const fromB64 = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
const key = (secret, usage) => crypto.subtle.importKey('raw', fromB64(secret).buffer, { name: 'AES-GCM' }, false, [usage]);
const connection = () => { const value = { serverUrl: $('serverUrl').value, username: $('username').value, password: $('password').value }; if ($('calendarUrl').value) value.calendarUrl = $('calendarUrl').value; if ($('expiresAt').value) value.expiresAt = Math.floor(Date.now() / 1000) + Number($('expiresAt').value) * 3600; return value; };
const show = (element, value) => { element.textContent = value; };
$('makeDev').onclick = () => { try { const token = b64(bytes(JSON.stringify(connection()))); show($('made'), token); $('token').value = token; } catch (e) { show($('made'), e.message); } };
$('makeEncrypted').onclick = async () => { try { if (!$('secret').value) throw new Error('Enter the base64 encryption key.'); const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key($('secret').value, 'encrypt'), bytes(JSON.stringify(connection()))); const token = 'v1.' + b64(iv) + '.' + b64(new Uint8Array(encrypted)); show($('made'), token); $('token').value = token; } catch (e) { show($('made'), e.message); } };
$('decode').onclick = async () => { try { const token = $('token').value.trim(); let data; if (token.startsWith('v1.')) { if (!$('secret').value) throw new Error('Enter the base64 encryption key.'); const [, iv, ciphertext] = token.split('.'); const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await key($('secret').value, 'decrypt'), fromB64(ciphertext)); data = new TextDecoder().decode(plain); } else data = new TextDecoder().decode(fromB64(token)); show($('decoded'), JSON.stringify(JSON.parse(data), null, 2)); } catch (e) { show($('decoded'), 'Could not decode token: ' + e.message); } };
</script>
</body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

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
  if (url.pathname === '/') return homePage(url.origin);
  if (!url.pathname.startsWith('/mcp/')) return Response.json({ error: 'Not found' }, { status: 404 });
  if (request.method !== 'POST') return Response.json({ error: 'Use POST for the stateless MCP endpoint.' }, { status: 405 });
  try {
    const connection = await decodeConnectionToken(url.pathname.slice(5), env.CONNECTION_TOKEN_KEY);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(connection).connect(transport); return await transport.handleRequest(request);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status: 400 }); }
} };
