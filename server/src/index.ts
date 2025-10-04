import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import OpenAI from 'openai';

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS for browser-based MCP clients
app.use(
  cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id']
  })
);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/app_db';
const pool = new Pool({ connectionString: DATABASE_URL });

function getServer() {
  const server = new McpServer({ name: 'mcp-http-db-server', version: '0.1.0' });

  // Shared helper for product search
  async function runProductSearch({ q, category, categories, terms, maxPriceCents }: { q?: string; category?: string; categories?: string[]; terms?: string[]; maxPriceCents?: number }) {
    const client = await pool.connect();
    try {
      const params: any[] = [];
      const orParts: string[] = [];
      // Terms: match by name (case-insensitive substring)
      const termList = terms && terms.length ? terms : (q && q.trim() ? q.trim().toLowerCase().split(/\s+/) : []);
      if (termList && termList.length) {
        const termClauses: string[] = [];
        for (const t of termList) {
          params.push(`%${t}%`);
          termClauses.push(`lower(name) LIKE $${params.length}`);
        }
        if (termClauses.length) orParts.push(`(${termClauses.join(' OR ')})`);
      }
      // Categories: match any of the provided categories
      const catList = (categories && categories.length ? categories : (category ? [category] : [])).filter(Boolean);
      if (catList.length) {
        const catClauses: string[] = [];
        for (const c of catList) {
          params.push(c);
          catClauses.push(`lower(category) = lower($${params.length})`);
        }
        if (catClauses.length) orParts.push(`(${catClauses.join(' OR ')})`);
      }
      // Combine OR groups; apply price as AND
      const whereParts: string[] = [];
      if (orParts.length) whereParts.push(`(${orParts.join(' OR ')})`);
      if (maxPriceCents && Number.isFinite(maxPriceCents)) {
        params.push(maxPriceCents);
        whereParts.push(`price_cents <= $${params.length}`);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      const sql = `SELECT id, name, description, price_cents, stock, category FROM products ${where} ORDER BY name LIMIT 100`;
      const res = await client.query(sql, params);
      return res.rows;
    } finally { client.release(); }
  }

  // Tool: sql.query
  server.registerTool(
    'sql.query',
    {
      title: 'SQL Query',
      description: 'Execute SQL against the configured PostgreSQL database',
      inputSchema: { sql: z.string() }
    },
    async ({ sql }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(sql);
        return {
          content: [
            { type: 'text', text: JSON.stringify(res.rows) }
          ]
        };
      } finally {
        client.release();
      }
    }
  );

  // Compat alias: db.query
  server.registerTool(
    'db.query',
    {
      title: 'DB Query',
      description: 'Execute SQL (alias of sql.query)',
      inputSchema: { sql: z.string() }
    },
    async ({ sql }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(sql);
        return {
          content: [
            { type: 'text', text: JSON.stringify({ rows: res.rows }) }
          ]
        };
      } finally {
        client.release();
      }
    }
  );

  // High-level tools (safe, non-LLM): list products
  server.registerTool(
    'list.products',
    {
      title: 'List Products',
      description: 'List all products with price and stock',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT id, name, description, price_cents, stock, category FROM products ORDER BY id');
        return { content: [{ type: 'text', text: JSON.stringify({ rows: res.rows }) }] };
      } finally { client.release(); }
    }
  );

  // Product categories
  server.registerTool(
    'list.categories',
    {
      title: 'List Categories',
      description: 'List distinct product categories',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT DISTINCT category FROM products ORDER BY category');
        return { content: [{ type: 'text', text: JSON.stringify({ categories: res.rows.map(r => r.category) }) }] };
      } finally { client.release(); }
    }
  );

  // Product search by name and/or category
  server.registerTool(
    'search.products',
    {
      title: 'Search Products',
      description: 'Search products by name and/or category with optional price ceiling',
      inputSchema: { q: z.string().optional().default(''), category: z.string().optional(), maxPriceCents: z.number().int().positive().optional() }
    },
    async ({ q, category, maxPriceCents }) => {
      const rows = await runProductSearch({ q, category, maxPriceCents });
      return { content: [{ type: 'text', text: JSON.stringify({ rows }) }] };
    }
  );

  // Featured products: a small curated list for home page
  server.registerTool(
    'list.featured',
    {
      title: 'List Featured Products',
      description: 'Return a short list of featured products for the home page',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        const res = await client.query("SELECT id, name, description, price_cents, stock, category FROM products WHERE name IN ('Classic Tee','Canvas Sneakers','Denim Jacket','Classic Cap','Chino Pants') ORDER BY name");
        return { content: [{ type: 'text', text: JSON.stringify({ rows: res.rows }) }] };
      } finally { client.release(); }
    }
  );

  // High-level tools (safe, non-LLM): list recent orders
  server.registerTool(
    'list.orders',
    {
      title: 'List Recent Orders',
      description: 'List recent orders',
      inputSchema: { limit: z.number().int().min(1).max(100).default(10) }
    },
    async ({ limit }) => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT id, customer_id, created_at FROM orders ORDER BY id DESC LIMIT $1', [limit ?? 10]);
        return { content: [{ type: 'text', text: JSON.stringify({ rows: res.rows }) }] };
      } finally { client.release(); }
    }
  );

  // High-level tools (safe, non-LLM): create order and add item
  server.registerTool(
    'create.order',
    {
      title: 'Create Order',
      description: 'Create an order for customer 1 with a product and quantity',
      inputSchema: { productId: z.number().int().positive(), quantity: z.number().int().positive().default(1) }
    },
    async ({ productId, quantity }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const qty = quantity ?? 1;
        // Lock product row and check stock
        const prod = await client.query('SELECT price_cents, stock FROM products WHERE id=$1 FOR UPDATE', [productId]);
        if (!prod.rows.length) throw new Error('Product not found');
        const price = Number(prod.rows[0].price_cents);
        const stock = Number(prod.rows[0].stock);
        if (stock < qty) throw new Error('Out of stock');
        const ord = await client.query('INSERT INTO orders (customer_id) VALUES (1) RETURNING id');
        const orderId = ord.rows[0].id as number;
        await client.query('INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES ($1,$2,$3,$4)', [orderId, productId, qty, price]);
        await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [qty, productId]);
        await client.query('COMMIT');
        return { content: [{ type: 'text', text: JSON.stringify({ orderId }) }] };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }
  );

  // Cart: ensure an active cart for customer 1
  server.registerTool(
    'cart.ensure',
    {
      title: 'Ensure Active Cart',
      description: 'Ensure there is an active cart for customer 1 and return its id',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        const existing = await client.query("SELECT id FROM carts WHERE customer_id=1 AND status='active' LIMIT 1");
        if (existing.rows.length) {
          return { content: [{ type: 'text', text: JSON.stringify({ cartId: existing.rows[0].id }) }] };
        }
  const created = await client.query("INSERT INTO carts (customer_id, status) VALUES (1, 'active') RETURNING id");
        return { content: [{ type: 'text', text: JSON.stringify({ cartId: created.rows[0].id }) }] };
      } finally { client.release(); }
    }
  );

  // Cart: add item
  server.registerTool(
    'cart.add_item',
    {
      title: 'Add Item to Cart',
      description: 'Add a product to the active cart for customer 1',
      inputSchema: { productId: z.number().int().positive(), quantity: z.number().int().positive().default(1) }
    },
    async ({ productId, quantity }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cart = await client.query("SELECT id FROM carts WHERE customer_id=1 AND status='active' LIMIT 1");
        const cartId = cart.rows.length ? cart.rows[0].id : (await client.query("INSERT INTO carts (customer_id, status) VALUES (1, 'active') RETURNING id")).rows[0].id;
        const qty = quantity ?? 1;
        // Check stock against existing quantity in cart
        const prod = await client.query('SELECT price_cents, stock FROM products WHERE id=$1', [productId]);
        if (!prod.rows.length) throw new Error('Product not found');
        const price = Number(prod.rows[0].price_cents);
        const stock = Number(prod.rows[0].stock);
        const existing = await client.query('SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cartId, productId]);
        const existingQty = existing.rows.length ? Number(existing.rows[0].quantity) : 0;
        if (existingQty + qty > stock) throw new Error('Not enough stock');
        await client.query(
          'INSERT INTO cart_items (cart_id, product_id, quantity, price_cents) VALUES ($1,$2,$3,$4)\n          ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity',
          [cartId, productId, qty, price]
        );
        await client.query('COMMIT');
        return { content: [{ type: 'text', text: JSON.stringify({ cartId }) }] };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }
  );

  // Cart: view
  server.registerTool(
    'cart.view',
    {
      title: 'View Cart',
      description: 'View items in the active cart for customer 1 with totals',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        const cart = await client.query("SELECT id FROM carts WHERE customer_id=1 AND status='active' LIMIT 1");
        if (!cart.rows.length) return { content: [{ type: 'text', text: JSON.stringify({ cart: null, items: [], total_cents: 0 }) }] };
        const cartId = cart.rows[0].id as number;
        const items = await client.query(
          `SELECT ci.product_id, p.name, ci.quantity, ci.price_cents, (ci.quantity * ci.price_cents) as line_total
           FROM cart_items ci JOIN products p ON p.id = ci.product_id
           WHERE ci.cart_id=$1 ORDER BY p.name`, [cartId]
        );
        const total = items.rows.reduce((s, r) => s + Number(r.line_total), 0);
        return { content: [{ type: 'text', text: JSON.stringify({ cartId, items: items.rows, total_cents: total }) }] };
      } finally { client.release(); }
    }
  );

  // Cart: checkout
  server.registerTool(
    'cart.checkout',
    {
      title: 'Checkout Cart',
      description: 'Create an order from the active cart and mark it checked_out',
      inputSchema: {}
    },
    async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cart = await client.query("SELECT id FROM carts WHERE customer_id=1 AND status='active' LIMIT 1");
        if (!cart.rows.length) throw new Error('No active cart');
        const cartId = cart.rows[0].id as number;
        const items = await client.query('SELECT product_id, quantity, price_cents FROM cart_items WHERE cart_id=$1', [cartId]);
        if (!items.rows.length) throw new Error('Cart is empty');
        // Check stock for all items and lock rows
        for (const it of items.rows) {
          const p = await client.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE', [it.product_id]);
          const stock = Number(p.rows[0]?.stock ?? 0);
          if (stock < Number(it.quantity)) throw new Error('Out of stock');
        }
        const ord = await client.query('INSERT INTO orders (customer_id) VALUES (1) RETURNING id');
        const orderId = ord.rows[0].id as number;
        for (const it of items.rows) {
          await client.query('INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES ($1,$2,$3,$4)', [orderId, it.product_id, it.quantity, it.price_cents]);
          await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [it.quantity, it.product_id]);
        }
        await client.query("UPDATE carts SET status='checked_out' WHERE id=$1", [cartId]);
        await client.query('COMMIT');
        return { content: [{ type: 'text', text: JSON.stringify({ orderId }) }] };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }
  );

  // Cart: remove item
  server.registerTool(
    'cart.remove_item',
    {
      title: 'Remove Item from Cart',
      description: 'Remove a product line from the active cart for customer 1',
      inputSchema: { productId: z.number().int().positive() }
    },
    async ({ productId }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cart = await client.query("SELECT id FROM carts WHERE customer_id=1 AND status='active' LIMIT 1");
        if (!cart.rows.length) { await client.query('COMMIT'); return { content: [{ type: 'text', text: JSON.stringify({ removed: false }) }] }; }
        const cartId = cart.rows[0].id as number;
        const res = await client.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cartId, productId]);
        await client.query('COMMIT');
  return { content: [{ type: 'text', text: JSON.stringify({ removed: (res.rowCount ?? 0) > 0 }) }] };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }
  );

  // Optional: NL → SQL using OpenAI (set OPENAI_API_KEY)
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

  async function getSchemaSummary(): Promise<string> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `select table_name, column_name, data_type
         from information_schema.columns
         where table_schema = 'public'
         order by table_name, ordinal_position`
      );
      const byTable: Record<string, Array<{ column_name: string; data_type: string }>> = {};
      for (const row of res.rows) {
        const t = row.table_name as string;
        if (!byTable[t]) byTable[t] = [];
        byTable[t].push({ column_name: row.column_name, data_type: row.data_type });
      }
      return Object.entries(byTable)
        .map(([t, cols]) => `${t}(${cols.map(c => `${c.column_name}:${c.data_type}`).join(', ')})`)
        .join('\n');
    } finally {
      client.release();
    }
  }

  async function getKnownCategories(): Promise<string[]> {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT DISTINCT category FROM products ORDER BY category');
      return res.rows.map(r => String(r.category));
    } finally {
      client.release();
    }
  }

  server.registerTool(
    'assistant.search',
    {
      title: 'Assistant Product Search',
      description: 'Understand a shopping query and return matching products (no raw SQL)',
      inputSchema: { question: z.string() }
    },
    async ({ question }) => {
      // Fallback heuristic if no model: try to infer category and price
      async function heuristicIntent(qText: string) {
        const cats = await getKnownCategories();
        const syn = getCategorySynonyms();
        const lc = qText.toLowerCase();
        // Collect categories (canonical names)
        const foundSet = new Set<string>();
        for (const [word, cat] of Object.entries(syn)) {
          if (lc.includes(word)) foundSet.add(cat);
        }
        for (const cat of cats) {
          if (lc.includes(cat.toLowerCase())) foundSet.add(cat);
        }
        const foundCats = Array.from(foundSet);
        const priceMatch = qText.match(/\$\s*(\d+)|under\s*(\d+)/i);
        const dollars = priceMatch ? Number(priceMatch[1] || priceMatch[2]) : undefined;
        const maxPriceCents = dollars ? Math.round(dollars * 100) : undefined;
        // Normalize and strip punctuation
        let text = qText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        // Remove category words and synonyms
        text = text.replace(/\b(t-?shirts?|tees?|hats?|caps?|beanies?|shoes?|sneakers?|trainers?|boots?|slides?|hoodies?|jackets?|pants?|trousers?|jeans?|shorts?|socks?|accessor(?:y|ies)|belts?|scarves?|sunglasses?|totes?|backpacks?)\b/gi, ' ');
        // Stopwords and fillers
        const stop = new Set([
          'a','an','and','or','to','by','from','at','on','in','for','of','with','the','this','that','these','those',
          'show','me','all','please','list','find','display','products','items','what','whats','what\'s','do','you','have','available','catalog','inventory','offer','offers','offering',
          'under','below','less','than','any','are','is','there','can','could','would','looking','look','showcase','catalog'
        ]);
        const filteredTokens = text.split(/\s+/)
          .map(w => w.trim())
          .filter(w => w && !stop.has(w) && !(w.length < 3) && !/^\d+$/.test(w));
        // Treat remaining tokens as individual terms for OR search
        const terms = filteredTokens;
        return { terms, categories: foundCats, maxPriceCents };
      }

      let intent: { q?: string; category?: string; categories?: string[]; terms?: string[]; maxPriceCents?: number } = {};
      if (!openai) {
        intent = await heuristicIntent(question);
      } else {
        const cats = await getKnownCategories();
        const system = `Extract structured search parameters from a shopping question.
Return strictly a compact JSON object with keys: terms (array of strings, optional), categories (array of strings, optional, choose from: ${cats.join(', ')}), maxPriceCents (integer optional).
Rules:
- If a price like "$25" or "under 25" appears, set maxPriceCents to dollars*100.
- Category should match one of the known categories exactly (case-insensitive).
 - For generic phrases ("show all", "what do you have"), do not set terms. Only add terms for meaningful keywords (e.g., "canvas", "runner", "denim").`;
        const user = `Question: ${question}\nJSON:`;
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          temperature: 0,
          messages: [ { role: 'system', content: system }, { role: 'user', content: user } ]
        });
        const text = completion.choices?.[0]?.message?.content ?? '{}';
        try { intent = JSON.parse(Array.isArray(text) ? text.map(x => typeof x === 'string' ? x : '').join('') : text) as any; } catch { intent = await heuristicIntent(question); }
      }

      const rows = await runProductSearch(intent);
      // Build a concise, customer-friendly summary
      const joinNice = (arr: string[]) => arr.length <= 2 ? arr.join(' and ') : `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
      const cats = intent.categories && intent.categories.length ? intent.categories : (intent.category ? [intent.category] : []);
      const catsText = cats.length ? ` in ${joinNice(cats)}` : '';
      const priceText = intent.maxPriceCents ? ` under $${((intent.maxPriceCents)/100).toFixed(2)}` : '';
      const termsText = (intent.terms && intent.terms.length) ? ` for ${joinNice(intent.terms)}` : '';
      const summary = `I found ${rows.length} item${rows.length===1?'':'s'}${catsText}${priceText}${termsText}.`;
      return { content: [{ type: 'text', text: JSON.stringify({ products: rows, summary }) }] };
    }
  );

  server.registerTool(
    'nl.query',
    {
      title: 'Natural Language Query',
      description: 'Answer a question by generating SQL from natural language and executing it',
      inputSchema: { question: z.string() }
    },
    async ({ question }) => {
      if (!openai) {
        return { content: [{ type: 'text', text: 'Error: OPENAI_API_KEY not set on server' }], isError: true };
      }
  const schema = await getSchemaSummary();
  const categories = await getKnownCategories();
  const system = `You are a SQL expert. Given a PostgreSQL schema and a user question, write a single safe SQL query.
