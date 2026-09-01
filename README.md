# @pgbox/mcp (Agent-Native MCP Server)

Model Context Protocol (MCP) server for **PGBox Cloud**. Connects AI coding agents (such as **Claude Code**, **Cursor**, and **Antigravity**) directly to your PGBox serverless databases.

## Features

- `pgbox_inspect`: Retrieves semantic machine-readable `/schema.json` metadata (tables, columns, foreign keys, primary keys, and action contracts).
- `pgbox_action`: Executes or simulates (`dry_run=true`) transactional actions.
- `pgbox_provision`: Provisions serverless databases in under 30 seconds.

## Setup in Claude Desktop or Cursor

Add to your `claude_desktop_config.json` or Cursor MCP settings:

```json
{
  "mcpServers": {
    "pgbox": {
      "command": "npx",
      "args": ["-y", "@pgbox/mcp"],
      "env": {
        "PGBOX_ENDPOINT": "https://cloud.pgboxhub.com",
        "PGBOX_API_KEY": "your_api_key_here",
        "PGBOX_DATABASE": "your_database_name"
      }
    }
  }
}
```

## License

MIT © [Hydratik](https://github.com/Hydratik)
