# CalDAV MCP Forwarder

A completely stateless [Model Context Protocol](https://modelcontextprotocol.io/) server that forwards calendar operations to a CalDAV server from Cloudflare Workers.

> **Status:** Functional first release. The Worker supports calendar discovery, event listing/search, event retrieval, creation, updates, deletion, and free/busy queries.

## What it does

This server lets an MCP-compatible AI assistant work with a CalDAV account without storing calendars, events, credentials, or sessions in this service.

Supported operations will include:

- List calendars
- List and search events
- Read an event
- Create an event
- Edit an event
- Delete an event
- Check availability and free/busy information as provider support allows

Each request is handled independently. The service does not use KV, D1, R2, Durable Objects, or a persistent session store.

## Security model

Do not place raw passwords, app passwords, or access tokens directly in a URL. URLs may be retained by browser history, reverse proxies, analytics systems, and access logs.

For local development, the connection format is a URL-safe base64 connection token:

```text
POST https://your-worker.example.com/mcp/<encrypted-connection-token>
```

The token represents connection details such as:

```json
{
  "serverUrl": "https://caldav.example.com",
  "calendarUrl": "https://caldav.example.com/calendars/user/work/",
  "username": "user@example.com",
  "password": "app-password",
  "expiresAt": 1797700000
}
```

The Worker decodes the token for the duration of one request and discards the values afterward. Base64 is encoding, not encryption. For production, use an AES-GCM token beginning with `v1.` and configure `CONNECTION_TOKEN_KEY` as a Worker secret. The token key must be a URL-safe base64 encoding of a 128-, 192-, or 256-bit key.

Prefer provider-specific app passwords or OAuth access tokens over a primary account password. Never commit tokens or credentials to this repository.

## Connecting an MCP client

After deploying the Worker, configure your MCP client with the Worker URL. The exact configuration varies by client, but the endpoint is:

```text
https://your-worker.example.com/mcp/<encrypted-connection-token>
```

For an MCP client configuration that accepts a remote HTTP server, use the endpoint as the server URL. For example:

```json
{
  "mcpServers": {
    "caldav": {
      "type": "http",
      "url": "https://your-worker.example.com/mcp/<encrypted-connection-token>"
    }
  }
}
```

Do not paste the example token above into a real client. Replace it with a token generated for the intended CalDAV account and calendar.

The assistant will be able to call tools such as:

- `list_calendars`
- `list_events`
- `search_events`
- `get_event`
- `create_event`
- `update_event`
- `delete_event`

Example requests an assistant could handle:

- “What is on my work calendar tomorrow?”
- “Create a dentist appointment next Tuesday at 10:00.”
- “Move my 3 PM meeting to Friday.”
- “Cancel the event titled ‘Project review’.”
- “Find all events mentioning the quarterly planning meeting.”

The assistant should confirm important destructive actions, especially event deletion, before calling the corresponding tool.

## Deployment

Install dependencies:

```sh
npm install
```

Run the Worker locally:

```sh
npm run dev
```

Type-check the project:

```sh
npm run typecheck
```

# Run unit tests
npm test

Deploy to Cloudflare Workers:

```sh
npx wrangler login
npm run deploy
```

Set the encryption key as a Cloudflare Worker secret:

```sh
npx wrangler secret put CONNECTION_TOKEN_KEY
```

Never put the encryption key in `wrangler.jsonc`, source code, or client configuration.

## Available tools

All tools operate on the calendar selected by `calendarUrl` in the token, or accept an explicit `calendarUrl` where appropriate.

| Tool | Purpose |
| --- | --- |
| `list_calendars` | Discover calendars in the account. |
| `list_events` | List events for a required `start`/`end` range. |
| `search_events` | Search returned event data by text. |
| `get_event` | Fetch an event by its object URL. |
| `create_event` | Create an event with summary, start, and end. |
| `update_event` | Update an event using its current iCalendar data and object URL. |
| `delete_event` | Delete an event, optionally supplying its ETag. |
| `get_free_busy` | Query free/busy data for a time range. |

Dates should be ISO 8601 strings, for example `2026-08-20T10:00:00Z`. Event updates require the current iCalendar `data` so unknown provider-specific properties are preserved.

## Stateless request flow

```text
MCP client
   |
   | POST /mcp/<encrypted-token>
   v
Cloudflare Worker
   | decrypt token in memory
   | create request-scoped CalDAV client
   | perform one operation
   | discard credentials and response data
   v
CalDAV server
```

No calendar data or MCP session state is retained by this Worker. The request body, credentials, and CalDAV response exist only during the request.

## Provider notes

CalDAV implementations differ. You may need an app password or provider-specific endpoint:

- **Nextcloud:** usually supports app passwords and calendar collection URLs.
- **Fastmail:** use an app-specific password and the CalDAV endpoint provided by Fastmail.
- **iCloud:** generally requires an app-specific password and the account’s CalDAV endpoint.
- **Google Calendar:** native CalDAV support is limited; use Google’s API instead if CalDAV compatibility is insufficient.

Always test calendar discovery, recurring events, time zones, attendees, ETags, and deletion behavior with the target provider.

## Technology

- Cloudflare Workers
- TypeScript
- `@modelcontextprotocol/sdk`
- `tsdav`
- `ical.js`
- `zod`

## Limitations

The service forwards requests and does not become a calendar synchronization service. It does not maintain a local event index, deduplicate events across calendars, or queue work for later execution. If a CalDAV provider is unavailable, the request fails without being retried from persistent storage.
