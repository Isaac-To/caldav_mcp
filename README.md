# CalDAV MCP Forwarder

A completely stateless [Model Context Protocol](https://modelcontextprotocol.io/) server that forwards calendar operations to a CalDAV server from Cloudflare Workers.

> **Status:** Functional first release. The Worker supports calendar discovery, event listing/search, event retrieval, creation, updates, deletion, and free/busy queries.

## Connect in three steps

1. Open `https://caldavmcp.anpc.work` in a browser.
2. Enter your CalDAV server, username, and app password. Leave **Calendar URL** blank to discover calendars automatically.
3. Click **Make secure token**, then copy the generated MCP URL or configuration into your AI assistant.

The public page creates encrypted tokens that expire after one day by default. Credentials are sent over HTTPS to the Worker for encryption and are never decoded in the browser. Rotate `CONNECTION_TOKEN_KEY` if tokens need to be revoked.

The assistant can list, search, read, create, update, and delete events, and query free/busy information. Every request is independent; no calendars, credentials, or sessions are stored.

## Security model

Do not place raw passwords, app passwords, or access tokens directly in a URL. URLs may be retained by browser history, reverse proxies, analytics systems, and access logs.

Connection tokens are encrypted AES-GCM values:

```text
POST https://caldavmcp.anpc.work/mcp/<encrypted-connection-token>
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

The Worker decrypts each token for one request and discards the connection details afterward. Tokens do not expire; rotate `CONNECTION_TOKEN_KEY` to revoke all tokens created with the previous key. Configure it as a Worker secret. The key must be URL-safe base64 containing a 128-, 192-, or 256-bit AES key.
The Worker decrypts each token for one request and discards the connection details afterward. Tokens expire by default; rotate `CONNECTION_TOKEN_KEY` to revoke all tokens created with the previous key. Event and free/busy URLs must belong to the configured CalDAV server. Configure it as a Worker secret. The key must be URL-safe base64 containing a 128-, 192-, or 256-bit AES key.

Prefer provider-specific app passwords or OAuth access tokens over a primary account password. Never commit tokens or credentials to this repository.

## Connecting an MCP client

After deploying the Worker, configure your MCP client with the Worker URL. The exact configuration varies by client, but the endpoint is:

```text
https://caldavmcp.anpc.work/mcp/<encrypted-connection-token>
```

For an MCP client configuration that accepts a remote HTTP server, use the endpoint as the server URL. For example:

```json
{
  "mcpServers": {
    "caldav": {
      "type": "http",
      "url": "https://caldavmcp.anpc.work/mcp/<encrypted-connection-token>"
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

## Tool output format

Tool responses use compact JSON with only information needed for the next action:

- Calendar lists contain `url`, plus available `displayName`, `description`, `timezone`, and `color`.
- Event lists and `get_event` contain `url`, optional `etag`, and the current iCalendar `data`.
- `create_event` returns the created event `url`.
- `update_event` returns the updated event `url`.
- `delete_event` returns the deleted event `url` and `deleted: true`.
- `get_free_busy` returns only the free/busy iCalendar `data`.

Responses do not include HTTP status codes, raw CalDAV metadata, or presentation formatting.

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

The Worker is configured as a Cloudflare Custom Domain at
`caldavmcp.anpc.work`. Wrangler creates the domain and certificate when the
zone is active in the same Cloudflare account. Set the required secret before
deploying:

```sh
npx wrangler secret put CONNECTION_TOKEN_KEY
npm run deploy
```

The domain must be active in Cloudflare DNS. Do not add a conflicting CNAME
record for `caldavmcp.anpc.work`; Custom Domains manage the DNS record.

Set the encryption key as a Cloudflare Worker secret:

```sh
npx wrangler secret put CONNECTION_TOKEN_KEY
```

For local development, create `.dev.vars` from `.dev.vars.example` and replace
the placeholder with a generated key. Wrangler loads `.dev.vars` automatically
when running `npm run dev`; do not commit that file.

```sh
cp .dev.vars.example .dev.vars
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Never put the encryption key in `wrangler.jsonc`, source code, or client configuration.

## Available tools

All tools operate on the calendar selected by `calendarUrl` in the token, or accept an explicit `calendarUrl` where appropriate.

| Tool | Purpose |
| --- | --- |
| `list_calendars` | Discover calendars in the account. |
| `list_events` | List events for a required `start`/`end` range. Without `calendarUrl`, searches all calendars. |
| `search_events` | Search event data by text. Without `calendarUrl`, searches all calendars. |
| `get_event` | Fetch an event by its object URL. |
| `create_event` | Create an event with summary, start, and end. |
| `update_event` | Update an event using its current iCalendar data and object URL. |
| `delete_event` | Delete an event, optionally supplying its ETag. |
| `get_free_busy` | Query free/busy data for a time range. |

Dates should be ISO 8601 strings, for example `2026-08-20T10:00:00Z`. Event updates require the current iCalendar `data` so unknown provider-specific properties are preserved.

### Tool behavior for agents

- Call `list_calendars` first when the available calendar URLs are unknown.
- `list_events` and `search_events` require `start` and `end`. An explicit `calendarUrl` selects one calendar. Without it, the token's configured calendar is used; if none is configured, all calendars are searched.
- `search_events` performs a case-insensitive text search over each event's iCalendar data, not only the event title.
- `get_event` requires the event's current HTTPS object URL.
- `create_event` requires `summary`, `start`, and `end`; calendar selection is explicit URL, token calendar, then the first available calendar.
- `update_event` requires the current event `data`; send only fields that should change because omitted fields are preserved.
- `delete_event` permanently removes an event. Confirm the deletion with the user first, and pass the current ETag when available.
- `get_free_busy` returns iCalendar free/busy data for the requested range and does not list event details.

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
