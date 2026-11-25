// Every fact the scripts find, numbered, each with its file and line and the
// line's text exactly as written: the floor the judgments stand on.
//
// The facts come from the reverse engineer's read-the-codebase scripts
// (readFacts: the settings and credentials read by name, entry points and how
// the code starts, tests, schemas, the commands), the security reviewer's
// trace and credential scan (what each program reaches and starts, and what
// looks like a credential), Inspect's own patterns (agent-facts.mjs), the
// archive's links and refused paths, how it runs in a container or a graph
// server, and GitHub's record of the repository and the commit.
//
// A fact's id is F followed by four digits and more as needed. Its text is the
// line exactly, with anything that looks like a credential taken out, when the
// line is at most TEXT_CHARS long; a longer line gives its length instead.
// A line where a credential was found keeps no text at all.
//
//   needs: node >= 22. Nothing here reads the network or writes a file.
//   import { collectFacts, TEXT_CHARS, factLine } from "./collect.mjs"
import { posix } from "node:path";
import { linesOf } from "./codebase.mjs";
import { isTestFile, readFacts } from "./facts.mjs";
import { credentialsIn, scrub } from "./secrets.mjs";
import { CODE as TRACE_CODE, traceOne } from "./trace-programs.mjs";
import { agentFacts } from "./agent-facts.mjs";

/** The longest line a fact keeps the text of. */
export const TEXT_CHARS = 400;

const trim = (s) => String(s ?? "").trim();

/** Languages by file extension. */
export const LANGUAGES = {
  ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".sh": "Shell", ".bash": "Shell", ".swift": "Swift",
};

/**
 * The facts: {facts, byId, kinds}. `read(file)` answers a file's text or null;
 * `bytesOf(file)` its bytes. `archive` is untar's answer (links, refused,
 * skipped), `github` holds the repository's and the commit's records and the
 * recent commits, and `vulns` OSV's findings.
 */
