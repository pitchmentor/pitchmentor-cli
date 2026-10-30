import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PitchMentor, PitchMentorError, operations, type OperationId, type OperationMeta } from "@pitchmentor/sdk";
import { COMMANDS } from "./commands.js";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  stdin: () => Promise<string>;
  /** For tests. */
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;
class UsageError extends Error {}

const GLOBAL_FLAGS = new Set(["json", "yes", "all", "help", "api-key", "base-url", "data"]);

export const configPath = (env: Io["env"]) =>
  env.PITCHMENTOR_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pitchmentor", "cli.json");

function readConfig(env: Io["env"]): { apiKey?: string; baseUrl?: string } {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8"));
  } catch {
    return {};
  }
}

/** `--a b --c=d --flag` → { a: "b", c: "d", flag: true } plus positionals. */
function parseArgs(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
      const next = argv[i + 1];
      if (inline !== undefined) flags[name] = inline;
      else if (next !== undefined && !next.startsWith("--") && !["json", "yes", "all", "help"].includes(name)) flags[name] = argv[++i];
      else flags[name] = true;
    } else positionals.push(arg);
  }
  return { flags, positionals };
}

function coerce(name: string, raw: string | true, schema: Json = {}): unknown {
  const types = [schema.type].flat();
  if (raw === "null" && types.includes("null")) return null;
  if (types.includes("boolean")) return raw === true || raw === "true" ? true : raw === "false" ? false : bad();
  if (raw === true) return bad();
  if (types.includes("integer") || types.includes("number")) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : bad();
  }
  if (types.includes("array")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
  function bad(): never {
    throw new UsageError(`--${name}: invalid value ${raw === true ? "(missing)" : JSON.stringify(raw)}`);
  }
}

/** Body/query fields that can be set with a flag (scalars and string lists); others need --data. */
function flagFields(schema: Json | null): Record<string, Json> {
  const props = (schema?.properties ?? {}) as Record<string, Json>;
  return Object.fromEntries(
    Object.entries(props).filter(([, s]) => {
      const t = [s.type].flat();
      return !t.includes("object") && (!t.includes("array") || (s.items as Json)?.type === "string");
    })
  );
}

const kebab = (s: string) => s.replace(/_/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

async function readData(raw: string, io: Io): Promise<unknown> {
  const text = raw === "-" ? await io.stdin() : raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError("--data must be JSON, @file.json or - (stdin)");
  }
}

// ── output ────────────────────────────────────────────────

const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const cell = (v: unknown, max = 40) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const flat = s.replace(/\s+/g, " ");
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
};

export function table(rows: Json[]): string {
  if (!rows.length) return "(none)";
  const cols = Object.keys(rows[0]).filter((k) => rows.every((r) => scalar(r[k]) || r[k] === undefined)).slice(0, 8);
  const cells = rows.map((r) => cols.map((c) => cell(r[c])));
  const width = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(width[i])).join("  ").trimEnd();
  return [line(cols.map((c) => c.toUpperCase())), ...cells.map(line)].join("\n");
}

function keyValues(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) && !prefix ? keyValues(v as Json, `${k}.`) : [`${prefix}${k}: ${cell(v, 100)}`]
  );
}

function render(result: unknown): string {
  if (typeof result === "string") return result.replace(/\n$/, "");
  if (Array.isArray(result)) return table(result as Json[]);
  const obj = result as Json;
  if (Array.isArray(obj?.data)) {
    const more = obj.has_more && obj.next_cursor ? `\n(more: --cursor ${obj.next_cursor}, or --all)` : "";
    return table(obj.data as Json[]) + more;
  }
  const lines = keyValues(obj);
  // Lists nested in a result (e.g. a call's coaching log) get their own table
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") lines.push("", `${k}:`, table(v as Json[]));
  }
  return lines.join("\n");
}

// ── help ──────────────────────────────────────────────────

function help(): string {
  const lines = [
    "Usage: pitchmentor <group> [command] [args] [flags]",
    "",
    "Auth: PITCHMENTOR_API_KEY, --api-key, or `pitchmentor login` (stores the key in the config file).",
    "Global flags: --json (raw JSON output), --all (fetch every page), --yes (confirm destructive commands),",
    "              --data <json|@file|-> (request body), --api-key, --base-url",
    "",
  ];
  for (const [group, cmds] of Object.entries(COMMANDS)) {
    for (const [cmd, id] of Object.entries(cmds)) {
      const meta: OperationMeta = operations[id];
      const args = meta.pathParams.map((p) => `<${p}>`).join(" ");
      lines.push(`  ${`${group} ${cmd} ${args}`.padEnd(40)} ${meta.summary}${meta.destructive ? " [destructive]" : ""}`);
    }
  }
  lines.push("", "  login [--api-key <key>]                   Save an API key to the config file", "  logout                                   Remove the saved key");
  lines.push("", "Run `pitchmentor <group> <command> --help` for flags.");
  return lines.join("\n");
}

