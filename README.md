# MCP E‑commerce Demo (HTTP + Streamable MCP)

This is a minimal e‑commerce demo that uses an MCP server instead of a REST API. A React UI (Vite) talks directly to the MCP server over Streamable HTTP. PostgreSQL stores the data.

Highlights
- End‑to‑end flows: browse products, search/filter, shopping cart, checkout, recent orders.
- Optional assistant: natural language product discovery (no raw SQL surfaced to the user), with “add selected to cart”.
- Stock tracking: orders decrement stock; UI prevents adding more than available stock.
- Resettable demo database for easy re‑runs.

Demo workflow
- For a presenter‑friendly, step‑by‑step demo that exercises all features (including the Assistant), see: [DEMO_WORKFLOW.md](./DEMO_WORKFLOW.md)

## Prerequisites
- Docker and Docker Compose
- Node.js 20+ (only needed if you run the web dev server locally; not required when using Docker for web)

## Services and ports
- PostgreSQL: localhost:5432 (Docker)
- MCP server (HTTP): http://localhost:8000/mcp
- Web (dev with HMR): http://localhost:5173

## Quick start — dev profile (hot reload for server and web)
Runs the database, the MCP server in watch mode, and the Vite dev server.

1) Optional: enable the assistant with a model by exporting your key and (optionally) a model name in this shell before starting. These are passed through to the server container.
	- macOS/zsh
	  - `export OPENAI_API_KEY=sk-...`
	  - `export OPENAI_MODEL=gpt-4o-mini`  # optional; server defaults to gpt-4o-mini

2) Start dev services (db + server + web)
	- `docker compose --profile dev up -d --build postgres mcp-http-server-dev web-dev`

3) Open the app
	- http://localhost:5173 (the browser will connect to http://localhost:8000/mcp)

4) Develop
	- Edit files under `server/src` → server restarts automatically (tsx watch)
	- Edit files under `web/src` → browser hot‑reloads (Vite HMR)

To stop dev services later: `docker compose --profile dev down`

### Alternative: run web locally, server in Docker
Use this when you prefer to run Vite locally from `web/`, while keeping Postgres and the MCP server in containers.

1) From the repo root, start db + server
	- `docker compose --profile dev up -d --build postgres mcp-http-server-dev`

2) From `web/`, start Vite locally
	- `npm install`
	- `npm run dev`

Open http://localhost:5173. The UI will connect to http://localhost:8000/mcp.

## Production‑like run
Runs the MCP server in production mode and exposes it at :8000. Build the web app and serve the static files with any HTTP server.

1) Stop the dev profile (if running)
	- `docker compose --profile dev down`

2) Start DB + prod MCP server (optional: enable assistant)
	- `export OPENAI_API_KEY=sk-...`  # optional
	- `export OPENAI_MODEL=gpt-4o-mini`  # optional
	- `docker compose up -d --build postgres mcp-http-server`

3) Build the web app and serve static files
	- `npm --prefix web install`
	- `npm --prefix web run build`
	- Serve `web/dist` with any static server (e.g., `npx serve web/dist`), then open the page. The UI will use `http://localhost:8000/mcp`.

## Using the app (GUI)
1) Browse
	- “Featured” products on load; switch to Search to see the full catalog
	- Click a product name to open an info panel (description, price, stock, add‑to‑cart)
2) Search (top of page)
	- Filter by name, category, and a max price (in cents)
3) Cart
	- Add to cart from the list or info panel
	- Remove items; Checkout creates an order and decrements stock
4) Assistant (optional)
	- Open the Assistant (bottom‑right)
	- Try: “caps under $20”, “denim jackets under 100”, “canvas sneakers”
	- You’ll get a friendly one‑liner, updated product list, and “Add selected” with per‑item quantities
	- No raw SQL or JSON is shown

## Database
All schema and the full catalog seed now live in `db/init.sql` (idempotent). It creates tables, indexes, a unique name constraint, and seeds ~50 products across categories.

### Initialize or refresh the catalog
The init script is safe to re-run and will not create duplicates (it auto-deduplicates older data and enforces a case-insensitive unique index on product names).
- Run inside the Postgres container:
	- `docker compose exec -T postgres psql -U postgres -d app_db -f /docker-entrypoint-initdb.d/10-init.sql`

### Reset the demo data
Restore stock levels and clear all carts/orders.
- Copy and run the reset script:
  - `docker cp db/reset.sql $(docker compose ps -q postgres):/docker-entrypoint-initdb.d/99-reset.sql`
  - `docker compose exec -T postgres psql -U postgres -d app_db -f /docker-entrypoint-initdb.d/99-reset.sql`

### Recreate catalog after reset or data loss
- If you only ran the reset above, you’re done — it doesn’t remove products; it just restores stock and clears carts/orders.
- If products are missing (e.g., fresh DB volume), re‑apply the init script:
	- `docker compose exec -T postgres psql -U postgres -d app_db -f /docker-entrypoint-initdb.d/10-init.sql`
- Full rebuild from scratch (drops data and re‑seeds):
	- `docker compose down -v`  # removes the Postgres volume
	- `docker compose up -d --build postgres`  # runs init.sql automatically
	- If needed, re-run the init script inside the container (same command as above)

## Environment variables
- `OPENAI_API_KEY` (optional): Enables assistant features (NL → structured search). If not set, a lightweight heuristic still supports common queries.
- `OPENAI_MODEL` (optional): Defaults to `gpt-4o-mini` if unset.
  - When using Docker Compose, set these in your shell before `docker compose up`; they’re passed through to the server container.

## What’s in each folder
- `db/`
	- `init.sql`: full schema + indexes + unique names + full catalog seed (idempotent; auto-dedup for older data)
	- `reset.sql`: restores stock, clears orders/carts (for demos)
- `server/`
  - Node MCP server (Express + @modelcontextprotocol/sdk) with a Streamable HTTP endpoint (`/mcp`)
  - Tools (selected):
	 - `list.featured`, `list.categories`, `search.products`, `list.products`
	 - `cart.ensure`, `cart.view`, `cart.add_item`, `cart.remove_item`, `cart.checkout`
	 - `create.order` (Buy now)
	 - `assistant.search` (friendly NL → structured search, no raw SQL)
	 - `nl.query` (optional NL→SQL, fallback only)
- `web/`
  - React + Vite UI; MCP Streamable HTTP client; SSE parsing; cart and checkout UX

## Stock behavior
- Adding to cart is limited by current stock (including what’s already in the cart)
- Checkout and “Buy now” (create.order) lock rows, validate stock, and decrement stock atomically
- Out‑of‑stock items return clear errors; info panel shows “Out of stock” and disables add‑to‑cart

## Troubleshooting
- MCP 406 Not Acceptable
  - The client must send: `Accept: application/json, text/event-stream`
- Dev port conflicts (8000)
  - Dev profile uses `mcp-http-server-dev`; stop prod service first: `docker compose stop mcp-http-server`
- Assistant not available
  - Ensure `OPENAI_API_KEY` is set before starting the server, or rely on the built‑in heuristic
- Catalog looks small
  - Re‑apply the migration and/or run the reset script to restore stock and data
- Remove sample order
	- If your DB shows a pre‑created order, run the reset to clear orders: copy `db/reset.sql` into the container and execute it (see “Reset the demo data” above). New databases won’t create a sample order anymore.

## Notes
- This demo intentionally keeps the LLM path separate and opt‑in to control costs and ensure predictable UX.
- The UI never directly exposes raw SQL; `assistant.search` maps NL into safe, parameterized queries.
