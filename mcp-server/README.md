# Rowsncolumns MCP Server

## Run locally (stdio)

```bash
yarn mcp:stdio
```

Use this mode for local MCP clients that spawn a command (for example Claude Desktop local MCP).

## Run as remote MCP (Streamable HTTP)

```bash
yarn mcp:http
```

Defaults:

- Host: `127.0.0.1`
- Port: `8787`
- MCP endpoint: `/mcp`
- Health endpoint: `/health`

Configure with environment variables:

- `MCP_HOST`
- `MCP_PORT`
- `MCP_PATH`
- `MCP_ALLOWED_HOSTS` (comma-separated)
- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `MCP_RESOURCE_MAX_BYTES`

## ShareDB environment

The MCP server reuses existing spreadsheet tooling and ShareDB access from `lib/chat`.

- `SHAREDB_URL` (default: `ws://localhost:8080`)
- `SHAREDB_COLLECTION` (default: `spreadsheets`)
- `SHAREDB_MCP_TOKEN_SECRET` (required for no-login MCP capability tokens)

## Exposed capabilities

- 30 spreadsheet tools (reused from `lib/chat/tools.ts`)
- Custom MCP tools:
  - `open_spreadsheet`
  - `spreadsheet_createDocument`
  - `spreadsheet_getContext`
- Resource templates:
  - `spreadsheet://{docId}`
  - `spreadsheet://{docId}/sheet/{sheetId}`

`open_spreadsheet` is registered as an MCP App tool and references
`ui://rowsncolumns/spreadsheet-view-v3.html` so compatible clients can render an
inline spreadsheet view.
