# @pgbhub/mcp (Agent-Native Model Context Protocol Server)

Official Model Context Protocol (MCP) server for **PGBHub Cloud**. Connects autonomous AI coding agents (**Claude Code**, **Cursor**, **Windsurf**, and **Antigravity**) directly to your PostgreSQL databases to introspect schemas, safely execute business actions, and perform transactional CRUD operations.

## Supported MCP Tools

### 1. `pgbhub_action` (Action Execution & Simulation)
Executes or simulates registered business actions inside atomic database transactions:
```json
{
  "action": "saveUser",
  "params": {
    "name": "Alex Vance",
    "email": "alex@example.com",
    "preferences": { "theme": "dark" }
  },
  "dry_run": false,
  "database": "lokl"
}
```

### 2. `pgbhub_list_actions` (Action Discovery)
Lists all registered business actions available on the database, complete with their descriptions, parameter requirements, and sample payloads.

### 3. `pgbhub_inspect` (Schema Introspection)
Retrieves semantic machine-readable `/schema.json` metadata (tables, column data types, primary keys, foreign keys, and action contracts).

### 4. `pgbhub_query_crud` (Safe Parameterized CRUD)
Performs safe parameterized CRUD queries:
- **Operations**: `find`, `insert`, `update`, `delete`, `count`
- **Guarded**: Destructive table-wide drops are strictly blocked at the protocol layer.

### 5. `pgbhub_create_table` (Schema Provisioning)
Safely creates relational tables or JSONB document collections with typed columns and primary keys.

### 6. `pgbhub_provision` (Database Sandbox Provisioning)
Provisions isolated, serverless PostgreSQL database sandboxes with dedicated credentials in under 30 seconds.

---

## Configuration

### Claude Code / Cursor / Windsurf / Antigravity

Add to your `.cursor/mcp.json`, `claude_desktop_config.json`, or Antigravity settings:

```json
{
  "mcpServers": {
    "pgbhub-lokl": {
      "command": "npx",
      "args": [
        "-y",
        "@pgbhub/mcp",
        "--db",
        "lokl",
        "--url",
        "postgresql://lokl_app:SECRET@db.pgbhub.app:5433/lokl?sslmode=require"
      ]
    }
  }
}
```

Or using environment variables:

```json
{
  "mcpServers": {
    "pgbhub": {
      "command": "npx",
      "args": ["-y", "@pgbhub/mcp"],
      "env": {
        "PGBHUB_ENDPOINT": "https://cloud.pgbhub.com",
        "PGBHUB_API_KEY": "your_api_key_here",
        "PGBHUB_DATABASE": "lokl"
      }
    }
  }
}
```

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

