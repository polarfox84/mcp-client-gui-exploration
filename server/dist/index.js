import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import OpenAI from 'openai';
const app = express();
app.use(express.json({ limit: '1mb' }));
// CORS for browser-based MCP clients
app.use(cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id']
}));
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/app_db';
const pool = new Pool({ connectionString: DATABASE_URL });
function getServer() {
    const server = new McpServer({ name: 'mcp-http-db-server', version: '0.1.0' });
    // Tool: sql.query
    server.registerTool('sql.query', {
        title: 'SQL Query',
        description: 'Execute SQL against the configured PostgreSQL database',
        inputSchema: { sql: z.string() }
    }, async ({ sql }) => {
        const client = await pool.connect();
        try {
            const res = await client.query(sql);
            return {
                content: [
                    { type: 'text', text: JSON.stringify(res.rows) }
                ]
            };
        }
        finally {
            client.release();
        }
    });
    // Compat alias: db.query
    server.registerTool('db.query', {
        title: 'DB Query',
        description: 'Execute SQL (alias of sql.query)',
        inputSchema: { sql: z.string() }
    }, async ({ sql }) => {
        const client = await pool.connect();
        try {
            const res = await client.query(sql);
            return {
                content: [
                    { type: 'text', text: JSON.stringify({ rows: res.rows }) }
                ]
            };
        }
        finally {
            client.release();
        }
    });
    // Optional: NL → SQL using OpenAI (set OPENAI_API_KEY)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
    async function getSchemaSummary() {
        const client = await pool.connect();
        try {
            const res = await client.query(`select table_name, column_name, data_type
         from information_schema.columns
         where table_schema = 'public'
         order by table_name, ordinal_position`);
            const byTable = {};
            for (const row of res.rows) {
                const t = row.table_name;
                if (!byTable[t])
                    byTable[t] = [];
                byTable[t].push({ column_name: row.column_name, data_type: row.data_type });
            }
            return Object.entries(byTable)
                .map(([t, cols]) => `${t}(${cols.map(c => `${c.column_name}:${c.data_type}`).join(', ')})`)
                .join('\n');
        }
        finally {
            client.release();
        }
    }
    server.registerTool('nl.query', {
        title: 'Natural Language Query',
        description: 'Answer a question by generating SQL from natural language and executing it',
        inputSchema: { question: z.string() }
    }, async ({ question }) => {
        if (!openai) {
            return { content: [{ type: 'text', text: 'Error: OPENAI_API_KEY not set on server' }], isError: true };
        }
        const schema = await getSchemaSummary();
        const system = `You are a SQL expert. Given a PostgreSQL schema and a user question, write a single safe SQL query.
Rules:
- Prefer SELECT queries.
- Use only the provided tables/columns.
- Do not use DROP/DELETE/UPDATE/ALTER/TRUNCATE.
- Do not end with a semicolon.
Schema:\n${schema}`;
        const prompt = `Question: ${question}\nSQL:`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: prompt }
            ]
        });
        const text = completion.choices?.[0]?.message?.content ?? '';
        const sqlRaw = (Array.isArray(text) ? text.map(p => (typeof p === 'string' ? p : '')).join('\n') : text);
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
        }
        catch (err) {
            return { content: [{ type: 'text', text: `Error executing SQL: ${err.message}\nSQL: ${sql}` }], isError: true };
        }
        finally {
            client.release();
        }
    });
    // Sample prompt (for LLM clients like Claude): translate question to SQL
    server.registerPrompt('sql-from-question', {
        title: 'SQL from NL question',
        description: 'Given a question, write safe SQL using the current DB schema',
        argsSchema: { question: z.string() }
    }, async ({ question }) => {
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
        };
    });
    return server;
}
// Stateless Streamable HTTP endpoint: new transport/server per request, returns JSON (no SSE)
app.post('/mcp', async (req, res) => {
    try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = getServer();
        res.on('close', () => {
            try {
                transport.close();
                server.close();
            }
            catch { }
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
        console.error('Error handling /mcp request', err);
        if (!res.headersSent)
            res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
});
const port = parseInt(process.env.PORT || '8000', 10);
app.listen(port, () => {
    console.log(`MCP HTTP DB server listening on http://0.0.0.0:${port}`);
});
