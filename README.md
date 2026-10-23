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
  "database": "myapp"
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

### PGB Business tools (business.pgbhub.com)

`business_mail_search`, `business_mail_read_thread`, `business_mail_send`, `business_mail_update`,
`business_calendar_events`, `business_calendar_create_event`, `business_contacts_find`.

They use a **mailbox API key** (`pgbm_...`) created in PGB Business **Admin → API keys**, limited to
the mailboxes and permissions (read / send / modify) you choose. Set it as `PGB_BUSINESS_KEY`
(optionally `PGB_BUSINESS_URL`). Email content is treated as untrusted data; agents should confirm
with the user before sending or creating events.

#### The rest of the suite

The same key and URL also give your agent tools for every PGB Business app (`src/suite.ts`). Each one
calls the PGB Business REST API (`/api/v1/...`). The server enforces the key's scopes (read / send /
modify) and its **agent policy**. A refusal comes back as `HTTP 403` with the server's reason and a hint,
and is never retried silently.

| App | Tools |
|---|---|
| Search | `search_all`, `notifications_list`, `inbox_commitments_view` (needs_reply / waiting / promised / today / follow_up) |
| Calendar | `calendar_list_calendars`, `calendar_list_events`, `calendar_get_event`, `calendar_create_event`, `calendar_update_event`, `calendar_delete_event`*, `calendar_rsvp`*, `calendar_find_free_time` |
| Contacts | `contacts_search`, `contacts_get`, `contacts_create`, `contacts_directory` |
| Drive | `drive_list`, `drive_search`, `drive_get`, `drive_read_text`, `drive_upload` (5 MB max), `drive_create_folder`, `drive_list_shares`, `drive_share`*, `drive_trash`* |
| Docs | `docs_list_recent`, `docs_create`, `docs_get`, `docs_list_comments`, `docs_add_comment` |
| Sheets | `sheets_create`, `sheets_read_range`, `sheets_update_range` (A1 ranges, 10,000 cells max) |
| Tasks | `tasks_list_lists`, `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_complete`, `tasks_comment`, `tasks_delete`* |
| Notes | `notes_list`, `notes_get`, `notes_create`, `notes_update`, `notes_delete`* |
| Forms | `forms_list`, `forms_get`, `forms_list_responses`, `forms_summarize_responses` |
| Chat | `chat_list_channels`, `chat_read_messages`, `chat_read_thread`, `chat_search`, `chat_open_dm`, `chat_post_message`* |
| Meet | `meet_list_rooms`, `meet_create_room`, `meet_get_room`, `meet_list_notes` |
| Invoices | `invoices_dashboard`, `invoices_list`, `invoices_get`, `invoices_create_draft`, `invoices_update_draft`, `invoices_delete_draft`*, `invoices_get_payment_link`*, `invoices_list_customers`, `invoices_create_customer`, `invoices_list_items`, `invoices_list_payments` |
| Collections | `collections_list`, `collections_get`, `collections_list_rows`, `collections_get_row`, `collections_update_row`, `collections_review_row` |
| Learn | `learn_list_courses`, `learn_my_assignments`, `learn_get_course`, `learn_search`, `learn_read_article` |
| Shield | `shield_list_findings`, `shield_get_finding`, `shield_list_verifications` (read-only for keys) |
| Secrets | `secrets_list_projects`, `secrets_list_items` (key names and metadata only, never values) |
| Assistant | `assistant_summarize_thread`, `assistant_action_items`, `assistant_draft_reply` (drafts are never sent) |

\* These tools send, delete, share or publish something. They need an explicit `confirm: true`
argument. Without it nothing reaches the server and the tool explains what would happen.
`calendar_create_event` and `calendar_update_event` also need `confirm: true` when guests would be
emailed.

Some actions are left out on purpose because PGB Business only lets a signed-in person do them:
issuing or sending invoices, recording payments, approving held sends, Import and Enterprise.

Long lists accept `limit` / `offset` (or the API's own cursor). Long text is clipped, and every result
is capped at about 30,000 characters with a note saying what was cut. Errors show the HTTP status and
the API's message. Keys and tokens are always redacted.

Run the tests with `npm test`. They use vitest and a mocked fetch.

## Configuration

### Claude Code / Cursor / Windsurf / Antigravity

Add to your `.cursor/mcp.json`, `claude_desktop_config.json`, or Antigravity settings:

```json
{
  "mcpServers": {
    "pgbhub-myapp": {
      "command": "npx",
      "args": [
        "-y",
        "@pgbhub/mcp",
        "--db",
        "myapp",
        "--url",
        "postgresql://myapp_app:SECRET@db.pgbhub.app:5433/myapp?sslmode=require"
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
        "PGBHUB_DATABASE": "myapp"
      }
    }
  }
}
```

---

## License

MIT © [Hydratik](https://github.com/Hydratik)

