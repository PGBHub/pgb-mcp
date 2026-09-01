#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function parseCliArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = "true";
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
        i++;
      }
    }
  }
  return options;
}

const cliArgs = parseCliArgs();

// Extract database from CLI flags (--db or --database or parsed from --url)
function extractDbFromArgs(): string {
  if (cliArgs.db) return cliArgs.db;
  if (cliArgs.database) return cliArgs.database;
  if (cliArgs.d) return cliArgs.d;
  if (cliArgs.url) {
    try {
      const parsed = new URL(cliArgs.url);
      const dbPath = parsed.pathname.replace(/^\//, "");
      if (dbPath) return dbPath;
    } catch {
      // url might not be a standard URL format
    }
  }
  return process.env.PGBOX_DATABASE || "postgres";
}

// Extract endpoint from CLI flags or env
function extractEndpoint(): string {
  if (cliArgs.endpoint) return cliArgs.endpoint.replace(/\/$/, "");
  if (cliArgs.e) return cliArgs.e.replace(/\/$/, "");
  return (process.env.PGBOX_ENDPOINT || "https://cloud.pgboxhub.com").replace(/\/$/, "");
}

const PGBOX_ENDPOINT = extractEndpoint();
const PGBOX_API_KEY = cliArgs.key || cliArgs["api-key"] || cliArgs.k || process.env.PGBOX_API_KEY || "";
const PGBOX_DATABASE = extractDbFromArgs();

const server = new Server(
  {
    name: "pgbox-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register MCP Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "pgbox_inspect",
        description: "Fetch semantic machine-readable /schema.json metadata (tables, columns, primary keys, foreign keys, action contracts) for the active database.",
        inputSchema: {
          type: "object",
          properties: {
            database: {
              type: "string",
              description: `Target database name (default: ${PGBOX_DATABASE})`,
            },
          },
        },
      },
      {
        name: "pgbox_list_actions",
        description: "List all registered transactional business actions available on the PGBox database, including their parameter schemas, descriptions, and sample payloads.",
        inputSchema: {
          type: "object",
          properties: {
            database: {
              type: "string",
              description: `Target database name (default: ${PGBOX_DATABASE})`,
            },
          },
        },
      },
      {
        name: "pgbox_action",
        description: "Execute or simulate a registered business action on the PGBox database inside an atomic transaction.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Name of the registered action (e.g. saveUser, approveOrder, transferFunds)",
            },
            params: {
              type: "object",
              description: "Parameters object required by the action template",
            },
            dry_run: {
              type: "boolean",
              description: "If true, simulates the action inside an atomic transaction and rolls back changes without committing",
            },
            database: {
              type: "string",
              description: `Target database name (default: ${PGBOX_DATABASE})`,
            },
          },
          required: ["action"],
        },
      },
      {
        name: "pgbox_query_crud",
        description: "Execute safe parameterized SELECT, INSERT, UPDATE, DELETE, or COUNT operations on database tables.",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["find", "insert", "update", "delete", "count"],
              description: "CRUD operation to perform",
            },
            table: {
              type: "string",
              description: "Target table name (e.g. users, orders)",
            },
            data: {
              type: "object",
              description: "Row data for insert or update operations",
            },
            filter: {
              type: "object",
              description: "Key-value filter criteria for find, update, delete, or count operations",
            },
            limit: {
              type: "number",
              description: "Maximum number of rows to return (default: 100)",
            },
            offset: {
              type: "number",
              description: "Number of rows to skip",
            },
            orderBy: {
              type: "string",
              description: "Column name to order results by",
            },
            order: {
              type: "string",
              enum: ["ASC", "DESC"],
              description: "Order direction (default: ASC)",
            },
            database: {
              type: "string",
              description: `Target database name (default: ${PGBOX_DATABASE})`,
            },
          },
          required: ["operation", "table"],
        },
      },
      {
        name: "pgbox_create_table",
        description: "Create a new relational table or JSONB collection with typed columns and primary keys. Destructive drops are blocked by agent guardrails.",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to create",
            },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", description: "PostgreSQL type (e.g. serial, text, numeric, jsonb, timestamptz, boolean)" },
                  primary_key: { type: "boolean" },
                  nullable: { type: "boolean" },
                  default: { type: "string" },
                },
                required: ["name", "type"],
              },
              description: "List of columns to define for the table",
            },
            database: {
              type: "string",
              description: `Target database name (default: ${PGBOX_DATABASE})`,
            },
          },
          required: ["table_name", "columns"],
        },
      },
      {
        name: "pgbox_provision",
        description: "Provision an isolated, serverless PostgreSQL database with dedicated credentials in under 30 seconds.",
        inputSchema: {
          type: "object",
          properties: {
            database_name: {
              type: "string",
              description: "Name for the new database (lowercase alphanumeric)",
            },
          },
          required: ["database_name"],
        },
      },
    ],
  };
});

