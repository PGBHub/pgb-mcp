import { describe, expect, it } from "vitest";
import { STORAGE_TOOLS, StorageInputError, callStorageTool, isStorageTool } from "../src/storage";

interface Call { method: string; path: string; body: unknown }

/** A request mock: routes are "METHOD path" -> response body. Records every call. */
function mockRequest(routes: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const request = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (key in routes) return routes[key];
    if (path.endsWith("/signed-url")) return { success: true, url: "https://acme.pgbhub.app/storage/_signed/tok", method: (body as { method: string }).method };
    return { success: true };
  };
  return { request, calls };
}

const PID = "prj_1";
const BASE = `/api/v1/projects/${PID}/storage/buckets`;

describe("storage tool list", () => {
  it("defines the three tools with object schemas and no public flag", () => {
    const names = STORAGE_TOOLS.map((t) => t.name);
    expect(names).toEqual(["pgbhub_upload_asset", "pgbhub_signed_url", "pgbhub_set_bucket_visibility"]);
    for (const t of STORAGE_TOOLS) expect(t.inputSchema.type).toBe("object");
    const upload = STORAGE_TOOLS[0];
    expect(upload.inputSchema.required).toEqual(["bucket", "file_path", "content_type"]);
    expect(upload.inputSchema.properties).not.toHaveProperty("public");
    expect(upload.inputSchema.properties).toHaveProperty("visibility");
    expect(isStorageTool("pgbhub_signed_url")).toBe(true);
    expect(isStorageTool("pgbhub_send_mail")).toBe(false);
  });
});

