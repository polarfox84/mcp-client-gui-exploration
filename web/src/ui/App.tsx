import React, { useEffect, useMemo, useRef, useState } from 'react'

type MCPResponse = { jsonrpc: '2.0'; id: number | string | null; result?: any; error?: { code: number; message: string; data?: any } }

type Product = { id: number; name: string; description?: string | null; price_cents: number; stock: number; category?: string }
type Order = { id: number; customer_id: number; created_at: string }

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export function App() {
  const [connected, setConnected] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [queryTool, setQueryTool] = useState<string | null>(null)
  const [nlTool, setNlTool] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [productTitle, setProductTitle] = useState<string>('No products')
  const [categories, setCategories] = useState<string[]>([])
  const [searchQ, setSearchQ] = useState<string>('')
  const [searchCategory, setSearchCategory] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<string>('')
  const [orders, setOrders] = useState<Order[]>([])
  const [cart, setCart] = useState<{ cartId: number; items: Array<{ product_id: number; name: string; quantity: number; price_cents: number; line_total: number }>; total_cents: number } | null>(null)
  const [question, setQuestion] = useState('')
  const [nlResult, setNlResult] = useState<string | null>(null)
  const [assistantSummary, setAssistantSummary] = useState<string | null>(null)
  const [assistantProducts, setAssistantProducts] = useState<Product[] | null>(null)
  const [assistantSelect, setAssistantSelect] = useState<Record<number, number>>({})
  const [chatOpen, setChatOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState<null | Product>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const idRef = useRef(1)

  const baseUrl = useMemo(() => {
    const url = new URL(window.location.href)
    const httpProto = url.protocol === 'https:' ? 'https:' : 'http:'
    return `${httpProto}//${url.hostname}:8000`
  }, [])

  useEffect(() => {
    let cancelled = false

    async function rpcSSE(method: string, params?: any): Promise<MCPResponse> {
      const id = idRef.current++
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      }
      if (sessionIdRef.current) headers['mcp-session-id'] = sessionIdRef.current
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
      })
      const sid = res.headers.get('Mcp-Session-Id')
      if (sid) sessionIdRef.current = sid
      const text = await res.text()
      // Parse minimal SSE: look for the first data: line and parse it as JSON
      const dataLine = text.split('\n').find(line => line.startsWith('data: ')) || text
      const jsonStr = dataLine.startsWith('data: ') ? dataLine.slice(6) : dataLine
      return JSON.parse(jsonStr) as MCPResponse
    }

    ;(async () => {
      try {
        const init = await rpcSSE('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-client-gui', version: '0.1.0' } })
        if (init.error) throw new Error(init.error.message)
        if (cancelled) return
        setConnected(true)
        setInitialized(true)
        try {
          const toolsRes = await rpcSSE('tools/list')
          const tools: Array<{ name: string }> = (toolsRes.result?.tools) ?? toolsRes.result ?? []
          // Prefer high-level tools; fall back to sql
          const listProducts = tools.find(t => t.name === 'list.products')?.name
          const listFeatured = tools.find(t => t.name === 'list.featured')?.name
          const listCategories = tools.find(t => t.name === 'list.categories')?.name
          const searchProducts = tools.find(t => t.name === 'search.products')?.name
          const assistantSearch = tools.find(t => t.name === 'assistant.search')?.name
          const listOrders = tools.find(t => t.name === 'list.orders')?.name
          const createOrder = tools.find(t => t.name === 'create.order')?.name
          const sqlQuery = tools.find(t => /^(sql\.query|db\.query)$/i.test(t.name))?.name
          const cartView = tools.find(t => t.name === 'cart.view')?.name
          const cartAdd = tools.find(t => t.name === 'cart.add_item')?.name
          const cartCheckout = tools.find(t => t.name === 'cart.checkout')?.name
          const cartRemove = tools.find(t => t.name === 'cart.remove_item')?.name
          setQueryTool(listProducts || sqlQuery || null)
          const nl = tools.map(t => t.name).find(n => /nl\.query/i.test(n)) || null
          setNlTool(nl)
          // Cache names for actions
          ;(window as any).__TOOLS__ = { listProducts, listFeatured, listCategories, searchProducts, assistantSearch, listOrders, createOrder, sqlQuery, cartView, cartAdd, cartCheckout, cartRemove }
        } catch {
          setQueryTool('sql.query')
          setNlTool(null)
        }
      } catch (e: any) {
        setError('Failed to connect to MCP server')
        setConnected(false)
      }
    })()

    return () => { cancelled = true }
  }, [baseUrl])

  // Ensure the assistant input is empty whenever the drawer opens
  useEffect(() => {
    if (chatOpen) setQuestion('')
  }, [chatOpen])

  async function rpc<T = any>(method: string, params?: any): Promise<T> {
    const id = idRef.current++
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    }
    if (sessionIdRef.current) headers['mcp-session-id'] = sessionIdRef.current
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
    const sid = res.headers.get('Mcp-Session-Id')
    if (sid) sessionIdRef.current = sid
    const text = await res.text()
    const dataLine = text.split('\n').find(line => line.startsWith('data: ')) || text
    const jsonStr = dataLine.startsWith('data: ') ? dataLine.slice(6) : dataLine
    const data: MCPResponse = JSON.parse(jsonStr)
    if (data.error) throw new Error(data.error.message)
    return data.result as T
  }

  async function runQuery<T = any>(sql: string): Promise<T> {
    if (!queryTool) throw new Error('No SQL tool available')
    const res = await rpc<any>('tools/call', { name: queryTool, arguments: { sql } })
    if (res?.content?.[0]?.type === 'text') {
      try { return JSON.parse(res.content[0].text) as T } catch { return res as T }
    }
    return (res?.rows ?? res) as T
  }

  const refresh = async () => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      // Load featured by default (smaller list)
      if (tools.listFeatured) {
        const res = await rpc<any>('tools/call', { name: tools.listFeatured, arguments: {} })
        const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
        const data = txt ? JSON.parse(txt) : res
        setProducts(data.rows ?? data)
        setProductTitle('Featured')
      } else if (tools.listProducts) {
        const res = await rpc<any>('tools/call', { name: tools.listProducts, arguments: {} })
        const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
        const data = txt ? JSON.parse(txt) : res
        setProducts(data.rows ?? data)
        setProductTitle('All Products')
      } else {
        const prodRows = await runQuery<any>('SELECT id, name, description, price_cents, stock, category FROM products ORDER BY id LIMIT 12')
        setProducts(prodRows.rows ?? prodRows)
        setProductTitle('Products')
      }

      if (tools.listOrders) {
        const res2 = await rpc<any>('tools/call', { name: tools.listOrders, arguments: { limit: 10 } })
        const txt2 = res2?.content?.[0]?.type === 'text' ? res2.content[0].text : null
        const data2 = txt2 ? JSON.parse(txt2) : res2
        setOrders(data2.rows ?? data2)
      } else {
        const orderRows = await runQuery<any>('SELECT id, customer_id, created_at FROM orders ORDER BY id DESC LIMIT 10')
        setOrders(orderRows.rows ?? orderRows)
      }
      // Load categories
      if (tools.listCategories) {
        const res3 = await rpc<any>('tools/call', { name: tools.listCategories, arguments: {} })
        const txt3 = res3?.content?.[0]?.type === 'text' ? res3.content[0].text : null
        const data3 = txt3 ? JSON.parse(txt3) : res3
        setCategories(data3.categories ?? [])
      }
      // Load cart
      await refreshCart()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Bootstrap: load everything except the product list (keep products hidden by default)
  const bootstrap = async () => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      // Orders
      if (tools.listOrders) {
        const res2 = await rpc<any>('tools/call', { name: tools.listOrders, arguments: { limit: 10 } })
        const txt2 = res2?.content?.[0]?.type === 'text' ? res2.content[0].text : null
        const data2 = txt2 ? JSON.parse(txt2) : res2
        setOrders(data2.rows ?? data2)
      } else {
        const orderRows = await runQuery<any>('SELECT id, customer_id, created_at FROM orders ORDER BY id DESC LIMIT 10')
        setOrders(orderRows.rows ?? orderRows)
      }
      // Categories
      if (tools.listCategories) {
        const res3 = await rpc<any>('tools/call', { name: tools.listCategories, arguments: {} })
        const txt3 = res3?.content?.[0]?.type === 'text' ? res3.content[0].text : null
        const data3 = txt3 ? JSON.parse(txt3) : res3
        setCategories(data3.categories ?? [])
      }
      // Cart
      await refreshCart()
      // Keep products hidden
      setProducts([])
      setProductTitle('No products')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (connected && initialized && queryTool) {
      // On first load, do not fetch/show products; just load categories/orders/cart
      bootstrap()
    }
  }, [connected, initialized, queryTool])

  const createOrder = async (productId: number) => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      if (tools.createOrder) {
        await rpc<any>('tools/call', { name: tools.createOrder, arguments: { productId, quantity: 1 } })
      } else {
        // fallback to SQL
        const order = await runQuery<any>('INSERT INTO orders (customer_id) VALUES (1) RETURNING id')
        const orderId = order.rows?.[0]?.id ?? order[0]?.id
        if (!orderId) throw new Error('Failed to create order')
        await runQuery<any>(`INSERT INTO order_items (order_id, product_id, quantity, price_cents) SELECT ${orderId}, ${productId}, 1, price_cents FROM products WHERE id=${productId}`)
      }
      await refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const refreshCart = async () => {
    const tools = (window as any).__TOOLS__ || {}
    const name = tools.cartView || 'cart.view'
    const res = await rpc<any>('tools/call', { name, arguments: {} })
    const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
    const data = txt ? JSON.parse(txt) : res
    setCart(data.cartId ? data : null)
  }

  const addToCart = async (productId: number) => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      const name = tools.cartAdd || 'cart.add_item'
      await rpc<any>('tools/call', { name, arguments: { productId, quantity: 1 } })
      await refreshCart()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const search = async () => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      if (!tools.searchProducts) {
        // fallback to simple SQL
        const clauses: string[] = []
        if (searchQ.trim()) clauses.push(`lower(name) LIKE '%${searchQ.trim().toLowerCase()}%'`)
        if (searchCategory.trim()) clauses.push(`category = '${searchCategory.replace(/'/g, "''")}'`)
        if (maxPrice.trim()) clauses.push(`price_cents <= ${parseInt(maxPrice, 10) || 0}`)
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
        const rows = await runQuery<any>(`SELECT id, name, description, price_cents, stock, category FROM products ${where} ORDER BY name LIMIT 100`)
        setProducts(rows.rows ?? rows)
        setProductTitle('Results')
        return
      }
      const args: any = {}
      if (searchQ.trim()) args.q = searchQ.trim()
      if (searchCategory.trim()) args.category = searchCategory.trim()
      if (maxPrice.trim()) args.maxPriceCents = parseInt(maxPrice, 10)
      const res = await rpc<any>('tools/call', { name: tools.searchProducts, arguments: args })
      const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
      const data = txt ? JSON.parse(txt) : res
      setProducts(data.rows ?? data)
      setProductTitle('Results')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const clearSearch = async () => {
    setSearchQ('')
    setSearchCategory('')
    setMaxPrice('')
    // Do not show products when clearing
    setProducts([])
    setProductTitle('No products')
  }

  const checkout = async () => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      const name = tools.cartCheckout || 'cart.checkout'
      const res = await rpc<any>('tools/call', { name, arguments: {} })
      const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
      const data = txt ? JSON.parse(txt) : res
      await refresh()
      setCart(null)
      alert(`Order #${data.orderId} created`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const removeFromCart = async (productId: number) => {
    setBusy(true)
    setError(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      const name = tools.cartRemove || 'cart.remove_item'
      await rpc<any>('tools/call', { name, arguments: { productId } })
      await refreshCart()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const askQuestion = async () => {
    setBusy(true)
    setError(null)
    setNlResult(null)
    setAssistantSummary(null)
    try {
      const tools = (window as any).__TOOLS__ || {}
      if (tools.assistantSearch) {
        const res = await rpc<any>('tools/call', { name: tools.assistantSearch, arguments: { question } })
        const txt = res?.content?.[0]?.type === 'text' ? res.content[0].text : null
        const data = txt ? JSON.parse(txt) : res
        if (data.products && Array.isArray(data.products)) {
          setProducts(data.products)
          setProductTitle('Assistant Results')
          setAssistantSummary(data.summary || null)
          setAssistantProducts(data.products as Product[])
          const initial: Record<number, number> = {}
          for (const p of data.products as Product[]) initial[p.id] = 1
          setAssistantSelect(initial)
          return
        }
        // Fallback to raw output if unexpected
        setNlResult(JSON.stringify(data, null, 2))
        return
      }
      if (!nlTool) throw new Error('NL tool not available. Set OPENAI_API_KEY on the server and restart.')
      const res = await rpc<any>('tools/call', { name: nlTool, arguments: { question } })
      if (res?.content?.[0]?.type === 'text') {
        const txt = res.content[0].text as string
        // Try to parse JSON, else show raw text
        try {
          const obj = JSON.parse(txt)
          setNlResult(JSON.stringify(obj, null, 2))
          // If this looks like a product rows result, surface it in the main list
          const rows = (obj && (obj.rows || obj)) as any[]
          if (Array.isArray(rows) && rows.length && rows[0].name && (rows[0].price_cents != null)) {
            setProducts(rows as Product[])
            setProductTitle('Assistant Results')
          }
        } catch {
          setNlResult(txt)
        }
      } else {
        setNlResult(JSON.stringify(res, null, 2))
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleAssistantSelect = (productId: number, checked: boolean) => {
    setAssistantSelect(prev => {
      const next = { ...prev }
      if (checked) {
        next[productId] = next[productId] && next[productId] > 0 ? next[productId] : 1
      } else {
        delete next[productId]
      }
      return next
    })
  }

  const setAssistantQty = (productId: number, qty: number) => {
    setAssistantSelect(prev => ({ ...prev, [productId]: Math.max(1, Math.floor(qty || 1)) }))
  }

  const addAssistantSelectionToCart = async () => {
    const tools = (window as any).__TOOLS__ || {}
    const name = tools.cartAdd || 'cart.add_item'
    setBusy(true)
    setError(null)
    try {
      const entries = Object.entries(assistantSelect)
      for (const [idStr, qty] of entries) {
        const productId = parseInt(idStr, 10)
        if (Number.isFinite(productId) && qty > 0) {
          await rpc<any>('tools/call', { name, arguments: { productId, quantity: qty } })
        }
      }
      await refreshCart()
      setAssistantSummary(prev => prev ? prev + ' Added selection to cart.' : 'Added selection to cart.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const selectAllAssistant = () => {
    if (!assistantProducts) return
    const next: Record<number, number> = {}
    for (const p of assistantProducts) next[p.id] = assistantSelect[p.id] || 1
    setAssistantSelect(next)
  }

  const clearAssistantSelection = () => setAssistantSelect({})

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 24 }}>
      <h1>MCP E-commerce Demo</h1>
      <p>
  Server: <code>{baseUrl}/mcp</code> — {connected ? 'connected' : 'disconnected'}
        <button onClick={refresh} style={{ marginLeft: 12 }} disabled={!connected || busy || !initialized || !queryTool}>Refresh</button>
      </p>
      <p>
        {initialized ? 'MCP initialized' : 'initializing...'} — SQL tool: <code>{queryTool ?? 'n/a'}</code>
      </p>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      <h2>Find Products</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input type="text" placeholder="Search by name" value={searchQ} onChange={e => setSearchQ(e.target.value)} style={{ padding: 8, minWidth: 240 }} />
        <select value={searchCategory} onChange={e => setSearchCategory(e.target.value)} style={{ padding: 8 }}>
          <option value="">All categories</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input type="number" min={0} step={100} placeholder="Max price (cents)" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} style={{ padding: 8, width: 180 }} />
        <button disabled={busy || !connected || !initialized} onClick={search}>Search</button>
        <button disabled={busy} onClick={clearSearch}>Clear</button>
        <span style={{ marginLeft: 8, color: '#666' }}>{productTitle}</span>
      </div>
      <h2>Products</h2>
      <ul>
        {products.map((p) => (
          <li key={p.id} style={{ marginBottom: 8 }}>
            <button onClick={() => setInfoOpen(p)} style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', color: '#0366d6', textDecoration: 'underline' }}>
              <strong>{p.name}</strong>
            </button> {p.category ? <em style={{ color: '#666' }}>({p.category})</em> : null} — {formatPrice(p.price_cents)} — stock {p.stock}
            <button style={{ marginLeft: 12 }} disabled={busy || !connected || !initialized} onClick={() => addToCart(p.id)}>Add to cart</button>
            <button style={{ marginLeft: 8 }} disabled={busy || !connected || !initialized || !queryTool} onClick={() => createOrder(p.id)}>Buy now</button>
          </li>
        ))}
      </ul>

      <h2>Your Cart</h2>
      {!cart && <p>No items yet.</p>}
      {cart && (
        <div style={{ border: '1px solid #e1e4e8', padding: 12, borderRadius: 6 }}>
          <ul>
            {cart.items.map((it) => (
              <li key={it.product_id}>
                {it.name} × {it.quantity} — {formatPrice(it.price_cents)} each — line {formatPrice(it.line_total)}
                <button style={{ marginLeft: 8 }} disabled={busy || !connected || !initialized} onClick={() => removeFromCart(it.product_id)}>Remove</button>
              </li>
            ))}
          </ul>
          <div style={{ fontWeight: 600, marginTop: 8 }}>Total: {formatPrice(cart.total_cents)}</div>
          <button style={{ marginTop: 8 }} disabled={busy || !connected || !initialized} onClick={checkout}>Checkout</button>
        </div>
      )}

      <div style={{ position: 'fixed', right: 24, bottom: 24 }}>
        <button onClick={() => setChatOpen(v => !v)} disabled={!nlTool && !((window as any).__TOOLS__ || {}).assistantSearch}>
          {chatOpen ? 'Close Assistant' : 'Open Assistant'}
        </button>
      </div>
      {chatOpen && (
        <div style={{ position: 'fixed', right: 24, top: 24, width: 480, height: '80vh', background: 'white', border: '1px solid #e1e4e8', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.12)', padding: 12, display: 'flex', flexDirection: 'column', zIndex: 1000 }}>
          <h3 style={{ marginTop: 0 }}>Assistant</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="e.g., list shoes under $80"
              style={{ flex: 1, padding: 8 }}
            />
            <button disabled={busy || !connected || !initialized || (!nlTool && !((window as any).__TOOLS__ || {}).assistantSearch)} onClick={askQuestion}>
              Ask
            </button>
          </div>
          {!nlTool && !((window as any).__TOOLS__ || {}).assistantSearch && (
            <p style={{ color: '#666' }}>Assistant unavailable. Set OPENAI_API_KEY on the server to enable.</p>
          )}
          {assistantSummary && <div style={{ marginTop: 8, color: '#333' }}>{assistantSummary}</div>}
          {assistantProducts && assistantProducts.length > 0 && (
            <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: '#333' }}>Would you like to add any of these to your cart?</div>
              <div style={{ maxHeight: '40vh', overflow: 'auto', paddingRight: 4 }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {assistantProducts.map(p => (
                    <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <input type="checkbox" checked={assistantSelect[p.id] != null} onChange={e => toggleAssistantSelect(p.id, e.target.checked)} />
                      <div style={{ flex: 1 }}>
                        <button onClick={() => setInfoOpen(p)} style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', color: '#0366d6', textDecoration: 'underline' }}>
                          <strong>{p.name}</strong>
                        </button> {p.category ? <em style={{ color: '#666' }}>({p.category})</em> : null} — {formatPrice(p.price_cents)}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        Qty
                        <input type="number" min={1} value={assistantSelect[p.id] || 1} onChange={e => setAssistantQty(p.id, parseInt(e.target.value || '1', 10))} style={{ width: 64, padding: 4 }} />
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy || Object.keys(assistantSelect).length === 0} onClick={addAssistantSelectionToCart}>Add selected</button>
                <button disabled={busy} onClick={selectAllAssistant}>Select all</button>
                <button disabled={busy || Object.keys(assistantSelect).length === 0} onClick={clearAssistantSelection}>Clear selection</button>
              </div>
            </div>
          )}
          {nlResult && (
            <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 6, marginTop: 8, overflow: 'auto', flex: 1 }}>{nlResult}</pre>
          )}
        </div>
      )}
      <h2>Recent Orders</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>#{o.id} by customer {o.customer_id} — {new Date(o.created_at).toLocaleString()}</li>
        ))}
      </ul>
      <p style={{ marginTop: 24, color: '#666' }}>
        This UI talks directly to an MCP server over Streamable HTTP (MCP), no REST.
      </p>

      {infoOpen && (
        <div style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setInfoOpen(null)}>
          <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', width: 440, maxWidth: '90vw', padding: 16 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{infoOpen.name}</h3>
            {infoOpen.category && <div style={{ color: '#666', marginBottom: 6 }}>{infoOpen.category}</div>}
            {infoOpen.description && <p style={{ margin: 0, marginBottom: 8 }}>{infoOpen.description}</p>}
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{formatPrice(infoOpen.price_cents)}</div>
            <div style={{ color: infoOpen.stock > 0 ? '#0a0' : '#a00' }}>{infoOpen.stock > 0 ? `In stock: ${infoOpen.stock}` : 'Out of stock'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button disabled={busy || infoOpen.stock <= 0} onClick={() => { addToCart(infoOpen.id); }}>
                Add to cart
              </button>
              <button onClick={() => setInfoOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
