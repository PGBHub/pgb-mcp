#!/usr/bin/env node
/**
 * @pgb/mcp — Agent-Native Model Context Protocol (MCP) Server for PGBHub Cloud
 *
 * Tools:
 *   pgbhub_help, pgbhub_provision_project, pgbhub_get_project_graph,
 *   pgbhub_execute_sql, pgbhub_create_table, pgbhub_query_crud,
 *   pgbhub_deploy_function, pgbhub_deploy_container,
 *   pgbhub_configure_auth, pgbhub_upload_asset, pgbhub_send_mail
 *
 * Resources: pgbhub://instructions, pgbhub://cheatsheet, pgbhub://project/graph
 * Prompts:   bootstrap_fullstack_app, generate_feature_module
 *
 * Zero-config sandbox mode: if no PGBHUB_API_KEY is provided, an ephemeral
 * project is automatically provisioned and credentials returned inline.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseCliArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { options[key] = next; i++; }
      else { options[key] = "true"; }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) { options[key] = next; i++; }
    }
  }
  return options;
}

const cliArgs = parseCliArgs();

function extractEndpoint(): string {
  const raw = cliArgs.endpoint || cliArgs.e || process.env.PGBHUB_ENDPOINT || "https://cloud.pgbhub.com";
  return raw.replace(/\/$/, "");
}

const PGBHUB_ENDPOINT = extractEndpoint();
const PGBHUB_API_KEY  = cliArgs.key || cliArgs["api-key"] || cliArgs.k || process.env.PGBHUB_API_KEY || "";
const PGBHUB_PROJECT  = cliArgs.project || cliArgs.p || process.env.PGBHUB_PROJECT_ID || "";

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox provisioning (zero-config mode)
// ─────────────────────────────────────────────────────────────────────────────

interface SandboxContext {
  projectId: string;
  projectUrl: string;
  apiKey: string;
  claimUrl: string;
  ephemeral: boolean;
}

let _sandboxCtx: SandboxContext | null = null;

async function ensureSandbox(): Promise<SandboxContext> {
  if (_sandboxCtx) return _sandboxCtx;
  if (PGBHUB_API_KEY && PGBHUB_PROJECT) {
    _sandboxCtx = {
      projectId: PGBHUB_PROJECT,
      projectUrl: `https://${PGBHUB_PROJECT}.pgbhub.dev`,
      apiKey: PGBHUB_API_KEY,
      claimUrl: `${PGBHUB_ENDPOINT}/claim/${PGBHUB_PROJECT}`,
      ephemeral: false,
    };
    return _sandboxCtx;
  }
  // Auto-provision ephemeral sandbox
  const res = await fetch(`${PGBHUB_ENDPOINT}/api/v1/sandbox/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ephemeral: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sandbox provisioning failed (HTTP ${res.status}): ${err}`);
  }
  const data = (await res.json()) as {
    project_id: string;
    api_key: string;
    claim_url: string;
  };
  _sandboxCtx = {
    projectId: data.project_id,
    projectUrl: `https://${data.project_id}.pgbhub.dev`,
    apiKey: data.api_key,
    claimUrl: data.claim_url,
    ephemeral: true,
  };
  return _sandboxCtx;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function apiGet(path: string, ctx: SandboxContext): Promise<unknown> {
  const res = await fetch(`${PGBHUB_ENDPOINT}${path}`, { headers: authHeaders(ctx.apiKey) });
  return res.json();
}

async function apiPost(path: string, body: unknown, ctx: SandboxContext): Promise<unknown> {
  const res = await fetch(`${PGBHUB_ENDPOINT}${path}`, {
    method: "POST",
    headers: authHeaders(ctx.apiKey),
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPatch(path: string, body: unknown, ctx: SandboxContext): Promise<unknown> {
  const res = await fetch(`${PGBHUB_ENDPOINT}${path}`, {
    method: "PATCH",
    headers: authHeaders(ctx.apiKey),
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Static content for resources
// ─────────────────────────────────────────────────────────────────────────────

const INSTRUCTIONS_TEXT = `# PGBHub MCP Server — Instructions

PGBHub is a programmable backend for AI-native applications.

## What you can do
- **Provision** a full-stack backend (DB + auth + storage + mail + functions) in <5s
- **Query** your PostgreSQL database with parameterized SQL or CRUD helpers
- **Deploy** serverless functions (TypeScript/Python) and containerized apps
- **Send** transactional email (100 free/mo, then $0.001/email)
- **Manage** auth (signup, login, JWT, OTP, magic links — 5,000 free MAUs)
- **Upload** assets to R2 / S3 storage (500 MB free storage pool)

## Connection string
Direct standard PostgreSQL: \`postgresql://user:pass@<projectId>.pgbhub.dev:5432/<dbname>\`
Zero vendor lock-in — any standard Postgres client works.

## Free tier summary
| Resource | Free allowance |
|---|---|
| Databases | 1 (500 MB storage pool) |
| Compute hours | 20 active hours/mo |
| Auth MAUs | 5,000/mo |
| Transactional emails | 100/mo |
| Function invocations | 50,000/mo |

## Docs
https://docs.pgbhub.com
`;

const CHEATSHEET_TEXT = `# PGBHub MCP Cheatsheet

## 1. Provision a project
\`\`\`
pgbhub_provision_project(name="myapp", region="eu-west-1")
\`\`\`

## 2. Execute SQL
\`\`\`
pgbhub_execute_sql(sql="SELECT * FROM users WHERE id = $1", params=[42])
\`\`\`

## 3. CRUD helpers
\`\`\`
pgbhub_query_crud(operation="insert", table="orders", data={"user_id": 1, "amount": 99.99})
pgbhub_query_crud(operation="find",   table="orders", filter={"user_id": 1}, limit=20)
\`\`\`

## 4. Create a table
\`\`\`
pgbhub_create_table(table_name="products", columns=[
  { name: "id",    type: "bigserial", primary_key: true },
  { name: "name",  type: "text",      nullable: false },
  { name: "price", type: "numeric(10,2)" }
])
\`\`\`

## 5. Deploy a function
\`\`\`
pgbhub_deploy_function(module_name="checkout", code="export async function POST(req, ctx) { ... }")
\`\`\`

## 6. Deploy a container
\`\`\`
pgbhub_deploy_container(image="ghcr.io/myorg/myapp:latest", tier="standard", min_replicas=1, max_replicas=5)
\`\`\`

## 7. Send mail
\`\`\`
pgbhub_send_mail(to="user@example.com", subject="Welcome!", text="Thanks for signing up.")
\`\`\`

## 8. Configure auth
\`\`\`
pgbhub_configure_auth(enable_magic_links=true, enable_otp=true, jwt_expiry_hours=24)
\`\`\`

## 9. Upload asset
\`\`\`
pgbhub_upload_asset(file_path="assets/logo.png", content_type="image/png")
\`\`\`
`;

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "@pgb/mcp", version: "2.0.0" },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// ─── LIST TOOLS ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "pgbhub_help",
      description: "Get comprehensive help and workflow guidance for PGBHub. Covers provisioning, SQL, functions, containers, auth, storage, and mail. Start here if you're unsure what to do.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["overview", "sql", "functions", "containers", "auth", "storage", "mail", "billing", "cli"],
            description: "Specific topic to get help on (optional; defaults to overview)",
          },
        },
      },
    },
    {
      name: "pgbhub_provision_project",
      description: "Provision a full-stack backend (PostgreSQL DB, auth, storage, mail, serverless functions) in under 5 seconds. If no API key is configured, an ephemeral sandbox project is automatically provisioned.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name slug (lowercase, alphanumeric, hyphens). e.g. 'my-app'" },
          region: { type: "string", description: "Deployment region (e.g. eu-west-1, us-east-1). Defaults to eu-west-1." },
          ephemeral: { type: "boolean", description: "If true, provisions a temporary sandbox (auto-claimed by user). Default: false" },
        },
        required: ["name"],
      },
    },
    {
      name: "pgbhub_get_project_graph",
      description: "Retrieve the complete machine-readable project topology graph: database schema, tables, functions, containers, auth config, storage usage, and mail reputation.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
      },
    },
    {
      name: "pgbhub_execute_sql",
      description: "Execute a parameterized SQL query against the project PostgreSQL database. Use $1, $2, ... placeholders. Dangerous DDL (DROP DATABASE, ALTER SYSTEM) is blocked.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Parameterized SQL query (e.g. SELECT * FROM users WHERE id = $1)" },
          params: {
            type: "array",
            items: {},
            description: "Ordered array of parameter values matching $1, $2, ... placeholders",
          },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
          timeout_ms: { type: "number", description: "Statement timeout in milliseconds (default: 5000, max: 30000)" },
        },
        required: ["sql"],
      },
    },
    {
      name: "pgbhub_create_table",
      description: "Create a new relational table with typed columns and primary keys in the project database. DROP operations are fully blocked by guardrails.",
      inputSchema: {
        type: "object",
        properties: {
          table_name: { type: "string", description: "Name of the table to create (snake_case recommended)" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name:        { type: "string" },
                type:        { type: "string", description: "PostgreSQL type: text, bigserial, numeric, jsonb, timestamptz, boolean, uuid, etc." },
                primary_key: { type: "boolean" },
                nullable:    { type: "boolean" },
                default:     { type: "string", description: "SQL default expression (e.g. NOW(), gen_random_uuid())" },
              },
              required: ["name", "type"],
            },
            description: "List of column definitions",
          },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["table_name", "columns"],
      },
    },
    {
      name: "pgbhub_query_crud",
      description: "Execute safe parameterized SELECT, INSERT, UPDATE, DELETE, or COUNT operations on database tables without writing raw SQL.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["find", "insert", "update", "delete", "count"],
            description: "CRUD operation to perform",
          },
          table:    { type: "string", description: "Target table name" },
          data:     { type: "object", description: "Row data for insert or update" },
          filter:   { type: "object", description: "Key-value filter criteria (e.g. { id: 42 })" },
          limit:    { type: "number", description: "Max rows to return (default: 100)" },
          offset:   { type: "number", description: "Rows to skip (for pagination)" },
          order_by: { type: "string", description: "Column to order by" },
          order:    { type: "string", enum: ["ASC", "DESC"], description: "Sort direction (default: ASC)" },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["operation", "table"],
      },
    },
    {
      name: "pgbhub_deploy_function",
      description: "Deploy or update a serverless function module. Supports TypeScript (Hono-style multi-endpoint named exports: GET, POST, PUT, DELETE). Receives ambient context: { db, user, storage, email, secrets }.",
      inputSchema: {
        type: "object",
        properties: {
          module_name: { type: "string", description: "Function module name (e.g. 'checkout', 'webhooks'). Accessible at /<module_name>/*" },
          code: { type: "string", description: "Full TypeScript/JavaScript source code of the function module" },
          runtime: { type: "string", enum: ["typescript", "python"], description: "Runtime (default: typescript)" },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["module_name", "code"],
      },
    },
    {
      name: "pgbhub_deploy_container",
      description: "Deploy a containerized application with auto-scaling, scale-to-zero, and timezone-aware scheduled windows. Requires a verified payment card for >1 replica or Standard+ tiers.",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Container image reference (e.g. ghcr.io/myorg/myapp:latest or a Dockerfile path)" },
          tier: {
            type: "string",
            enum: ["micro", "standard", "performance", "enterprise"],
            description: "Compute tier (default: micro). Micro is free on scale-to-zero.",
          },
          min_replicas: { type: "number", description: "Minimum replicas (0 = scale-to-zero, requires free tier or payment card for ≥1)" },
          max_replicas: { type: "number", description: "Maximum replicas for auto-scaling (max: 20, default: 1)" },
          schedule: {
            type: "string",
            description: "Timezone-aware always-on window (e.g. '09:00-18:00 Europe/London'). Outside window: scale-to-zero.",
          },
          env: { type: "object", description: "Environment variables to inject into the container" },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["image"],
      },
    },
    {
      name: "pgbhub_configure_auth",
      description: "Configure built-in PGB Auth settings for the project. Enables signup/login, magic links, OTP, JWT expiry, and custom OAuth providers. Free for up to 5,000 MAUs/month.",
      inputSchema: {
        type: "object",
        properties: {
          enable_email_signup:  { type: "boolean", description: "Allow users to sign up with email/password (default: true)" },
          enable_magic_links:   { type: "boolean", description: "Enable passwordless magic link sign-in" },
          enable_otp:           { type: "boolean", description: "Enable one-time password (OTP) sign-in" },
          jwt_expiry_hours:     { type: "number",  description: "JWT access token expiry in hours (default: 1)" },
          refresh_expiry_days:  { type: "number",  description: "Refresh token expiry in days (default: 30)" },
          allowed_email_domains: {
            type: "array",
            items: { type: "string" },
            description: "Restrict sign-up to specific email domains (e.g. ['company.com']). Empty = allow all.",
          },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
      },
    },
    {
      name: "pgbhub_upload_asset",
      description: "Generate a presigned upload URL for a file to project R2/S3 storage, with public CDN caching. 500 MB free storage pool per account.",
      inputSchema: {
        type: "object",
        properties: {
          file_path:    { type: "string", description: "Destination path within the project storage bucket (e.g. 'avatars/user-123.png')" },
          content_type: { type: "string", description: "MIME type of the file (e.g. 'image/png', 'application/pdf')" },
          public:       { type: "boolean", description: "Make file publicly accessible via CDN (default: false)" },
          project_id:   { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["file_path", "content_type"],
      },
    },
    {
      name: "pgbhub_send_mail",
      description: "Send a transactional email via PGBHub managed SES (noreply@mail.pgbhub.dev) or custom BYO SMTP. 100 free emails/month; $0.001/email thereafter. Subject to velocity and reputation limits.",
      inputSchema: {
        type: "object",
        properties: {
          to:         { type: "string", description: "Recipient email address" },
          subject:    { type: "string", description: "Email subject line" },
          text:       { type: "string", description: "Plain-text email body" },
          html:       { type: "string", description: "Optional HTML email body" },
          reply_to:   { type: "string", description: "Optional reply-to email address" },
          project_id: { type: "string", description: "Project ID (defaults to configured project)" },
        },
        required: ["to", "subject", "text"],
      },
    },
  ],
}));

// ─── LIST RESOURCES ───────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "pgbhub://instructions",
      name: "PGBHub Instructions",
      description: "Complete guide to using PGBHub: free tier limits, connection strings, and platform overview.",
      mimeType: "text/markdown",
    },
    {
      uri: "pgbhub://cheatsheet",
      name: "PGBHub Cheatsheet",
      description: "Quick-reference examples for all major PGBHub operations.",
      mimeType: "text/markdown",
    },
    {
      uri: "pgbhub://project/graph",
      name: "Project Graph",
      description: "Live machine-readable topology of the current project (schema, functions, containers, auth, storage).",
      mimeType: "application/json",
    },
  ],
}));

// ─── READ RESOURCE ────────────────────────────────────────────────────────────

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "pgbhub://instructions") {
    return { contents: [{ uri, mimeType: "text/markdown", text: INSTRUCTIONS_TEXT }] };
  }

  if (uri === "pgbhub://cheatsheet") {
    return { contents: [{ uri, mimeType: "text/markdown", text: CHEATSHEET_TEXT }] };
  }

  if (uri === "pgbhub://project/graph") {
    try {
      const ctx = await ensureSandbox();
      const data = await apiGet(`/api/v1/projects/${ctx.projectId}`, ctx);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: (err as Error).message }),
        }],
      };
    }
  }

  throw new Error(`Unknown resource URI: ${uri}`);
});

// ─── LIST PROMPTS ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "bootstrap_fullstack_app",
      description: "Generate a complete starter plan and code scaffold for a full-stack app on PGBHub: database schema, auth, API functions, container deployment, and mail configuration.",
      arguments: [
        { name: "app_description", description: "Brief description of the app (e.g. 'SaaS invoice management tool')", required: true },
        { name: "tech_stack",      description: "Frontend tech (e.g. Next.js, React, Vue). Default: Next.js", required: false },
      ],
    },
    {
      name: "generate_feature_module",
      description: "Generate a complete PGBHub serverless function module for a specific feature, including typed request/response handlers, DB queries, and ambient context usage.",
      arguments: [
        { name: "feature_name",   description: "Feature name (e.g. 'checkout', 'user-profile', 'notifications')", required: true },
        { name: "http_methods",   description: "Comma-separated HTTP methods to implement (e.g. 'GET,POST'). Default: GET,POST", required: false },
        { name: "db_tables",      description: "Comma-separated list of DB tables this feature interacts with", required: false },
      ],
    },
  ],
}));

// ─── GET PROMPT ───────────────────────────────────────────────────────────────

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: promptArgs } = request.params;

  if (name === "bootstrap_fullstack_app") {
    const desc = (promptArgs?.app_description as string) || "a full-stack web application";
    const stack = (promptArgs?.tech_stack as string) || "Next.js";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to build ${desc} using ${stack} on the frontend and PGBHub as the backend.

Please:
1. Use \`pgbhub_provision_project\` to create the project
2. Use \`pgbhub_create_table\` to design the database schema (suggest appropriate tables with proper types)
3. Use \`pgbhub_configure_auth\` to configure authentication
4. Use \`pgbhub_deploy_function\` to create the core API function modules
5. Provide a complete \`pgb.config.json\` and \`.env.example\`
6. Show how to initialize the \`@pgb/sdk\` client in ${stack}

Return a complete, production-ready starter scaffold.`,
          },
        },
      ],
    };
  }

  if (name === "generate_feature_module") {
    const feature = (promptArgs?.feature_name as string) || "feature";
    const methods = (promptArgs?.http_methods as string) || "GET,POST";
    const tables  = (promptArgs?.db_tables as string) || "";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a complete PGBHub serverless function module for the "${feature}" feature.

Requirements:
- HTTP methods to implement: ${methods}
- Database tables used: ${tables || "(determine appropriate tables)"}
- Use Hono-style named exports: \`export async function GET(req, ctx) {...}\`
- Use ambient context: \`ctx.db\`, \`ctx.user\`, \`ctx.storage\`, \`ctx.email\`, \`ctx.secrets\`
- Include input validation, error handling, and TypeScript types
- Add JSDoc comments

Then deploy it with \`pgbhub_deploy_function\`.`,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
});

// ─── CALL TOOL ────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  function err(msg: string): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }

  try {
    // ── pgbhub_help ──────────────────────────────────────────────────────────
    if (name === "pgbhub_help") {
      const topic = (args?.topic as string) || "overview";
      const topicContent: Record<string, string> = {
        overview:   INSTRUCTIONS_TEXT,
        sql:        "## SQL Execution\n\nUse `pgbhub_execute_sql` with parameterized queries ($1, $2, ...) or `pgbhub_query_crud` for typed CRUD operations without writing SQL.\n\nStatement timeout: 5s (configurable up to 30s).\nMemory cap: 16 MB work_mem per query.\nBlocked: DROP DATABASE, ALTER SYSTEM, and raw DDL concatenation.",
        functions:  "## Serverless Functions\n\nDeploy TypeScript modules with `pgbhub_deploy_function`. Each module handles a sub-path:\n- `functions/checkout.ts` → `/<projectId>.pgbhub.dev/checkout/*`\n- Named exports: GET, POST, PUT, DELETE\n- Ambient context: `{ db, user, storage, email, secrets, params, query }`\n- Cold start: <25ms via CRIU memory snapshot restore",
        containers: "## Containers\n\nDeploy Docker images with `pgbhub_deploy_container`. Features:\n- Scale-to-zero (0 MB RAM when idle, <25ms cold start via CRIU)\n- Timezone-aware scheduled windows (e.g. 09:00–18:00 Europe/London)\n- Auto-scaling: 1–20 replicas based on concurrency\n- Payment card required for >1 replica or Standard+ tier\n- Egress: SMTP ports 25/465/587 blocked by default on free tier",
        auth:       "## Auth as a Service\n\nBuilt-in auth routes at `/<projectId>.pgbhub.dev/auth/*`:\n- POST /auth/signup, /auth/login, /auth/verify\n- POST /auth/magic (magic link), /auth/otp\n- GET  /auth/user (current user)\nFree for up to 5,000 MAUs/month. JWT tokens with Argon2id password hashing.",
        storage:    "## R2/S3 Storage\n\nGet presigned upload URLs via `pgbhub_upload_asset`. Features:\n- 500 MB free storage pool per account\n- Project-prefix partitioning: projects/<projectId>/<filePath>\n- Public CDN caching: Cache-Control: public, max-age=31536000\n- 15-minute presigned URL TTL",
        mail:       "## Transactional Mail\n\nSend email via `pgbhub_send_mail`. Features:\n- 100 free emails/month via managed AWS SES (noreply@mail.pgbhub.dev)\n- BYO SMTP/domain: $0.00 platform fee\n- Overage: $0.001/email with verified payment card\n- Velocity limit: 5 emails/minute on free tier\n- Reputation quarantine: 2.5% bounce rate or 0.08% complaint rate threshold",
        billing:    "## Billing & Pricing\n\nDual-axis invoicing: by Resource Type AND by Project.\n\n| Resource | Free | Paid |\n|---|---|---|\n| DB compute | 20 hours/mo | $0.014–$0.250/hr |\n| Storage | 500 MB | $0.20/GB/mo |\n| Auth MAUs | 5,000/mo | $0.002/MAU |\n| Emails | 100/mo | $0.001/email |\n| Backups | Manual only | $1/mo (<500MB), $5/mo (500MB–5GB) |\n| Containers | Micro scale-to-zero | $0.03–$0.25/hr |\n\n$5.00 minimum billing threshold.",
        cli:        "## Local CLI\n\n```bash\nnpx pgb login\nnpx pgb init my-app\nnpx pgb dev        # local simulator on port 4000\n```\n\nProject structure:\n```\nfunctions/          # serverless function modules\ncontainers/         # Dockerfile(s)\ncron/               # scheduled jobs\nmigrations/         # SQL migration files\npgb.config.json     # project config\n.env.example        # env variable template\n```",
      };
      return ok({ topic, content: topicContent[topic] || INSTRUCTIONS_TEXT });
    }

    // ── pgbhub_provision_project ─────────────────────────────────────────────
    if (name === "pgbhub_provision_project") {
      const projName = String(args?.name || "").trim().toLowerCase();
      const region   = String(args?.region || "eu-west-1");
      const ephemeral = Boolean(args?.ephemeral ?? false);

      // If no API key configured, auto-provision sandbox instead
      if (!PGBHUB_API_KEY && !ephemeral) {
        const ctx = await ensureSandbox();
        return ok({
          message: "Ephemeral sandbox project auto-provisioned (no API key configured).",
          ...ctx,
          instructions: `Claim your project at: ${ctx.claimUrl}`,
        });
      }

      const headers = authHeaders(PGBHUB_API_KEY);
      const res = await fetch(`${PGBHUB_ENDPOINT}/api/v1/projects`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: projName, region, ephemeral }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error((data?.error as string) || `HTTP ${res.status}`);

      const projectId  = data.id as string;
      const projectUrl = `https://${projectId}.pgbhub.dev`;
      return ok({
        ...data,
        project_url: projectUrl,
        postgres_connection_string: `postgresql://<user>:<password>@${projectId}.pgbhub.dev:5432/${projName}`,
        sdk_init: `import { createClient } from '@pgb/sdk';\nconst pgb = createClient('${projectUrl}', { key: process.env.PGB_SECRET_KEY });`,
      });
    }

    // ── pgbhub_get_project_graph ─────────────────────────────────────────────
    if (name === "pgbhub_get_project_graph") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const data = await apiGet(`/api/v1/projects/${pid}`, ctx);
      return ok(data);
    }

    // ── pgbhub_execute_sql ───────────────────────────────────────────────────
    if (name === "pgbhub_execute_sql") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const sql = String(args?.sql || "").trim();
      if (!sql) throw new Error("sql is required");
      const params     = (args?.params as unknown[]) || [];
      const timeout_ms = Number(args?.timeout_ms ?? 5000);
      const data = await apiPost(`/api/v1/projects/${pid}/sql`, { sql, params, timeout_ms }, ctx);
      return ok(data);
    }

    // ── pgbhub_create_table ──────────────────────────────────────────────────
    if (name === "pgbhub_create_table") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const tableName = String(args?.table_name || "").trim();
      if (!tableName) throw new Error("table_name is required");
      const columns = (args?.columns as Array<{
        name: string; type: string; primary_key?: boolean; nullable?: boolean; default?: string;
      }>) || [];
      if (!columns.length) throw new Error("columns list cannot be empty");

      const colDefs = columns.map((c) => {
        let def = `"${c.name}" ${c.type}`;
        if (c.primary_key) def += " PRIMARY KEY";
        if (c.nullable === false) def += " NOT NULL";
        if (c.default) def += ` DEFAULT ${c.default}`;
        return def;
      });
      const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n);`;

      const data = await apiPost(`/api/v1/projects/${pid}/sql`, {
        sql: ddl,
        params: [],
        timeout_ms: 10000,
      }, ctx);
      return ok({ success: true, table: tableName, ddl, result: data });
    }

    // ── pgbhub_query_crud ────────────────────────────────────────────────────
    if (name === "pgbhub_query_crud") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const op    = String(args?.operation || "find").toLowerCase();
      const table = String(args?.table || "").trim();
      if (!table) throw new Error("table is required");

      const allowed = ["find", "insert", "update", "delete", "count"];
      if (!allowed.includes(op)) throw new Error(`Invalid operation '${op}'. Allowed: ${allowed.join(", ")}`);

      const data = await apiPost(`/api/v1/projects/${pid}/crud`, {
        operation: op,
        table,
        data:     args?.data,
        filter:   args?.filter,
        limit:    args?.limit   ?? 100,
        offset:   args?.offset  ?? 0,
        order_by: args?.order_by,
        order:    args?.order   ?? "ASC",
      }, ctx);
      return ok(data);
    }

    // ── pgbhub_deploy_function ───────────────────────────────────────────────
    if (name === "pgbhub_deploy_function") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const moduleName = String(args?.module_name || "").trim();
      const code       = String(args?.code || "").trim();
      const runtime    = String(args?.runtime || "typescript");
      if (!moduleName) throw new Error("module_name is required");
      if (!code)       throw new Error("code is required");

      const data = await apiPost(`/api/v1/projects/${pid}/functions/deploy`, {
        module_name: moduleName,
        code,
        runtime,
      }, ctx);
      return ok({
        ...((data as Record<string, unknown>) || {}),
        endpoint: `https://${ctx.projectId}.pgbhub.dev/${moduleName}`,
      });
    }

    // ── pgbhub_deploy_container ──────────────────────────────────────────────
    if (name === "pgbhub_deploy_container") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const image        = String(args?.image || "").trim();
      const tier         = String(args?.tier || "micro");
      const min_replicas = Number(args?.min_replicas ?? 0);
      const max_replicas = Number(args?.max_replicas ?? 1);
      const schedule     = args?.schedule as string | undefined;
      const env          = (args?.env as Record<string, string>) || {};
      if (!image) throw new Error("image is required");

      const data = await apiPost(`/api/v1/projects/${pid}/containers/deploy`, {
        image, tier, min_replicas, max_replicas, schedule, env,
      }, ctx);
      return ok(data);
    }

    // ── pgbhub_configure_auth ────────────────────────────────────────────────
    if (name === "pgbhub_configure_auth") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const data = await apiPatch(`/api/v1/projects/${pid}/auth/config`, {
        enable_email_signup:   args?.enable_email_signup,
        enable_magic_links:    args?.enable_magic_links,
        enable_otp:            args?.enable_otp,
        jwt_expiry_hours:      args?.jwt_expiry_hours,
        refresh_expiry_days:   args?.refresh_expiry_days,
        allowed_email_domains: args?.allowed_email_domains,
      }, ctx);
      return ok(data);
    }

    // ── pgbhub_upload_asset ──────────────────────────────────────────────────
    if (name === "pgbhub_upload_asset") {
      const ctx = await ensureSandbox();
      const pid          = (args?.project_id as string) || ctx.projectId;
      const file_path    = String(args?.file_path || "").trim();
      const content_type = String(args?.content_type || "application/octet-stream");
      const isPublic     = Boolean(args?.public ?? false);
      if (!file_path) throw new Error("file_path is required");

      const data = await apiPost(`/api/v1/projects/${pid}/storage/upload-url`, {
        path:         `projects/${pid}/${file_path}`,
        content_type,
        public:       isPublic,
        ttl_seconds:  900,
      }, ctx);
      return ok(data);
    }

    // ── pgbhub_send_mail ─────────────────────────────────────────────────────
    if (name === "pgbhub_send_mail") {
      const ctx = await ensureSandbox();
      const pid = (args?.project_id as string) || ctx.projectId;
      const to      = String(args?.to || "").trim();
      const subject = String(args?.subject || "").trim();
      const text    = String(args?.text || "").trim();
      if (!to)      throw new Error("to is required");
      if (!subject) throw new Error("subject is required");
      if (!text)    throw new Error("text is required");

      const data = await apiPost(`/api/v1/projects/${pid}/mail/send`, {
        to, subject, text,
        html:     args?.html,
        reply_to: args?.reply_to,
      }, ctx);
      return ok(data);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return err((error as Error).message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = PGBHUB_API_KEY ? "authenticated" : "zero-config sandbox";
  console.error(`@pgb/mcp v2.0.0 running (mode: ${mode}, endpoint: ${PGBHUB_ENDPOINT})`);
}

run().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});
