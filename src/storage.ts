/**
 * PGBHub Storage tools: upload URLs, signed URLs and bucket visibility.
 *
 * All three go through the project storage API on the PGBHub endpoint
 * (`/api/v1/projects/{project}/storage/...`) with the configured API key, which
 * needs the project's `storage` capability (Owner, Admin or Billing, the
 * project's secret key, or an account key of such a member).
 *
 *   pgbhub_upload_asset            signed PUT URL for one object (optionally creates the bucket)
 *   pgbhub_signed_url              signed GET (download) or PUT (upload) URL for one object
 *   pgbhub_set_bucket_visibility   make a bucket private, or public with confirm_public: true
 *
 * Buckets are public by default. A private bucket's objects are readable only
 * by project members in the console, the project's secret key, or a signed URL.
 */

export type StorageArgs = Record<string, unknown>;

/** Sends one JSON request to the PGBHub API and returns the parsed body; throws on a non-2xx. */
export type StorageRequest = (method: string, path: string, body?: unknown) => Promise<unknown>;

export interface StorageToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

/** Refused before any request is sent (bad input or a missing confirmation). */
export class StorageInputError extends Error {}

const VISIBILITIES = ["public", "private"];
const METHODS = ["GET", "PUT"];

const projectIdProp = { type: "string", description: "Project ID or slug (defaults to the configured project)" };
const expiresProp = {
  type: "number",
  description: "URL lifetime in seconds (default 900 = 15 minutes; at most 86400 for GET and 3600 for PUT)",
};

export const STORAGE_TOOLS: StorageToolDef[] = [
  {
    name: "pgbhub_upload_asset",
    description:
      "Get a signed upload URL (HTTP PUT) for one object in a project storage bucket. Upload the bytes with " +
      "`PUT <url>` and the same Content-Type; no API key is needed for that request. The URL expires after " +
      "15 minutes by default. Pass `visibility` to create the bucket first when it does not exist yet " +
      "(an existing bucket's visibility is never changed here; use pgbhub_set_bucket_visibility).",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name (e.g. 'avatars' or 'receipts')" },
        file_path: { type: "string", description: "Object path inside the bucket (e.g. 'user-123/photo.png')" },
        content_type: { type: "string", description: "MIME type of the file (e.g. 'image/png'). The upload must use exactly this Content-Type." },
        visibility: {
          type: "string",
          enum: VISIBILITIES,
          description: "Create the bucket with this visibility if it does not exist. 'private' objects are readable only with the project's secret key or a signed URL. Omit to require an existing bucket.",
        },
        expires_in: expiresProp,
        project_id: projectIdProp,
      },
      required: ["bucket", "file_path", "content_type"],
    },
  },
  {
    name: "pgbhub_signed_url",
    description:
      "Create a signed URL for one object in a project storage bucket: GET to download it (works for private " +
      "buckets; the URL also answers HEAD) or PUT to upload it. Anyone holding the URL can use it until it " +
      "expires, so share it only with whoever should have that one object.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name" },
        path: { type: "string", description: "Object path inside the bucket (e.g. '2026/inv-1.pdf')" },
        method: { type: "string", enum: METHODS, description: "GET (download, the default) or PUT (upload)" },
        expires_in: expiresProp,
        content_type: { type: "string", description: "PUT only: bind the upload to this Content-Type. Required to allow HTML, SVG, XML or JavaScript uploads." },
        project_id: projectIdProp,
      },
      required: ["bucket", "path"],
    },
  },
  {
    name: "pgbhub_set_bucket_visibility",
    description:
      "Make a storage bucket private or public. Making it private takes effect within seconds: public URLs " +
      "stop working, but copies a browser or CDN already fetched are not recalled. Making it public exposes " +
      "every object in it to anyone with its URL, so it needs confirm_public: true; ask the user first.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "Bucket name" },
        visibility: { type: "string", enum: VISIBILITIES, description: "'private' or 'public'" },
        confirm_public: {
          type: "boolean",
          description: "Must be true to make a bucket public. Set it only after the user has explicitly agreed.",
        },
        project_id: projectIdProp,
      },
      required: ["bucket", "visibility"],
    },
  },
];

const STORAGE_TOOL_NAMES = new Set(STORAGE_TOOLS.map((t) => t.name));

export function isStorageTool(name: string): boolean {
  return STORAGE_TOOL_NAMES.has(name);
}

function need(a: StorageArgs, name: string): string {
  const v = a[name];
  if (v === undefined || v === null || String(v).trim() === "") throw new StorageInputError(`${name} is required`);
  return String(v).trim();
}