// Handle Tool Executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const dbname = (args?.database as string) || PGBOX_DATABASE;

  const authHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(PGBOX_API_KEY ? { Authorization: `Bearer ${PGBOX_API_KEY}` } : {}),
  };

  try {
    if (name === "pgbox_inspect") {
      const url = `${PGBOX_ENDPOINT}/api/v1/databases/${encodeURIComponent(dbname)}/schema.json`;
      const res = await fetch(url, { headers: authHeaders });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "pgbox_list_actions") {
      const url = `${PGBOX_ENDPOINT}/api/v1/databases/${encodeURIComponent(dbname)}/schema.json`;
      const res = await fetch(url, { headers: authHeaders });
      const data = (await res.json()) as { actions?: Record<string, unknown> };
      const actions = data?.actions || {};
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                database: dbname,
                count: Object.keys(actions).length,
                actions,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "pgbox_action") {
      const url = `${PGBOX_ENDPOINT}/v1/actions/invoke`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          action: args?.action,
          params: args?.params || {},
          dry_run: Boolean(args?.dry_run),
          dbname,
        }),
      });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "pgbox_query_crud") {
      const op = String(args?.operation || "find").toLowerCase();
      const endpointMap: Record<string, string> = {
        find: "/v1/data/find",
        insert: "/v1/data/insert",
        update: "/v1/data/update",
        delete: "/v1/data/delete",
        count: "/v1/data/count",
      };

      const path = endpointMap[op];
      if (!path) {
        throw new Error(`Unsupported CRUD operation '${op}'. Supported: find, insert, update, delete, count.`);
      }

      const url = `${PGBOX_ENDPOINT}${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          table: args?.table,
          data: args?.data,
          filter: args?.filter,
          limit: args?.limit,
          offset: args?.offset,
          orderBy: args?.orderBy,
          order: args?.order,
          dbname,
        }),
      });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "pgbox_create_table") {
      const tableName = String(args?.table_name || "").trim();
      const columns = (args?.columns as Array<{ name: string; type: string; primary_key?: boolean; nullable?: boolean; default?: string }>) || [];

      if (!tableName) throw new Error("table_name is required");
      if (!columns.length) throw new Error("columns list cannot be empty");

      const colDefs = columns.map((c) => {
        let def = `"${c.name}" ${c.type}`;
        if (c.primary_key) def += " PRIMARY KEY";
        if (c.nullable === false) def += " NOT NULL";
        if (c.default) def += ` DEFAULT ${c.default}`;
        return def;
      });

      const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n);`;

      const url = `${PGBOX_ENDPOINT}/databases/${encodeURIComponent(dbname)}/actions/create-missing-table`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ ddl }),
      });
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: data.success || false,
                table: tableName,
                ddl,
                message: data.message || "Table created successfully.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "pgbox_provision") {
      const url = `${PGBOX_ENDPOINT}/databases`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...authHeaders,
        },
        body: new URLSearchParams({ name: args?.database_name as string }).toString(),
      });
      return {
        content: [{ type: "text", text: `Provision request sent for database: ${args?.database_name}` }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`PGBox MCP Server running on stdio (database: ${PGBOX_DATABASE}, endpoint: ${PGBOX_ENDPOINT})`);
}

run().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});