function commandHelp(group: string, cmd: string, meta: OperationMeta): string {
  const lines = [`pitchmentor ${group} ${cmd} ${meta.pathParams.map((p) => `<${p}>`).join(" ")}`.trimEnd(), "", meta.summary + ".", meta.description, ""];
  const fields = { ...flagFields(meta.query), ...flagFields(meta.body) };
  const required = new Set((meta.body?.required as string[] | undefined) ?? []);
  for (const [name, s] of Object.entries(fields)) {
    const type = s.enum ? (s.enum as string[]).join("|") : [s.type].flat().filter((t) => t !== "null").join("|") + ((s.items as Json)?.type ? " (comma-separated)" : "");
    lines.push(`  --${kebab(name).padEnd(22)} ${type}${required.has(name) ? " (required)" : ""}${s.description ? `  ${s.description}` : ""}`);
  }
  if (meta.body) lines.push(`  --data                   JSON body (fields above override it)`);
  if (meta.paginated) lines.push("  --all                    Fetch every page");
  if (meta.destructive) lines.push("  --yes                    Required: this cannot be undone");
  return lines.filter((l, i) => l || lines[i - 1]).join("\n");
}

// ── main ──────────────────────────────────────────────────

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`Error: ${err.message}`);
      return 2;
    }
    if (err instanceof PitchMentorError) {
      io.err(`Error (${err.status} ${err.code}): ${err.message}`);
      return 1;
    }
    io.err(`Error: ${(err as Error).message}`);
    return 1;
  }
}

async function dispatch(argv: string[], io: Io): Promise<number> {
  const { flags, positionals } = parseArgs(argv);
  const [group, maybeCmd, ...rest] = positionals;
  const config = readConfig(io.env);
  const baseUrl = (flags["base-url"] as string) || io.env.PITCHMENTOR_BASE_URL || config.baseUrl;
  const client = (apiKey?: string) => {
    const key = apiKey || (flags["api-key"] as string) || io.env.PITCHMENTOR_API_KEY || config.apiKey;
    if (!key) throw new UsageError("No API key. Set PITCHMENTOR_API_KEY, pass --api-key, or run `pitchmentor login`.");
    return new PitchMentor({ apiKey: key, baseUrl, fetch: io.fetch });
  };

  if (!group || group === "help" || (flags.help && !group)) {
    io.out(help());
    return 0;
  }
  if (group === "login") {
    const key = typeof flags["api-key"] === "string" ? flags["api-key"] : (await io.stdin()).trim();
    const me = await client(key).getMe();
    const path = configPath(io.env);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ apiKey: key, ...(baseUrl ? { baseUrl } : {}) }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    io.out(`Logged in to team "${me.team.name}" with key "${me.apiKey.name}". Saved to ${path}`);
    return 0;
  }
  if (group === "logout") {
    writeFileSync(configPath(io.env), "{}\n", { mode: 0o600 });
    io.out("Logged out.");
    return 0;
  }

  const cmds = COMMANDS[group];
  if (!cmds) throw new UsageError(`Unknown command "${group}". Run \`pitchmentor help\`.`);
  // A group's first command is its default: `pitchmentor calls` == `pitchmentor calls list`
  const [cmd, args] = maybeCmd && maybeCmd in cmds ? [maybeCmd, rest] : [Object.keys(cmds)[0], [maybeCmd, ...rest].filter((a) => a !== undefined)];
  const id = cmds[cmd];
  const meta: OperationMeta = operations[id];
  if (flags.help) {
    io.out(commandHelp(group, cmd, meta));
    return 0;
  }
  if (args.length !== meta.pathParams.length) {
    throw new UsageError(`Usage: pitchmentor ${group} ${cmd} ${meta.pathParams.map((p) => `<${p}>`).join(" ")}`.trimEnd());
  }
  if (meta.destructive && !flags.yes) throw new UsageError(`"${group} ${cmd}" cannot be undone; pass --yes to confirm.`);

  const queryFields = flagFields(meta.query);
  const bodyFields = flagFields(meta.body);
  const query: Json = {};
  let body: Json | undefined = meta.body ? ((flags.data !== undefined ? await readData(String(flags.data), io) : {}) as Json) : undefined;
  const byFlag = new Map([...Object.keys(queryFields), ...Object.keys(bodyFields)].map((k) => [kebab(k), k]));
  for (const [flag, raw] of Object.entries(flags)) {
    if (GLOBAL_FLAGS.has(flag)) continue;
    const field = byFlag.get(flag) ?? byFlag.get(kebab(flag));
    if (!field) throw new UsageError(`Unknown flag --${flag}. Run \`pitchmentor ${group} ${cmd} --help\`.`);
    if (field in queryFields) query[field] = coerce(flag, raw, queryFields[field]);
    else body![field] = coerce(flag, raw, bodyFields[field]);
  }
  if (flags.data !== undefined && !meta.body) throw new UsageError(`"${group} ${cmd}" takes no request body`);

  const pm = client() as unknown as Record<string, (...a: unknown[]) => Promise<unknown> | AsyncGenerator<unknown>>;
  const callArgs = [...args, ...(meta.body ? [body] : []), ...(meta.query ? [query] : [])];
  let result: unknown;
  if (flags.all && meta.paginated) {
    const items: unknown[] = [];
    for await (const item of pm[`${id}Iter`](...callArgs) as AsyncGenerator<unknown>) items.push(item);
    result = items;
  } else result = await pm[id](...callArgs);

  io.out(flags.json && typeof result !== "string" ? JSON.stringify(result, null, 2) : render(result));
  return 0;
}