function oneOf(value: unknown, allowed: string[], name: string, upper = false): string {
  const v = String(value).trim();
  const norm = upper ? v.toUpperCase() : v.toLowerCase();
  if (!allowed.includes(norm)) throw new StorageInputError(`${name} must be one of: ${allowed.join(", ")}`);
  return norm;
}

function expiresIn(a: StorageArgs): number | undefined {
  if (a.expires_in === undefined || a.expires_in === null || a.expires_in === "") return undefined;
  const n = Number(a.expires_in);
  if (!Number.isInteger(n) || n <= 0) throw new StorageInputError("expires_in must be a whole number of seconds");
  return n;
}

const enc = encodeURIComponent;

/**
 * Runs one storage tool. `request` sends the API call (auth, endpoint and
 * error handling are the caller's); `projectId` is the default project.
 */
export async function callStorageTool(
  name: string,
  args: StorageArgs | undefined,
  deps: { request: StorageRequest; projectId: string },
): Promise<unknown> {
  const a = args || {};
  const pid = String(a.project_id || deps.projectId || "").trim();
  if (!pid) throw new StorageInputError("project_id is required (no project is configured)");
  const base = `/api/v1/projects/${enc(pid)}/storage/buckets`;

  if (name === "pgbhub_upload_asset") {
    const bucket = need(a, "bucket").toLowerCase();
    const filePath = need(a, "file_path").replace(/^\/+/, "");
    const contentType = need(a, "content_type");
    const ttl = expiresIn(a);
    let bucketCreated = false;
    let note: string | undefined;
    if (a.visibility !== undefined && a.visibility !== null && a.visibility !== "") {
      const wanted = oneOf(a.visibility, VISIBILITIES, "visibility");
      const listing = (await deps.request("GET", base)) as { buckets?: Array<{ name?: string; visibility?: string }> };
      const existing = (listing?.buckets || []).find((b) => String(b?.name || "").toLowerCase() === bucket);
      if (!existing) {
        await deps.request("POST", base, { name: bucket, visibility: wanted });
        bucketCreated = true;
      } else if (existing.visibility && existing.visibility !== wanted) {
        note = `Bucket '${bucket}' already exists and is ${existing.visibility}; its visibility was not changed. ` +
          "Use pgbhub_set_bucket_visibility to change it.";
      }
    }
    const signed = (await deps.request("POST", `${base}/${enc(bucket)}/signed-url`, {
      path: filePath,
      method: "PUT",
      content_type: contentType,
      ...(ttl !== undefined ? { expires_in: ttl } : {}),
    })) as Record<string, unknown>;
    return {
      ...signed,
      ...(bucketCreated ? { bucket_created: true } : {}),
      ...(note ? { note } : {}),
      how_to_upload: `PUT the file's bytes to url with header Content-Type: ${contentType}. No Authorization header is needed.`,
    };
  }

  if (name === "pgbhub_signed_url") {
    const bucket = need(a, "bucket").toLowerCase();
    const path = need(a, "path").replace(/^\/+/, "");
    const method = a.method === undefined || a.method === null || a.method === "" ? "GET" : oneOf(a.method, METHODS, "method", true);
    const ttl = expiresIn(a);
    const contentType = a.content_type === undefined || a.content_type === null ? "" : String(a.content_type).trim();
    if (contentType && method !== "PUT") throw new StorageInputError("content_type applies only to PUT (upload) URLs");
    return deps.request("POST", `${base}/${enc(bucket)}/signed-url`, {
      path,
      method,
      ...(ttl !== undefined ? { expires_in: ttl } : {}),
      ...(contentType ? { content_type: contentType } : {}),
    });
  }

  if (name === "pgbhub_set_bucket_visibility") {
    const bucket = need(a, "bucket").toLowerCase();
    const visibility = oneOf(need(a, "visibility"), VISIBILITIES, "visibility");
    if (visibility === "public" && a.confirm_public !== true) {
      throw new StorageInputError(
        `Making bucket '${bucket}' public exposes every object in it to anyone with its URL. ` +
        "Nothing was changed. Ask the user to confirm, then call again with confirm_public: true.",
      );
    }
    return deps.request("POST", `${base}/${enc(bucket)}/visibility`, {
      visibility,
      ...(visibility === "public" ? { confirm_public: true } : {}),
    });
  }

  throw new StorageInputError(`Unknown storage tool: ${name}`);
}
