import { describe, expect, it } from "vitest";
import {
  SUITE_TOOLS, createSuite, freeSlots, paginate, parseRange, readRange, render, writeRange, type FetchLike,
} from "../src/suite";

const KEY = "pgbm_testkey_0123456789abcdef";
const BASE = "https://biz.example.com";

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A fetch mock: routes are "METHOD path-prefix" -> response. Records every call. */
function mockFetch(routes: Record<string, { status?: number; json?: unknown; text?: string; type?: string }>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method || "GET";
    let body: unknown = init.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* raw */ } }
    calls.push({ url, method, headers: init.headers || {}, body });
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const match = Object.keys(routes).filter((k) => {
      const [m, p] = k.split(" ");
      return m === method && path.startsWith(p);
    }).sort((a, b) => b.length - a.length)[0];
    const r = match ? routes[match] : { status: 404, json: { error: "Not found" } };
    const status = r.status ?? 200;
    const type = r.type ?? (r.text !== undefined ? "text/plain" : "application/json");
    return {
      ok: status >= 200 && status < 300, status, statusText: "",
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? type : null) },
      json: async () => r.json, text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.json)),
    };
  };
  return { fetch, calls };
}

const ME = { "GET /api/v1/mailbox/me": { json: { mailboxes: [{ address: "ana@acme.com" }] } } };
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("tool list", () => {
  it("has unique names, object schemas and confirm on destructive tools", () => {
    const names = SUITE_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of SUITE_TOOLS) expect(t.inputSchema.type).toBe("object");
    for (const n of ["calendar_delete_event", "drive_share", "drive_trash", "chat_post_message", "invoices_delete_draft", "invoices_get_payment_link", "tasks_delete", "notes_delete"]) {
      const t = SUITE_TOOLS.find((x) => x.name === n)!;
      expect(t.inputSchema.required).toContain("confirm");
    }
    expect(names.some((n) => n.startsWith("business_"))).toBe(false);
  });
});