Rules:
- Prefer SELECT queries.
- Use only the provided tables/columns.
- Do not use DROP/DELETE/UPDATE/ALTER/TRUNCATE.
- Do not end with a semicolon.
 - Treat text comparisons as case-insensitive. For text columns like name or category, prefer ILIKE or lower(col) = lower(value).
 - Known categories (strings): ${categories.join(', ')}.
Schema:\n${schema}`;
      const prompt = `Question: ${question}\nSQL:`;
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      });
      const text = completion.choices?.[0]?.message?.content ?? '';
      const sqlRaw = (Array.isArray(text) ? text.map(p => (typeof p === 'string' ? p : '')).join('\n') : text) as string;
      // Extract code block if present
      const match = sqlRaw.match(/```sql\s*([\s\S]*?)```/i) || sqlRaw.match(/```\s*([\s\S]*?)```/i);
      const sql = (match ? match[1] : sqlRaw).trim();
      if (/\b(drop|delete|update|alter|truncate)\b/i.test(sql)) {
        return { content: [{ type: 'text', text: `Blocked potentially destructive SQL: ${sql}` }], isError: true };
      }
      const client = await pool.connect();
      try {
        const res = await client.query(sql);
        return { content: [{ type: 'text', text: JSON.stringify({ sql, rows: res.rows }, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error executing SQL: ${err.message}\nSQL: ${sql}` }], isError: true };
      } finally {
        client.release();
      }
    }
  );

  // Sample prompt (for LLM clients like Claude): translate question to SQL
  server.registerPrompt(
    'sql-from-question',
    {
      title: 'SQL from NL question',
      description: 'Given a question, write safe SQL using the current DB schema',
      argsSchema: { question: z.string() }
    },
    async ({ question }) => {
      const schema = await getSchemaSummary();
      return {
        description: 'Translate question to safe SQL for PostgreSQL',
        messages: [
          {
            role: 'assistant',
            content: {
              type: 'text',
              text: `You are a SQL expert for PostgreSQL. Use only these tables/columns:\n${schema}\nRules: Prefer SELECT, avoid destructive statements. Return only SQL code.`
            }
          },
          {
            role: 'user',
            content: { type: 'text', text: `Question: ${question}\nSQL:` }
          }
        ]
      } as any;
    }
  );

  return server;
}