describe("pgbhub_upload_asset", () => {
  it("asks the signed-url endpoint for a PUT URL, with no projects/ prefix on the path", async () => {
    const { request, calls } = mockRequest();
    const out = await callStorageTool("pgbhub_upload_asset",
      { bucket: "Avatars", file_path: "/user-1/a.png", content_type: "image/png" }, { request, projectId: PID }) as Record<string, unknown>;
    expect(calls).toEqual([{
      method: "POST", path: `${BASE}/avatars/signed-url`,
      body: { path: "user-1/a.png", method: "PUT", content_type: "image/png" },
    }]);
    expect(out.url).toBe("https://acme.pgbhub.app/storage/_signed/tok");
    expect(String(out.how_to_upload)).toContain("Content-Type: image/png");
    expect(out).not.toHaveProperty("bucket_created");
  });

  it("creates a missing bucket with the requested visibility first", async () => {
    const { request, calls } = mockRequest({ [`GET ${BASE}`]: { buckets: [{ name: "other", visibility: "public" }] } });
    const out = await callStorageTool("pgbhub_upload_asset",
      { bucket: "receipts", file_path: "inv.pdf", content_type: "application/pdf", visibility: "private", expires_in: 600 },
      { request, projectId: PID }) as Record<string, unknown>;
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${BASE}`, `POST ${BASE}`, `POST ${BASE}/receipts/signed-url`]);
    expect(calls[1].body).toEqual({ name: "receipts", visibility: "private" });
    expect(calls[2].body).toEqual({ path: "inv.pdf", method: "PUT", content_type: "application/pdf", expires_in: 600 });
    expect(out.bucket_created).toBe(true);
  });

  it("never changes an existing bucket's visibility, and says so", async () => {
    const { request, calls } = mockRequest({ [`GET ${BASE}`]: { buckets: [{ name: "receipts", visibility: "public" }] } });
    const out = await callStorageTool("pgbhub_upload_asset",
      { bucket: "receipts", file_path: "inv.pdf", content_type: "application/pdf", visibility: "private" },
      { request, projectId: PID }) as Record<string, unknown>;
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1].path).toBe(`${BASE}/receipts/signed-url`);
    expect(String(out.note)).toMatch(/already exists and is public/);
  });

  it("uses project_id over the default, encoded", async () => {
    const { request, calls } = mockRequest();
    await callStorageTool("pgbhub_upload_asset", { bucket: "b", file_path: "x", content_type: "text/plain", project_id: "my proj" }, { request, projectId: PID });
    expect(calls[0].path).toBe("/api/v1/projects/my%20proj/storage/buckets/b/signed-url");
  });

  it("refuses missing arguments and bad visibility before any request", async () => {
    const { request, calls } = mockRequest();
    await expect(callStorageTool("pgbhub_upload_asset", { file_path: "x", content_type: "a/b" }, { request, projectId: PID })).rejects.toThrow("bucket is required");
    await expect(callStorageTool("pgbhub_upload_asset", { bucket: "b", file_path: "x", content_type: "a/b", visibility: "secret" }, { request, projectId: PID })).rejects.toThrow(StorageInputError);
    await expect(callStorageTool("pgbhub_upload_asset", { bucket: "b", file_path: "x", content_type: "a/b" }, { request, projectId: "" })).rejects.toThrow("project_id is required");
    expect(calls).toHaveLength(0);
  });
});

describe("pgbhub_signed_url", () => {
  it("defaults to GET and sends expires_in", async () => {
    const { request, calls } = mockRequest();
    await callStorageTool("pgbhub_signed_url", { bucket: "receipts", path: "2026/inv-1.pdf", expires_in: 900 }, { request, projectId: PID });
    expect(calls).toEqual([{ method: "POST", path: `${BASE}/receipts/signed-url`, body: { path: "2026/inv-1.pdf", method: "GET", expires_in: 900 } }]);
  });

  it("binds content_type on PUT", async () => {
    const { request, calls } = mockRequest();
    await callStorageTool("pgbhub_signed_url", { bucket: "u", path: "a.png", method: "put", content_type: "image/png" }, { request, projectId: PID });
    expect(calls[0].body).toEqual({ path: "a.png", method: "PUT", content_type: "image/png" });
  });

  it("refuses content_type on GET, an unknown method and a bad expires_in", async () => {
    const { request, calls } = mockRequest();
    const deps = { request, projectId: PID };
    await expect(callStorageTool("pgbhub_signed_url", { bucket: "u", path: "a", content_type: "image/png" }, deps)).rejects.toThrow(/only to PUT/);
    await expect(callStorageTool("pgbhub_signed_url", { bucket: "u", path: "a", method: "DELETE" }, deps)).rejects.toThrow(/GET, PUT/);
    await expect(callStorageTool("pgbhub_signed_url", { bucket: "u", path: "a", expires_in: 1.5 }, deps)).rejects.toThrow(/whole number/);
    expect(calls).toHaveLength(0);
  });
});

describe("pgbhub_set_bucket_visibility", () => {
  it("makes a bucket private without confirmation", async () => {
    const { request, calls } = mockRequest();
    await callStorageTool("pgbhub_set_bucket_visibility", { bucket: "receipts", visibility: "private" }, { request, projectId: PID });
    expect(calls).toEqual([{ method: "POST", path: `${BASE}/receipts/visibility`, body: { visibility: "private" } }]);
  });

  it("refuses to make a bucket public without confirm_public: true, and sends nothing", async () => {
    const { request, calls } = mockRequest();
    for (const confirm of [undefined, false, "true", 1]) {
      await expect(callStorageTool("pgbhub_set_bucket_visibility", { bucket: "receipts", visibility: "public", confirm_public: confirm },
        { request, projectId: PID })).rejects.toThrow(/confirm_public: true/);
    }
    expect(calls).toHaveLength(0);
  });

  it("makes a bucket public with confirm_public: true", async () => {
    const { request, calls } = mockRequest();
    await callStorageTool("pgbhub_set_bucket_visibility", { bucket: "assets", visibility: "public", confirm_public: true }, { request, projectId: PID });
    expect(calls).toEqual([{ method: "POST", path: `${BASE}/assets/visibility`, body: { visibility: "public", confirm_public: true } }]);
  });
});
