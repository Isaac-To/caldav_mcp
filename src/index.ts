import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DAVClient } from 'tsdav';
import { z } from 'zod';

interface Env {
  CONNECTION_TOKEN_KEY?: string;
}

type Connection = {
  serverUrl: string;
  username: string;
  password: string;
  calendarUrl?: string;
};

const tokenSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  calendarUrl: z.string().url().optional(),
});

const toolInput = {
  calendarUrl: z.string().url().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function decodeConnectionToken(token: string): Connection {
  // Initial simple format: URL-safe base64 JSON. Replace this with encrypted
  // tokens before exposing the Worker publicly.
  const encoded = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const connection = tokenSchema.parse(JSON.parse(atob(padded)));
  return connection;
}

function createClient(connection: Connection): DAVClient {
  return new DAVClient({
    serverUrl: connection.serverUrl,
    credentials: {
      username: connection.username,
      password: connection.password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

function createServer(connection: Connection): McpServer {
  const server = new McpServer({ name: 'caldav-forwarder', version: '0.1.0' });
  const client = createClient(connection);

  server.registerTool('list_calendars', {
    description: 'List calendars available in the CalDAV account.',
    inputSchema: {},
  }, async () => {
    await client.login();
    const calendars = await client.fetchCalendars();
    return { content: [{ type: 'text', text: JSON.stringify(calendars) }] };
  });

  server.registerTool('list_events', {
    description: 'List events in a calendar, optionally within a time range.',
    inputSchema: toolInput,
  }, async ({ calendarUrl, start, end }) => {
    await client.login();
    const calendars = await client.fetchCalendars();
    const calendar = calendars.find((item) => item.url === (calendarUrl ?? connection.calendarUrl)) ?? calendars[0];
    if (!calendar) {
      throw new Error('No calendar was found. Provide calendarUrl in the connection token.');
    }
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: start && end ? { start, end } : undefined,
    });
    return { content: [{ type: 'text', text: JSON.stringify(objects) }] };
  });

  server.registerTool('get_event', {
    description: 'Read one event using its calendar object URL.',
    inputSchema: { eventUrl: z.string().url() },
  }, async ({ eventUrl }) => {
    await client.login();
    const response = await fetch(eventUrl, {
      headers: { Authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}` },
    });
    if (!response.ok) throw new Error(`CalDAV returned ${response.status}`);
    return { content: [{ type: 'text', text: await response.text() }] };
  });

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('CalDAV MCP Forwarder is running. Connect an MCP client at /mcp/<connection-token>.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (!url.pathname.startsWith('/mcp/')) return json({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'Use POST for the stateless MCP endpoint.' }, 405);

    try {
      const token = url.pathname.slice('/mcp/'.length);
      const connection = decodeConnectionToken(token);
      const server = createServer(connection);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return json({ error: message }, 400);
    }
  },
};