function getCategorySynonyms(): Record<string, string> {
  // Map lowercase words to canonical category names
  return {
    // Hats
    'hat': 'Hats', 'hats': 'Hats', 'cap': 'Hats', 'caps': 'Hats', 'beanie': 'Hats', 'beanies': 'Hats', 'visor': 'Hats', 'bucket': 'Hats',
    // Shoes
    'shoe': 'Shoes', 'shoes': 'Shoes', 'sneaker': 'Shoes', 'sneakers': 'Shoes', 'trainer': 'Shoes', 'trainers': 'Shoes', 'boots': 'Shoes', 'slides': 'Shoes',
    // T-Shirts
    'tshirt': 'T-Shirts', 't-shirts': 'T-Shirts', 't-shirt': 'T-Shirts', 'tee': 'T-Shirts', 'tees': 'T-Shirts', 'shirt': 'T-Shirts', 'shirts': 'T-Shirts',
    // Hoodies
    'hoodie': 'Hoodies', 'hoodies': 'Hoodies',
    // Pants
    'pants': 'Pants', 'trousers': 'Pants', 'jeans': 'Pants',
    // Shorts
    'shorts': 'Shorts', 'swim': 'Shorts', 'trunks': 'Shorts',
    // Socks
    'socks': 'Socks',
    // Jackets
    'jacket': 'Jackets', 'jackets': 'Jackets', 'windbreaker': 'Jackets', 'puffer': 'Jackets', 'rain': 'Jackets',
    // Accessories
    'accessory': 'Accessories', 'accessories': 'Accessories', 'belt': 'Accessories', 'belts': 'Accessories', 'scarf': 'Accessories', 'scarves': 'Accessories', 'sunglasses': 'Accessories', 'tote': 'Accessories', 'totes': 'Accessories', 'backpack': 'Accessories', 'backpacks': 'Accessories', 'daypack': 'Accessories'
  };
}

// Stateless Streamable HTTP endpoint: new transport/server per request, returns JSON (no SSE)
app.post('/mcp', async (req: express.Request, res: express.Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = getServer();
    res.on('close', () => {
      try { transport.close(); server.close(); } catch {}
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Error handling /mcp request', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

const port = parseInt(process.env.PORT || '8000', 10);
app.listen(port, () => {
  console.log(`MCP HTTP DB server listening on http://0.0.0.0:${port}`);
});
