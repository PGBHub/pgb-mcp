#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PGBOX_ENDPOINT = (process.env.PGBOX_ENDPOINT || "https://cloud.pgboxhub.com").replace(/\/$/, "");
const PGBOX_API_KEY = process.env.PGBOX_API_KEY || "";
const PGBOX_DATABASE = process.env.PGBOX_DATABASE || "postgres";

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
              description: "Target database name (default: postgres)",
            },
          },
        },
      },
      {
        name: "pgbox_action",
        description: "Execute or simulate a declarative action on the PGBox database inside an atomic transaction.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Name of the registered action (e.g. approveOrder, createUser)",
            },
            params: {
              type: "object",
              description: "Parameters object required by the action",
            },
            dry_run: {
              type: "boolean",
              description: "If true, simulates the action inside a transaction and rolls back changes without dispatching webhooks",
            },
            database: {
              type: "string",
              description: "Target database name (default: postgres)",
            },
          },
          required: ["action"],
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

  try {
    if (name === "pgbox_inspect") {
      const url = `${PGBOX_ENDPOINT}/api/v1/databases/${encodeURIComponent(dbname)}/schema.json`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(PGBOX_API_KEY ? { Authorization: `Bearer ${PGBOX_API_KEY}` } : {}),
        },
      });
      const data = await res.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }

    if (name === "pgbox_action") {
      const url = `${PGBOX_ENDPOINT}/v1/actions/invoke`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(PGBOX_API_KEY ? { Authorization: `Bearer ${PGBOX_API_KEY}` } : {}),
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

    if (name === "pgbox_provision") {
      const url = `${PGBOX_ENDPOINT}/databases`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(PGBOX_API_KEY ? { Authorization: `Bearer ${PGBOX_API_KEY}` } : {}),
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
  console.error("PGBox MCP Server running on stdio");
}

run().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});
