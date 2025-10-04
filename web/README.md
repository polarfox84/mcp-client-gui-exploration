# MCP Client GUI — E‑commerce Demo (Web)

React + Vite client for the MCP server. The UI talks to the backend over Streamable HTTP (no REST).

- MCP server endpoint: http://localhost:8000/mcp
- Web dev server: http://localhost:5173 (Vite + HMR)

For end‑to‑end run instructions (Docker Compose, dev profile), see the repo root `README.md`. The notes below focus on the web app itself.

## Web app details
- Stack: React 18 + Vite + TypeScript
- Entry: `src/main.tsx`; root UI: `src/ui/App.tsx`
- MCP client: uses `@modelcontextprotocol/sdk` over Streamable HTTP; sends `Accept: application/json, text/event-stream` and parses SSE when present
- Tool discovery: on startup, the client lists tools and prefers high‑level domain tools (`list.featured`, `list.categories`, `search.products`, etc.)
- Cart UX: local state mirrors server state; adding items respects current stock (incl. items already in cart)
- Assistant: UI prefers `assistant.search` (model‑optional); `nl.query` is used only as a fallback and requires a model on the server

## Local web dev (optional)
Run Vite locally from this folder while the backend runs via Docker.

1) Start backend from repo root (see root README for the full command)
	- `docker compose --profile dev up -d --build postgres mcp-http-server-dev`

2) Start the web dev server here
	- `npm install`
	- `npm run dev`

Open http://localhost:5173. The UI connects to http://localhost:8000/mcp.

Tip: You can also run the web dev server in a container via the dev profile (`web-dev` service); see the root README for that flow.

## Features
- Browse featured products; full search by name, category, and max price
- Cart: add/remove items, checkout (orders decrement stock)
- Product info panel with description/price/stock
- Assistant drawer (Ask): natural‑language search that returns a friendly summary and results, with “Add selected” to cart

## Assistant and models
- Works without a model using a built‑in heuristic (common categories, keyword terms, “under $N” price phrases)
- If the server has `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`), intent extraction is more robust
- UI prefers `assistant.search`; `nl.query` requires a model and is used as a fallback only

## Notes
- The client auto‑discovers tools and falls back to `sql.query` only if absolutely necessary
- The client sends: `Accept: application/json, text/event-stream`
- No client‑side env vars are required; all secrets live on the server

## Troubleshooting
- Can’t connect: ensure the MCP server is running at :8000 and that you started the dev backend from the repo root
- Assistant disabled: `assistant.search` may be unavailable or the server may not expose tools; start the backend in dev mode or enable the model for `nl.query`
- Port conflicts: if a containerized web dev server is also running, stop it (compose) or stop the local `npm run dev` to avoid two servers on :5173