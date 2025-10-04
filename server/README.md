# MCP HTTP DB Server

Streamable HTTP MCP server that exposes database-backed tools for the e‑commerce demo. The client talks to this server directly over HTTP instead of a REST API.

- Endpoint: POST http://localhost:8000/mcp
- Protocol: MCP over Streamable HTTP (JSON or SSE). CORS is open for local development.
- Database: PostgreSQL (see repo root README for Docker Compose setup)

## Getting started

Prefer the root `README.md` for end‑to‑end dev with Docker Compose. If you want to run this server locally (Node on your machine):

1) Ensure Postgres is running and seeded (use Docker Compose from the repo root).
2) From this `server/` folder:

```
npm install
npm run dev
```

The server listens on http://localhost:8000 and serves MCP at POST http://localhost:8000/mcp.

Build and run (production mode):

```
npm run build
npm start
```

Tip: To run in Docker, use the Compose services `mcp-http-server` (prod) or `mcp-http-server-dev` (watch). See the repo root README for the exact commands.

## Environment variables

- DATABASE_URL (optional): PostgreSQL connection string
  - Default: `postgresql://postgres:password@localhost:5432/app_db`
- PORT (optional): HTTP port (default 8000)
- OPENAI_API_KEY (optional): Enables `assistant.search` to use a model and enables `nl.query`
- OPENAI_MODEL (optional): Model name for OpenAI (default `gpt-4o-mini`)

Notes:
- The assistant works without a model using a built‑in heuristic in `assistant.search`. The legacy `nl.query` always requires a model.

## Tools exposed

High‑level, safe tools (preferred by the UI):
- list.products() → `{ rows }` of products (id, name, description, price_cents, stock, category)
- list.categories() → `{ categories }`
- list.featured() → curated `{ rows }` for the home page
- list.orders({ limit=10 }) → `{ rows }` of recent orders
- search.products({ q?, category?, maxPriceCents? }) → `{ rows }`
- create.order({ productId, quantity=1 }) → `{ orderId }` (validates and decrements stock)
- cart.ensure() → `{ cartId }`
- cart.view() → `{ cartId, items, total_cents }`
- cart.add_item({ productId, quantity=1 }) → `{ cartId }` (respects stock, merges quantities)
- cart.remove_item({ productId }) → `{ removed: boolean }`
- cart.checkout() → `{ orderId }` (locks rows, validates, decrements stock)

Assistant tools:
- assistant.search({ question }) → `{ products, summary }`
  - If `OPENAI_API_KEY` is unset, falls back to a heuristic that understands common categories, name terms, and price phrases (e.g., "under 20").
- nl.query({ question }) → `{ sql, rows }`
  - Requires `OPENAI_API_KEY`; blocked if not configured. Intended as a demo/fallback only.

Low‑level/compat tools:
- sql.query({ sql }) → returns raw JSON array of rows
- db.query({ sql }) → returns `{ rows }` (compat wrapper)

## Endpoint and protocol

- Path: `POST /mcp`
- Body: JSON‑RPC 2.0 request (e.g., `initialize`, `tools/list`, `tools/call`)
- Headers: Clients should send `Accept: application/json, text/event-stream` to allow streaming.
- Session: The server exposes an `Mcp-Session-Id` header; clients may echo it back as `mcp-session-id` on subsequent calls.

Minimal example (tools/list):

```
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Responses may be returned as a single JSON payload or wrapped in SSE with a `data:` line containing the JSON.

## Development notes

- Source: `src/index.ts` (Express + @modelcontextprotocol/sdk)
- Watch mode uses `tsx` (`npm run dev`). Production build uses TypeScript (`npm run build`).
- CORS is permissive for local development: `origin: *`; exposed header `Mcp-Session-Id`.

## Troubleshooting

- 406 Not Acceptable: Ensure the client sends `Accept: application/json, text/event-stream`.
- DB connection errors: Check `DATABASE_URL` and that Postgres (and `app_db`) are running.
- Assistant unavailable:
  - `assistant.search` works without a model, but `nl.query` requires `OPENAI_API_KEY`.
- Stock/checkout errors: Messages like "Out of stock" or "Not enough stock" are returned when inventory is insufficient.

## Security

This server is for demo purposes only. It allows broad read access to the database via `sql.query` and uses a fixed customer id for cart/order tools. Do not expose publicly without proper authentication, authorization, and query hardening.