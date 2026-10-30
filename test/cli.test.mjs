import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operations } from "@pitchmentor/sdk";
import { run, table } from "../dist/cli.js";
import { COMMANDS } from "../dist/commands.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function cli(argv, responses = [], env = {}) {
  const out = [], err = [], calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    return responses.shift();
  };
  const code = await run(argv, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { PITCHMENTOR_API_KEY: "pm_live_test", PITCHMENTOR_BASE_URL: "http://api.test", PITCHMENTOR_CONFIG: "/nonexistent/cli.json", ...env },
    stdin: async () => "",
    fetch,
  });
  return { code, out: out.join("\n"), err: err.join("\n"), calls };
}

test("every operation has a command", () => {
  const mapped = Object.values(COMMANDS).flatMap((c) => Object.values(c)).sort();
  assert.deepEqual(mapped, Object.keys(operations).sort());
});

test("list renders a table and maps kebab flags to query params", async () => {
  const r = await cli(["calls", "list", "--member-id", "u1", "--limit", "2", "--archived"], [
    json({ data: [{ id: "c1", prospectName: "Ada", objectionsDetected: [] }], has_more: true, next_cursor: "c1" }),
  ]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls[0].url.search, "?member_id=u1&limit=2&archived=true");
  assert.match(r.out, /^ID\s+PROSPECTNAME\nc1\s+Ada/);
  assert.match(r.out, /--cursor c1/);
});

test("--json prints raw JSON; group default command; positional id", async () => {
  const r = await cli(["calls", "c1", "--json"], [json({ data: [], has_more: false, next_cursor: null })]);
  assert.equal(r.code, 2); // `calls` defaults to list, which takes no id
  const g = await cli(["calls", "get", "c1", "--json"], [json({ call: { id: "c1" }, coachingLogs: [] })]);
  assert.equal(g.calls[0].url.pathname, "/v1/calls/c1");
  assert.deepEqual(JSON.parse(g.out), { call: { id: "c1" }, coachingLogs: [] });
});

test("body from flags and --data; comma lists", async () => {
  const r = await cli(["api-keys", "create", "--name", "ci", "--scopes", "calls:read, leads:read"], [json({ id: "k1", key: "pm_live_x" }, 201)]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.calls[0].body), { name: "ci", scopes: ["calls:read", "leads:read"] });
  const d = await cli(["leads", "upsert", "--data", '{"name":"A","notes":[{"content":"x"}]}', "--email", "a@b.co"], [json({ lead: { id: "l1" }, action: "created" }, 201)]);
  assert.deepEqual(JSON.parse(d.calls[0].body), { name: "A", notes: [{ content: "x" }], email: "a@b.co" });
});

test("--all follows cursors", async () => {
  const r = await cli(["leads", "list", "--all", "--json"], [
    json({ data: [{ id: "a" }], has_more: true, next_cursor: "a" }),
    json({ data: [{ id: "b" }], has_more: false, next_cursor: null }),
  ]);
  assert.deepEqual(JSON.parse(r.out).map((l) => l.id), ["a", "b"]);
});

test("destructive commands need --yes; API errors exit 1", async () => {
  const r = await cli(["api-keys", "revoke", "k1"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--yes/);
  const e = await cli(["webhooks", "delete", "w1", "--yes"], [json({ error: { code: "not_found", message: "Webhook endpoint not found" } }, 404)]);
  assert.equal(e.code, 1);
  assert.equal(e.err, "Error (404 not_found): Webhook endpoint not found");
});

test("unknown flags and missing key are usage errors", async () => {
  assert.equal((await cli(["calls", "list", "--nope", "1"])).code, 2);
  const r = await cli(["me"], [], { PITCHMENTOR_API_KEY: "" });
  assert.equal(r.code, 2);
});

test("login validates and stores the key with 0600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-cli-"));
  const cfg = join(dir, "cli.json");
  const r = await cli(["login", "--api-key", "pm_live_new"], [json({ team: { id: "t", name: "Acme" }, apiKey: { id: "k", name: "ci", scopes: [] } })], { PITCHMENTOR_CONFIG: cfg, PITCHMENTOR_API_KEY: "" });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls[0].headers.Authorization, "Bearer pm_live_new");
  assert.equal(JSON.parse(readFileSync(cfg, "utf8")).apiKey, "pm_live_new");
  assert.equal(statSync(cfg).mode & 0o777, 0o600);
  const me = await cli(["me", "--json"], [json({ team: {}, apiKey: {} })], { PITCHMENTOR_CONFIG: cfg, PITCHMENTOR_API_KEY: "" });
  assert.equal(me.calls[0].headers.Authorization, "Bearer pm_live_new");
});

test("table truncates and skips nested columns", () => {
  assert.equal(table([{ id: "a", nested: { x: 1 }, n: 1 }]), "ID  N\na   1");
});
