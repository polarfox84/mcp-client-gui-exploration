# Self‑serve Demo — MCP E‑commerce (HTTP + Streamable MCP)

Before you start
- Follow the setup in the root [README.md](./README.md) to bring up Postgres, the MCP server, and the web app.
- Open http://localhost:5173 in your browser. Ensure the catalog migration has been applied (per README) so you see the full product list.
- Optional: Set up `OPENAI_API_KEY` on the server to make the Assistant smarter. The Assistant also works without a model via a built‑in heuristic.

Estimated time: 8–12 minutes.

## 1) Explore Featured products
- Action: Load the page; you should see a list of Featured items.
- Observe: Each product shows name, price, and stock.
- What this demonstrates: The UI discovers and calls high‑level tools like `list.featured` over MCP (no REST).

## 2) Open a Product details panel
- Action: Click a product name (e.g., “Denim Jacket”).
- Observe: A panel shows description, price, current stock, and an “Add to cart” button. If stock is 0, add is disabled.
- What this demonstrates: Live product info; stock awareness in the UI.

## 3) Search by name
- Action: Switch to Search and type “Denim”.
- Observe: Results narrow to products with “Denim” in the name.
- What this demonstrates: `search.products` with free‑text filtering.

## 4) Filter by Category and Max price
- Action: Set Category to “Hats” and Max price to 2000 (=$20.00).
- Observe: Only hats under $20 appear (e.g., “Classic Cap”, “Beanie”).
- What this demonstrates: Combined filters (category + price ceiling) via safe, parameterized queries.

## 5) Add items to the Cart
- Action: From the results, add 2× “Classic Cap” and 1× “Beanie”. Then open the Cart.
- Observe: Cart shows line items, unit prices, line totals, and a grand total.
- What this demonstrates: Server‑backed cart state with item aggregation.

## 6) Remove an item
- Action: In the Cart, remove the “Beanie” line.
- Observe: The totals update; Beanie is removed.
- What this demonstrates: Cart mutations (`cart.remove_item`) reflected instantly.

## 7) Stock guardrails
- Action: Find an item with moderate stock (e.g., “Puffer Jacket”). Try adding more than the available stock (including what’s already in your cart).
- Observe: The app prevents over‑adding and/or shows a clear error.
- What this demonstrates: Stock enforcement across add‑to‑cart operations.

## 8) Checkout
- Action: With at least one item in your cart, click “Checkout”.
- Observe: You see a success message; the cart is cleared. If you revisit the product, stock has decreased.
- What this demonstrates: Atomic checkout that validates and decrements stock (`cart.checkout`).

## 9) Assistant — natural language discovery (model optional)
- Action: Open the Assistant (bottom‑right) and ask: “caps under $20”.
- Observe: A friendly summary (e.g., “I found N items in Hats under $20…”) and results that match your intent.
- What this demonstrates: NL → structured search via `assistant.search`. Without a model, a heuristic parses category/terms/price; with a model, intent extraction is more robust.

## 10) Assistant — Add selected to Cart
- Action: In the Assistant results, select a couple of items (e.g., “Classic Cap”, “Visor”), set per‑item quantities, and click “Add selected”.
- Observe: The Cart updates; quantities respect current stock.
- What this demonstrates: End‑to‑end flow from NL query → selection → cart updates.

## 11) Assistant — follow‑up query
- Action: Ask: “denim jackets under 100”.
- Observe: Results focus on “Jackets” with a $100 cap; optionally add one to your cart and checkout again.
- What this demonstrates: Conversational refinement of search intent.

## 12) Optional — recent orders
- Action: If the UI shows recent orders, navigate there to see your latest order.
- What this demonstrates: Read‑only order listing (`list.orders`). If not present in the UI, you can skip this step.

## Reset and replay
- If you’d like to rerun the demo from a clean state, follow the “Reset the demo data” section in the root README. It clears carts/orders and restores stock without removing products.

## Quick troubleshooting
- Can’t connect? Ensure the MCP server is up at http://localhost:8000/mcp (see README dev profile).
- Assistant disabled? Set `OPENAI_API_KEY` before starting the server or restart the dev server after setting it. The heuristic still supports common queries if no key is set.
- Small catalog? Re‑apply the catalog migration per README to seed the full list.
