# @pgbox/mcp (Agent-Native Model Context Protocol Server)

Official Model Context Protocol (MCP) server for **PGBox Cloud**. Connects autonomous AI coding agents (**Claude Code**, **Cursor**, **Windsurf**, and **Antigravity**) directly to your PostgreSQL databases to introspect schemas, safely execute business actions, and perform transactional CRUD operations.

## Supported MCP Tools

### 1. `pgbox_action` (Action Execution & Simulation)
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

### 2. `pgbox_list_actions` (Action Discovery)
Lists all registered business actions available on the database, complete with their descriptions, parameter requirements, and sample payloads.

### 3. `pgbox_inspect` (Schema Introspection)
Retrieves semantic machine-readable `/schema.json` metadata (tables, column data types, primary keys, foreign keys, and action contracts).

### 4. `pgbox_query_crud` (Safe Parameterized CRUD)
Performs safe parameterized CRUD queries:
- **Operations**: `find`, `insert`, `update`, `delete`, `count`
- **Guarded**: Destructive table-wide drops are strictly blocked at the protocol layer.

### 5. `pgbox_create_table` (Schema Provisioning)
Safely creates relational tables or JSONB document collections with typed columns and primary keys.

### 6. `pgbox_provision` (Database Sandbox Provisioning)
Provisions isolated, serverless PostgreSQL database sandboxes with dedicated credentials in under 30 seconds.

---

## Configuration

### Claude Code / Cursor / Windsurf / Antigravity

Add to your `.cursor/mcp.json`, `claude_desktop_config.json`, or Antigravity settings:

```json
{
  "mcpServers": {
    "pgbox-lokl": {
      "command": "npx",
      "args": [
        "-y",
        "@pgbox/mcp",
        "--db",
        "lokl",
        "--url",
        "postgresql://lokl_app:SECRET@pg.motoriqhub.com:5433/lokl?sslmode=require"
      ]
    }
  }
}
```

Or using environment variables:

```json
{
  "mcpServers": {
    "pgbox": {
      "command": "npx",
      "args": ["-y", "@pgbox/mcp"],
      "env": {
        "PGBOX_ENDPOINT": "https://cloud.pgboxhub.com",
        "PGBOX_API_KEY": "your_api_key_here",
        "PGBOX_DATABASE": "lokl"
      }
    }
  }
}
```

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