describe("requests", () => {
  it("sends the key as a Bearer token to <base>/api/v1 and builds the query", async () => {
    const { fetch, calls } = mockFetch({ ...ME, "GET /api/v1/calendar/ana%40acme.com/events": { json: { events: [{ id: "e1" }] } } });
    const s = createSuite({ baseUrl: `${BASE}/`, key: KEY, fetch });
    const r = await s.call("calendar_list_events", { from: "2026-10-20", to: "2026-10-21", tz: "Africa/Lagos" });
    expect(r.isError).toBeFalsy();
    const c = calls[1];
    expect(c.method).toBe("GET");
    expect(c.url).toBe(`${BASE}/api/v1/calendar/ana%40acme.com/events?from=2026-10-20&to=2026-10-21&tz=Africa%2FLagos`);
    expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(text(r)).events[0].id).toBe("e1");
  });

  it("uses the mailbox argument without looking it up", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/v1/contacts/bo%40acme.com/contacts": { json: { contacts: [] } } });
    await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("contacts_search", { query: "lee", mailbox: "bo@acme.com" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/v1/contacts/bo%40acme.com/contacts?q=lee`);
  });

  it("POSTs JSON bodies with only the given fields", async () => {
    const { fetch, calls } = mockFetch({ "POST /api/v1/tasks/tasks": { json: { task: { id: "t1" } } } });
    await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("tasks_create", { title: "Call Ade", due_at: "2026-10-21T10:00:00Z" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual({ title: "Call Ade", due_at: "2026-10-21T10:00:00Z" });
  });

  it("tasks_complete PATCHes completed: true", async () => {
    const { fetch, calls } = mockFetch({ "PATCH /api/v1/tasks/tasks/t1": { json: { task: { id: "t1", completed: true } } } });
    await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("tasks_complete", { task_id: "t1" });
    expect(calls[0]).toMatchObject({ method: "PATCH", url: `${BASE}/api/v1/tasks/tasks/t1`, body: { completed: true } });
  });

  it("encodes ids in paths", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/v1/drive/items/": { json: {} } });
    await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("drive_get", { item_id: "../a b" });
    expect(calls[0].url).toBe(`${BASE}/api/v1/drive/items/..%2Fa%20b`);
  });

  it("refuses without a key and never calls the API", async () => {
    const { fetch, calls } = mockFetch({});
    const r = await createSuite({ baseUrl: BASE, key: "", fetch }).call("search_all", { query: "acme" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/PGB_BUSINESS_KEY/);
    expect(calls).toHaveLength(0);
  });

  it("reports missing required arguments", async () => {
    const { fetch, calls } = mockFetch({});
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("search_all", {});
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/query is required/);
    expect(calls).toHaveLength(0);
  });
});

describe("confirm gating", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["chat_post_message", { channel_id: "c1", body: "hi" }],
    ["drive_share", { item_id: "i1", type: "link" }],
    ["drive_trash", { item_id: "i1" }],
    ["calendar_delete_event", { event_id: "e1", mailbox: "a@b.c" }],
    ["calendar_create_event", { title: "Sync", start: "2026-10-20T10:00", participants: [{ email: "x@y.z" }], mailbox: "a@b.c" }],
    ["invoices_delete_draft", { document_id: "inv1" }],
    ["invoices_get_payment_link", { document_id: "inv1" }],
    ["tasks_delete", { task_id: "t1" }],
    ["notes_delete", { note_id: "n1" }],
  ];
  for (const [name, args] of cases) {
    it(`${name} does nothing without confirm: true`, async () => {
      const { fetch, calls } = mockFetch({});
      const s = createSuite({ baseUrl: BASE, key: KEY, fetch });
      for (const confirm of [undefined, false, "true"]) {
        const r = await s.call(name, { ...args, ...(confirm === undefined ? {} : { confirm }) });
        expect(r.isError).toBe(true);
        expect(text(r)).toMatch(/confirm: true/);
      }
      expect(calls).toHaveLength(0);
    });
  }

  it("goes through with confirm: true", async () => {
    const { fetch, calls } = mockFetch({ "POST /api/v1/chat/channels/c1/messages": { json: { message: { id: 9 } } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("chat_post_message", { channel_id: "c1", body: "hi", thread_root: 4, confirm: true });
    expect(r.isError).toBeFalsy();
    expect(calls[0].body).toEqual({ body: "hi", thread_root: 4 });
  });

  it("guest-free calendar events need no confirm", async () => {
    const { fetch, calls } = mockFetch({ "POST /api/v1/calendar/a%40b.c/events": { json: { event: {} } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("calendar_create_event", { title: "Focus", start: "2026-10-20T10:00", end: "2026-10-20T11:00", time_zone: "UTC", mailbox: "a@b.c" });
    expect(r.isError).toBeFalsy();
    expect(calls[0].body).toEqual({ title: "Focus", start: "2026-10-20T10:00", end: "2026-10-20T11:00", time_zone: "UTC" });
  });
});

describe("errors", () => {
  it("maps 403 to status, the API's message and a policy hint", async () => {
    const { fetch } = mockFetch({ "POST /api/v1/chat/channels/c1/messages": { status: 403, json: { error: "This credential lacks the 'send' permission." } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("chat_post_message", { channel_id: "c1", body: "x", confirm: true });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 403: This credential lacks the 'send' permission\./);
    expect(text(r)).toMatch(/agent policy/);
  });

  it("includes policy reasons", async () => {
    const { fetch } = mockFetch({ "GET /api/v1/collections": { status: 403, json: { error: "refused", reasons: ["reading is limited"] } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("collections_list", {});
    expect(text(r)).toMatch(/Reasons: reading is limited/);
  });

  it("never leaks the key or other tokens, and ignores HTML error pages", async () => {
    const { fetch } = mockFetch({
      "GET /api/v1/notes/notes": { status: 400, json: { error: `bad token ${KEY} and pgbs_session_abcdef123456` } },
      "GET /api/v1/search": { status: 502, text: "<html>secret upstream page</html>", type: "text/html" },
    });
    const s = createSuite({ baseUrl: BASE, key: KEY, fetch });
    const r1 = text(await s.call("notes_list", {}));
    expect(r1).not.toContain(KEY);
    expect(r1).not.toContain("pgbs_session");
    expect(r1).toContain("[redacted]");
    const r2 = text(await s.call("search_all", { query: "abc" }));
    expect(r2).toMatch(/HTTP 502/);
    expect(r2).not.toContain("secret upstream");
  });

  it("explains 202 held results", async () => {
    const { fetch } = mockFetch({ "POST /api/v1/tasks/tasks": { status: 202, json: { pending: true, id: "p1" } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("tasks_create", { title: "x" });
    expect(JSON.parse(text(r))).toMatchObject({ pending: true, id: "p1" });
    expect(text(r)).toMatch(/approve/);
  });
});

describe("output shaping", () => {
  it("pages long lists client-side", () => {
    const data = { items: Array.from({ length: 120 }, (_, i) => i), other: 1 };
    const p = paginate(data, { limit: 50, offset: 100 }) as { items: number[]; page: Record<string, unknown> };
    expect(p.items).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(p.page).toMatchObject({ total: 120, offset: 100, returned: 20, next_offset: null });
    const first = paginate(data, {}) as { page: { next_offset: number } };
    expect(first.page.next_offset).toBe(50);
  });

  it("truncates long strings and long output with a note", () => {
    const out = render({ body: "x".repeat(20_000) });
    expect(out).toMatch(/truncated 12000 more characters/);
    const big = render({ rows: Array.from({ length: 5000 }, (_, i) => `row ${i}`) }, 1000);
    expect(big.length).toBeLessThan(1300);
    expect(big).toMatch(/output truncated: showing 1000 of/);
  });

  it("tool results are capped", async () => {
    const { fetch } = mockFetch({ "GET /api/v1/meet/rooms": { json: { rooms: Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, title: "Weekly sync" })) } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch, maxChars: 2000 }).call("meet_list_rooms", {});
    expect(text(r)).toMatch(/output truncated/);
  });
});

describe("drive", () => {
  it("drive_read_text fetches the signed URL without the key and truncates", async () => {
    const { fetch, calls } = mockFetch({
      "GET /api/v1/drive/items/f1/preview": { json: { kind: "text", name: "a.txt", mime: "text/plain", size: 10, url: "https://storage.example.net/obj?sig=1" } },
      "GET https://storage.example.net/obj": { text: "y".repeat(150_000) },
    });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch, maxChars: 500_000 }).call("drive_read_text", { item_id: "f1" });
    expect(calls[1].url).toBe("https://storage.example.net/obj?sig=1");
    expect(calls[1].headers.Authorization).toBeUndefined();
    const out = JSON.parse(text(r));
    expect(out.truncated).toMatch(/of 150000 characters/);
  });

  it("drive_read_text refuses non-text files", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/v1/drive/items/f2/preview": { json: { kind: "image", name: "p.png", mime: "image/png", url: "https://s/x" } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("drive_read_text", { item_id: "f2" });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("drive_upload: create, PUT to storage (no key), complete", async () => {
    const { fetch, calls } = mockFetch({
      "POST /api/v1/drive/uploads/u1/complete": { json: { item: { id: "i1" } } },
      "POST /api/v1/drive/uploads": { json: { upload_id: "u1", item_id: "i1", method: "PUT", url: "https://storage.example.net/put?sig=2", headers: { "Content-Type": "text/csv" } } },
      "PUT https://storage.example.net/put": { json: {} },
    });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("drive_upload", { name: "a.csv", text: "a,b\n1,2\n", mime: "text/csv", parent: "fold1" });
    expect(r.isError).toBeFalsy();
    expect(calls[0].body).toEqual({ name: "a.csv", size: 8, mime: "text/csv", parent: "fold1" });
    expect(calls[1]).toMatchObject({ method: "PUT", url: "https://storage.example.net/put?sig=2" });
    expect(calls[1].headers.Authorization).toBeUndefined();
    expect(calls[2].url).toBe(`${BASE}/api/v1/drive/uploads/u1/complete`);
  });

  it("drive_upload enforces the size cap before any request", async () => {
    const { fetch, calls } = mockFetch({});
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("drive_upload", { name: "big.bin", base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("drive_upload cancels the upload when storage refuses", async () => {
    const { fetch, calls } = mockFetch({
      "POST /api/v1/drive/uploads": { json: { upload_id: "u9", item_id: "i9", url: "https://storage.example.net/put" } },
      "PUT https://storage.example.net/put": { status: 403, json: {} },
      "DELETE /api/v1/drive/uploads/u9": { json: { ok: true } },
    });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("drive_upload", { name: "a.txt", text: "hi" });
    expect(r.isError).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "DELETE"]);
  });
});

describe("calendar free time", () => {
  it("computes free windows across people", () => {
    const from = Date.parse("2026-10-20T09:00:00Z");
    const to = Date.parse("2026-10-20T17:00:00Z");
    const free = freeSlots([
      { start: "2026-10-20T10:00:00Z", end: "2026-10-20T11:00:00Z" },
      { start: "2026-10-20T10:30:00Z", end: "2026-10-20T12:00:00Z" },
      { start: "2026-10-20T12:10:00Z", end: "2026-10-20T16:00:00Z" },
    ], from, to, 30);
    expect(free).toEqual([
      { start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z", minutes: 60 },
      { start: "2026-10-20T16:00:00.000Z", end: "2026-10-20T17:00:00.000Z", minutes: 60 },
    ]);
  });

  it("asks free/busy for the mailbox plus the people", async () => {
    const { fetch, calls } = mockFetch({ ...ME, "GET /api/v1/calendar/ana%40acme.com/freebusy": { json: { people: [{ email: "ana@acme.com", available: true, busy: [] }, { email: "bo@acme.com", available: false, busy: [] }] } } });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("calendar_find_free_time", { people: ["Bo@acme.com"], from: "2026-10-20T09:00:00Z", to: "2026-10-20T10:00:00Z" });
    expect(calls[1].url).toContain("people=ana%40acme.com%2Cbo%40acme.com");
    const out = JSON.parse(text(r));
    expect(out.free).toHaveLength(1);
    expect(out.note).toMatch(/bo@acme.com/);
  });
});

describe("sheets", () => {
  const wb = () => ({
    sheetOrder: ["s1", "s2"],
    sheets: {
      s1: { id: "s1", name: "Sheet1", rowCount: 1000, columnCount: 26, cellData: { 0: { 0: { v: "Name" }, 1: { v: "Qty" } }, 1: { 0: { v: "Pen" }, 1: { v: 3, s: "bold" } }, 2: { 1: { f: "=SUM(B2:B2)", v: 3 } } } },
      s2: { id: "s2", name: "My data", cellData: {} },
    },
  });

  it("parses A1 ranges", () => {
    expect(parseRange("B2:D10")).toEqual({ sheet: null, r0: 1, c0: 1, r1: 9, c1: 3 });
    expect(parseRange("'My data'!A1")).toMatchObject({ sheet: "My data", r0: 0, c0: 0, r1: 0, c1: 0 });
    expect(parseRange("AA5")).toMatchObject({ c0: 26 });
    expect(() => parseRange("hello")).toThrow();
  });

  it("reads the used range with formulas", () => {
    const out = readRange(wb(), undefined) as { values: unknown[][]; formulas: Record<string, string>; range: string };
    expect(out.range).toBe("A1:B3");
    expect(out.values).toEqual([["Name", "Qty"], ["Pen", 3], [null, 3]]);
    expect(out.formulas).toEqual({ B3: "=SUM(B2:B2)" });
  });

  it("writes values, formulas and clears, keeping styles", () => {
    const w = wb();
    writeRange(w, "B2", [[5, "=B2*2"], [null]]);
    const cells = w.sheets.s1.cellData as Record<string, Record<string, Record<string, unknown>>>;
    expect(cells[1][1]).toEqual({ v: 5, s: "bold" });
    expect(cells[1][2]).toEqual({ f: "=B2*2" });
    expect(cells[2][1]).toBeUndefined();
    expect(() => writeRange(w, "A1", [[{ x: 1 }]])).toThrow();
  });

  it("sheets_update_range GETs, PUTs with rev, and releases the lock", async () => {
    const { fetch, calls } = mockFetch({
      "GET /api/v1/docs/items/sh1/sheet": { json: { rev: 7, snapshot: wb(), item: { id: "sh1" } } },
      "PUT /api/v1/docs/items/sh1/sheet": { json: { ok: true, rev: 8 } },
      "POST /api/v1/docs/items/sh1/lock": { json: { held: false } },
    });
    const r = await createSuite({ baseUrl: BASE, key: KEY, fetch }).call("sheets_update_range", { sheet_id: "sh1", range: "Sheet1!C1", values: [["Total"]] });
    expect(r.isError).toBeFalsy();
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "POST"]);
    const put = calls[1].body as { rev: number; snapshot: { sheets: { s1: { cellData: Record<string, Record<string, unknown>> } } } };
    expect(put.rev).toBe(7);
    expect(put.snapshot.sheets.s1.cellData[0][2]).toEqual({ v: "Total" });
    expect(calls[2].body).toEqual({ action: "release" });
  });
});