export function collectFacts({ files, read, bytesOf, archive = {}, github = {}, owner = "", name = "", sha = "" }) {
  const facts = [];
  const lineCache = new Map();
  const linesIn = (f) => { if (!lineCache.has(f)) { const t = read(f); lineCache.set(f, t === null || t === undefined ? null : linesOf(t)); } return lineCache.get(f); };
  const noText = new Set();
  const add = (kind, at, data = {}) => {
    const f = { id: `F${String(facts.length + 1).padStart(4, "0")}`, kind };
    if (at?.file) {
      f.file = at.file;
      f.line = Number.isInteger(at.line) && at.line > 0 ? at.line : 1;
      const lines = linesIn(at.file);
      const text = lines?.[f.line - 1];
      if (typeof text === "string" && !noText.has(`${f.file}:${f.line}`)) {
        if (text.length <= TEXT_CHARS) f.text = scrub(text);
        else f.long_line = text.length;
      }
    }
    if (at?.source) f.source = at.source;
    if (data && Object.keys(data).length) f.data = data;
    facts.push(f);
    return f;
  };

  // What looks like a credential first, so its line never keeps its text.
  const creds = credentialsIn(files.map((f) => [f, bytesOf(f) ?? Buffer.alloc(0)]));
  for (const c of creds) noText.add(`${c.file}:${c.line}`);

  // GitHub's record: the facts no file at the commit holds.
  const repoCall = `GET /repos/${owner}/${name}`;
  const r = github.repository ?? {};
  if (github.repository) {
    add("publisher", { source: { system: "code-host", call: repoCall, field: "owner" } }, { login: r.owner?.login ?? owner, type: r.owner?.type ?? null });
    add("repository-license", { source: { system: "code-host", call: repoCall, field: "license.spdx_id" } }, { spdx: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null });
    add("activity", { source: { system: "code-host", call: repoCall, field: "pushed_at" } }, { pushed_at: r.pushed_at ?? null, created_at: r.created_at ?? null, archived: r.archived === true, open_issues: r.open_issues_count ?? null, stars: r.stargazers_count ?? null, default_branch: r.default_branch ?? null });
  }
  if (github.commit) {
    add("commit", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/commits/{sha}`, field: "commit.committer.date" } }, { sha, date: github.commit?.commit?.committer?.date ?? github.commit?.commit?.author?.date ?? null, checked: archive.commit === sha });
  }
  if (github.recent) add("recent-commits", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/commits`, field: "since" } }, { since: github.recent.since, count: github.recent.count, at_least: github.recent.more === true });

  // Languages, by the number of files, each citing its first file.
  const byLang = new Map();
  for (const f of files) { const l = LANGUAGES[posix.extname(f).toLowerCase()]; if (l) { if (!byLang.has(l)) byLang.set(l, []); byLang.get(l).push(f); } }
  for (const [l, fs] of [...byLang].sort((a, b) => b[1].length - a[1].length)) add("language", { file: fs[0], line: 1 }, { language: l, files: fs.length });

  // The reverse engineer's facts.
  const re = readFacts(files, read);
  for (const s of re.settings) {
    const byFile = new Map();
    for (const e of s.evidence) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e.line); }
    for (const [file, lines] of byFile) add("setting", { file, line: lines[0] }, { name: s.name, credential: s.credential, lines, ...(isTestFile(file) ? { in_test: true } : {}) });
  }
  for (const e of re.entry_points ?? []) add("entry", e.evidence?.[0], { name: e.name, how: e.how });
  for (const s of re.starts_and_runs ?? []) add("how-it-runs", s.evidence?.[0], { step: s.step });
  for (const t of re.tests ?? []) add("test-file", { file: t.file, line: t.cases[0]?.line ?? 1 }, { cases: t.cases.length, names: t.cases.map((c) => c.name) });
  if (re.test_command?.command) add("test-command", re.test_command.evidence?.[0], { command: re.test_command.command });
  else add("test-command", null, { none: re.test_command?.none ?? "no test command was found" });
  for (const s of re.schemas ?? []) add("schema", s.evidence?.[0] ?? { file: s.file, line: 1 }, { file: s.file, kind: s.kind });

  // How it runs, beyond the codebase's top: container files, a graph server's
  // file and the commands a pyproject.toml declares.
  for (const f of files) {
    const b = posix.basename(f);
    if (/^(Dockerfile|Containerfile)(\..+)?$/.test(b) && f.includes("/")) {
      (linesIn(f) ?? []).forEach((line, i) => { const m = /^\s*(FROM|ENTRYPOINT|CMD)\s+(.+)$/i.exec(line); if (m) add("how-it-runs", { file: f, line: i + 1 }, { step: `${m[1].toUpperCase()} ${trim(m[2])}` }); });
    }
    if (b === "langgraph.json") (linesIn(f) ?? []).forEach((line, i) => { if (/"(graphs|http|store|checkpointer|auth|env)"\s*:/.test(line)) add("how-it-runs", { file: f, line: i + 1 }, { step: "a LangGraph server's configuration" }); });
    if (b === "pyproject.toml") {
      let inScripts = false;
      (linesIn(f) ?? []).forEach((line, i) => {
        if (/^\s*\[/.test(line)) inScripts = /^\s*\[project\.scripts\]/.test(line);
        else if (inScripts && /^\s*[\w.-]+\s*=\s*"/.test(line)) add("entry", { file: f, line: i + 1 }, { how: "a command pyproject.toml declares" });
      });
    }
  }

  // The security reviewer's trace: what each program reaches and starts.
  for (const f of files) {
    if (!TRACE_CODE.test(f)) continue;
    const t = read(f);
    if (t === null || t === undefined || t.length > 2_000_000) continue;
    let tr;
    try { tr = traceOne(f, t); } catch { continue; }
    for (const h of tr.hosts) add("address", { file: f, line: h.line }, { host: h.host, called: true });
    for (const h of tr.written) add("address", { file: f, line: h.line }, { host: h.host, called: false });
    for (const o of tr.open) add("handed-address", { file: f, line: o.line }, { call: o.what });
    for (const c of tr.commands) add("command", { file: f, line: c.line }, { command: c.what });
  }
  for (const c of creds) add("credential-shape", { file: c.file, line: c.line }, { what: c.what, ...(isTestFile(c.file) ? { in_test: true } : {}) });

  // Inspect's own patterns.
  const own = agentFacts(files, read, { entries: re.surface?.entries ?? [] });
  for (const a of own.facts) add(a.kind, { file: a.file, line: a.line }, a.data);

  // The archive.
  for (const l of archive.links ?? []) add("link", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/tarball/{sha}`, field: l.path } }, { path: l.path, points_to: l.points_to, kind: l.kind });
  for (const p of archive.refused ?? []) add("refused-path", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/tarball/{sha}`, field: p.path } }, { path: p.path, why: p.why });

  const byId = new Map(facts.map((f) => [f.id, f]));
  return { facts, byId, re, skillFolders: own.skillFolders, add };
}

/** What the model is shown of a part's data: whether it can be lifted out and
 *  the first thing that keeps it; every keep, file and setting stays in the
 *  report's fact under the same id, and the scripts write those findings. */
const viewOf = (f) => (f.kind === "part" && f.data
  ? { part: f.data.part, name: f.data.name, lift_out: f.data.lift_out, keeps: (f.data.keeps ?? []).length, ...(f.data.keeps?.[0] ? { first_keep: `${f.data.keeps[0].why}: ${f.data.keeps[0].spec}` } : {}), settings: (f.data.settings ?? []).map((s) => s.name) }
  : f.data);

/** One fact as the model reads it: id, kind, place, text and data, on one line. */
export function factLine(f) {
  const at = f.file ? `${f.file}:${f.line}` : f.source ? `${f.source.system} ${f.source.call}` : "";
  const text = f.text !== undefined ? ` | ${f.text.trim()}` : f.long_line ? ` | (a line of ${f.long_line} characters)` : "";
  const view = viewOf(f);
  const data = view ? ` | ${JSON.stringify(view)}` : "";
  return `${f.id} [${f.kind}] ${at}${text}${data}`;
}
