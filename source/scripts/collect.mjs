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
import { agentFacts, CODE, codeLines } from "./agent-facts.mjs";

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
    // 0.4.0: when the request named no commit, the newest on the default
    // branch was read, and the fact says which branch.
    const newest = String(github.newest_on ?? "").trim();
    add("commit", { source: { system: "code-host", call: newest ? `GET /repos/${owner}/${name}/commits/{branch}` : `GET /repos/${owner}/${name}/commits/{sha}`, field: "commit.committer.date" } }, { sha, date: github.commit?.commit?.committer?.date ?? github.commit?.commit?.author?.date ?? null, checked: archive.commit === sha, ...(newest ? { newest_on: newest } : {}) });
  }
  if (github.recent) add("recent-commits", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/commits`, field: "since" } }, { since: github.recent.since, count: github.recent.count, at_least: github.recent.more === true });

  // Languages, by the number of files, each citing its first file.
  const byLang = new Map();
  for (const f of files) { const l = LANGUAGES[posix.extname(f).toLowerCase()]; if (l) { if (!byLang.has(l)) byLang.set(l, []); byLang.get(l).push(f); } }
  for (const [l, fs] of [...byLang].sort((a, b) => b[1].length - a[1].length)) add("language", { file: fs[0], line: 1 }, { language: l, files: fs.length });

  // The reverse engineer's facts.
  const re = readFacts(files, read);
  // Each setting by file, with how the code reads it (0.3.0): with a default,
  // behind a guard that skips the feature, or failing when it is missing.
  for (const s of re.settings) {
    const byFile = new Map();
    for (const e of s.evidence) { if (!byFile.has(e.file)) byFile.set(e.file, []); byFile.get(e.file).push(e.line); }
    for (const [file, lines] of byFile) {
      const text = linesIn(file) ?? [];
      const hows = lines.map((l) => howRead(s.name, text, l - 1));
      const how = HOW_ORDER.find((h) => hows.includes(h)) ?? "plain";
      add("setting", { file, line: lines[0] }, { name: s.name, credential: s.credential, lines, how, ...(isTestFile(file) ? { in_test: true } : {}) });
    }
  }
  // What the setup docs and the example settings file say of each setting.
  const names = [...new Set(re.settings.map((s) => s.name))];
  if (names.length) {
    const nameRe = new RegExp(`\\b(${names.map(esc).join("|")})\\b`, "g");
    const said = new Set();
    for (const file of files.filter(isSetupDoc)) {
      (linesIn(file) ?? []).forEach((line, i) => {
        for (const m of line.matchAll(nameRe)) {
          const key = `${m[1]}:${file}`;
          if (said.has(key)) continue;
          said.add(key);
          if (isExampleSettings(file)) {
            const e = new RegExp(`^\\s*(#)?\\s*(?:export\\s+)?${esc(m[1])}\\s*=\\s*(.*)$`).exec(line);
            const v = String(e?.[2] ?? "").trim();
            add("example-setting", { file, line: i + 1 }, { name: m[1], commented: Boolean(e?.[1]), value_given: Boolean(v) && !/^(<.*>|\.\.\.|your[-_ ].*|x{3,}|changeme|""|'')$/i.test(v) });
          } else add("setup-doc", { file, line: i + 1 }, { name: m[1], says: docWord(line) });
        }
      });
    }
  }
  for (const e of re.entry_points ?? []) add("entry", e.evidence?.[0], { name: e.name, how: e.how });
  for (const s of re.starts_and_runs ?? []) add("how-it-runs", s.evidence?.[0], { step: s.step });
  // Each test file, with its kind by its folders and whether it needs live keys (0.3.0).
  const testText = new Map();
  for (const t of re.tests ?? []) {
    const text = read(t.file);
    testText.set(t.file, typeof text === "string" ? text : "");
    add("test-file", { file: t.file, line: t.cases[0]?.line ?? 1 }, { cases: t.cases.length, names: t.cases.map((c) => c.name), kind: testKind(t.file), live: needsLiveKeys(testText.get(t.file)) });
  }
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
  // A skill's tests: the test files that name its folder, its name or one of
  // its scripts (0.3.0), with how many tests they hold.
  // A test inside the skill's folder is its own; one elsewhere counts when it
  // names the skill's folder or name, unless it names more than five skills,
  // which makes it a test of the list of skills, not of any one.
  const skillData = own.facts.filter((a) => a.kind === "skill" && a.data?.size).map((a) => a.data);
  const named = new Map([...testText].map(([file, t]) => [file, skillData.filter((s) => skillKeys(s).some((k) => k.test(t)))]));
  const casesOf = (file) => (re.tests ?? []).find((x) => x.file === file)?.cases.length ?? 0;
  for (const a of own.facts) {
    if (a.kind === "skill" && a.data?.size) {
      const hit = [...testText.keys()].filter((file) => (a.data.folder && file.startsWith(`${a.data.folder}/`)) || (named.get(file).includes(a.data) && named.get(file).length <= 5));
      a.data.size.tests = { files: hit.length, cases: hit.reduce((n, file) => n + casesOf(file), 0) };
    }
    add(a.kind, { file: a.file, line: a.line }, a.data);
  }
  // The agent's own code, outside its skills and its tests: how much there is.
  const inSkill = (f) => own.skillFolders.some((d) => d && f.startsWith(`${d}/`));
  const ownCode = files.filter((f) => CODE.has(posix.extname(f).toLowerCase()) && !inSkill(f) && !isTestFile(f) && !/(^|\/)(node_modules|vendor|dist|build|\.venv)\//.test(f));
  if (ownCode.length) {
    const folders = [...new Set(ownCode.map((f) => f.split("/").slice(0, -1).slice(-2).join("/")).filter(Boolean))].slice(0, 30);
    add("own-code", { file: ownCode[0], line: 1 }, { files: ownCode.length, lines: ownCode.reduce((n, f) => n + codeLines(read(f)), 0), folders });
  }

  // The archive.
  for (const l of archive.links ?? []) add("link", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/tarball/{sha}`, field: l.path } }, { path: l.path, points_to: l.points_to, kind: l.kind });
  for (const p of archive.refused ?? []) add("refused-path", { source: { system: "code-host", call: `GET /repos/${owner}/${name}/tarball/{sha}`, field: p.path } }, { path: p.path, why: p.why });

  const byId = new Map(facts.map((f) => [f.id, f]));
  return { facts, byId, re, skillFolders: own.skillFolders, skillTexts: own.skillTexts, cased: casedFrom(files, read), add };
}

// ── How a setting is read, what the setup docs say, and the tests (0.3.0) ──
/** The ways a setting is read, the one that decides most first. */
export const HOW_ORDER = ["fails", "guard", "default", "plain"];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** How the line at index i reads the setting `name`: "default" (the code has
 *  one), "guard" (it skips a feature without it), "fails" (it stops without
 *  it) or "plain". */
export function howRead(name, lines, i) {
  const n = esc(name); const q = `["']${n}["']`;
  const line = String(lines[i] ?? "");
  if (new RegExp(`(?:\\.get|getenv)\\(\\s*${q}\\s*,\\s*[^)\\s]`).test(line)
    || new RegExp(`(?:process\\.env\\.${n}\\b|process\\.env\\[${q}\\]|getenv\\(\\s*${q}\\s*\\)|\\.get\\(\\s*${q}\\s*\\))\\s*(?:\\?\\?|\\|\\||\\bor\\b)\\s*[^\\s)]`).test(line)
    || new RegExp(`\\$\\{${n}:-`).test(line)) return "default";
  const stops = /\b(?:raise|throw|sys\.exit|process\.exit|SystemExit)\b/;
  if (new RegExp(`environ\\[\\s*${q}\\s*\\]`).test(line) && !/^\s*(?:if|elif)\b|\bin\s+os\.environ\b/.test(line)) return "fails";
  const onLine = /^\s*(?:if|elif|unless)\b|\bif\s*\(|\bif\s+not\b/.test(line);
  const nextIf = /^\s*(?:if|elif)\b|^\s*if\s*\(/.test(String(lines[i + 1] ?? ""));
  if (!onLine && !nextIf) return "plain";
  // The condition's own line and the lines indented under it.
  const at = onLine ? i : i + 1;
  const cond = String(lines[at] ?? "");
  const indent = (s) => /^\s*/.exec(s)[0].length;
  const under = [cond.replace(/^.*?(?::|\)|\{)\s*(?=\S|$)/, "")];
  for (let j = at + 1; j < Math.min(lines.length, at + 6); j += 1) {
    const l = String(lines[j] ?? "");
    if (!l.trim()) continue;
    if (indent(l) <= indent(cond)) break;
    under.push(l);
  }
  return stops.test(under.join("\n")) ? "fails" : "guard";
}
/** The example settings file, and the files a person reads to set the agent up. */
const isExampleSettings = (f) => /(^|\/)(\.env\.(example|sample|template|dist)|example\.env|env\.example|\.env\.local\.example)$/i.test(f);
const isSetupDoc = (f) => isExampleSettings(f) || (/\.(md|mdx|rst|txt)$/i.test(f) && /(^|\/)(readme|setup|install|getting[-_ ]started|configuration|config|deploy(ment)?|docs?\/[^/]+)/i.test(f) && !/(^|\/)(node_modules|vendor|skills)\//i.test(f));
/** What a setup doc's line says of a setting: required, optional or only mentioned. */
export function docWord(line) {
  const t = String(line ?? "");
  if (/\b(optional(ly)?|if you want|to enable|to turn on|only if|not required|can be left)\b/i.test(t)) return "optional";
  if (/\b(required|must|needs?|needed|mandatory)\b/i.test(t)) return "required";
  return "mentioned";
}

// ── Whether a person must supply a setting, by rule (0.4.0) ──
// The model judged need, and the count of required systems changed from run
// to run of the same commit. Now the facts decide it wherever they can, the
// same way every time; the model's own answer stands only where they don't.
/** Whether a file is in one of the skill folders the facts name. */
const inSkill = (file, folders) => folders.some((d) => d && String(file ?? "").startsWith(`${d}/`));
/**
 * What the facts settle about one setting: {need: "required" | "optional",
 * why} when they settle it, {need: "unclear", why} when they don't, or null
 * when only its tests read it, so running the agent never needs it.
 *   - Read by the agent's own code (outside its skills and tests): the code
 *     stops without it, required; it skips a feature or has a default,
 *     optional; read plainly, the setup docs decide (required or optional),
 *     then an example settings file that leaves it commented out (optional).
 *   - Read only inside its skills: only the skills that use it need it, so
 *     the agent runs without it: optional.
 */
export function settingNeed(name, facts) {
  const of = (kind) => facts.filter((f) => f.kind === kind && f.data?.name === name);
  const reads = of("setting").filter((f) => !f.data?.in_test);
  if (!reads.length) return null;
  const folders = facts.filter((f) => f.kind === "skill").map((f) => String(f.data?.folder ?? ""));
  const own = reads.filter((f) => !inSkill(f.file, folders));
  if (!own.length) return { need: "optional", why: "only the skills that use it read it" };
  const hows = new Set(own.map((f) => f.data?.how));
  if (hows.has("fails")) return { need: "required", why: "the code stops without it" };
  if (hows.has("guard")) return { need: "optional", why: "the code leaves out a feature without it" };
  if (hows.has("default")) return { need: "optional", why: "the code has a default for it" };
  const docs = new Set(of("setup-doc").map((f) => f.data?.says));
  if (docs.has("required") && !docs.has("optional")) return { need: "required", why: "the setup docs say it is required" };
  if (docs.has("optional") && !docs.has("required")) return { need: "optional", why: "the setup docs say it is optional" };
  const ex = of("example-setting");
  if (ex.length && ex.every((f) => f.data?.commented)) return { need: "optional", why: "the example settings file leaves it commented out" };
  return { need: "unclear", why: "the code reads it plainly and the setup docs don't say" };
}
/**
 * Whether a person must supply an outside system, from the settings it reads
 * (its setting facts and the credentials it names): {need, by, settings}.
 * Any setting required makes it required; every one optional makes it
 * optional; by is "rule". When none of its settings settles it, or it reads
 * none, need is null and by is null: the facts leave it unclear, and the
 * model's answer stands.
 */
export function systemNeed({ settings = [], facts = [] } = {}) {
  const names = [...new Set(settings.map((s) => String(s ?? "").trim()).filter(Boolean))].sort();
  const each = names.map((n) => ({ name: n, ...(settingNeed(n, facts) ?? { need: null }) })).filter((x) => x.need);
  const said = (x) => ({ name: x.name, need: x.need, why: x.why });
  if (each.some((x) => x.need === "required")) return { need: "required", by: "rule", settings: each.map(said) };
  if (each.length && each.every((x) => x.need === "optional")) return { need: "optional", by: "rule", settings: each.map(said) };
  return { need: null, by: null, settings: each.map(said) };
}
/** A test file's kind, by its folders and name. */
export function testKind(f) {
  const p = String(f).toLowerCase();
  if (/(^|\/|_)(e2e|end[-_]?to[-_]?end)(\/|_|\.)/.test(p)) return "end-to-end";
  if (/(^|\/)live(\/|_)|_live\b/.test(p)) return "live";
  if (/(^|\/)integrations?(\/|_)/.test(p)) return "integration";
  if (/(^|\/)contracts?(\/|_)/.test(p)) return "contract";
  if (/(^|\/)smoke(\/|_)/.test(p)) return "smoke";
  if (/(^|\/)unit(\/|_)/.test(p)) return "unit";
  return "other";
}
/** Whether a test file waits on live keys or a live service to run. */
export function needsLiveKeys(text) {
  return /skipif\([^\n]*(environ|getenv|API_KEY|_KEY|TOKEN)|@pytest\.mark\.(live|integration|e2e|network|requires_key)|\bRUN_LIVE|\bLIVE_TESTS?\b|requires?[_ ](an? )?(api[_ ])?key|skip(If|Unless)?\([^\n]*process\.env\.[A-Z_]*(KEY|TOKEN)/i.test(String(text ?? ""));
}
/** The words that name a skill in a test: its folder, and its folder's and
 *  its own name when they are a name no ordinary word is ("pr-to-video"). */
function skillKeys(data) {
  const folder = String(data.folder ?? "");
  const words = [folder, posix.basename(folder), String(data.name ?? "")].filter((w) => w.length >= 4 && (/[-_/]/.test(w)));
  return [...new Set(words.flatMap((w) => [w, w.replace(/-/g, "_")]))].map((w) => new RegExp(`(^|[^A-Za-z0-9_-])${esc(w)}([^A-Za-z0-9_-]|$)`));
}
/** The repository's own capitals for a word ("PR", "HyperFrames",
 *  "ElevenLabs"), from its prose, never from a slug, a path or a name in
 *  code: a word its prose writes with a capital inside it, or all in
 *  capitals, at least a third of the times it writes it takes that form. */
export function casedFrom(files, read) {
  const forms = new Map();
  let budget = 3_000_000;
  for (const f of files.filter((x) => /\.(md|mdx|rst|txt)$/i.test(x) && !/(^|\/)(node_modules|vendor)\//.test(x))) {
    if (budget <= 0) break;
    const t = read(f);
    if (typeof t !== "string") continue;
    const part = t.slice(0, 400_000); // cut-ok: the repository's capitals from the first part of each prose file; nothing is reported from it
    budget -= part.length;
    for (const m of part.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
      const before = part[m.index - 1] ?? " "; const after = part[m.index + m[0].length] ?? " ";
      if (/[-_/.@`$=]/.test(before) || /[-_/(=`]/.test(after) || (after === "." && /[A-Za-z]/.test(part[m.index + m[0].length + 1] ?? ""))) continue;
      const k = m[0].toLowerCase();
      if (k.length < 2) continue;
      if (!forms.has(k)) forms.set(k, new Map());
      forms.get(k).set(m[0], (forms.get(k).get(m[0]) ?? 0) + 1);
    }
  }
  return (word) => {
    const w = String(word ?? ""); const seen = forms.get(w.toLowerCase());
    if (!seen) return w;
    let total = 0; let best = null; let bestN = 0;
    // A capital inside a word ("HyperFrames"), or a short word all in
    // capitals ("PR", "CLI"); a longer one all in capitals is shouting.
    for (const [form, n] of seen) { total += n; const special = /[a-z]/.test(form) ? /[A-Z]/.test(form.slice(1)) : form.length <= 4; if (special && n > bestN) { best = form; bestN = n; } }
    return best && bestN * 3 >= total ? best : w;
  };
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
