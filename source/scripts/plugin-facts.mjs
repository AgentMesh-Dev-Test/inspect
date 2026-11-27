// Plugins and skills, read off the repository by fixed rules: no model (0.5.0).
//
// A repository Inspect reads is one of three things:
//
//   agent    an agent's own code (what Inspect read before 0.5.0); nothing
//            here changes how it is read
//   plugin   one or more plugins for a person's own coding tool, each named by
//            a manifest or a marketplace entry:
//              - Agent Plugins 1.0.0 (agent-plugins.org): plugin.json whose
//                $schema is .../1.0.0/plugin.schema.json, skills/<name>/SKILL.md,
//                mcp.json, and folders named by a reverse domain
//              - Claude Code: .claude-plugin/plugin.json, commands/, agents/,
//                skills/, hooks/hooks.json, .mcp.json, and a marketplace at
//                .claude-plugin/marketplace.json listing several plugins
//              - Cursor: .cursor-plugin/plugin.json, rules/, skills/, agents/,
//                commands/, hooks/hooks.json, mcp.json, and
//                .cursor-plugin/marketplace.json
//              - Codex: .codex-plugin/plugin.json, skills/, .mcp.json or
//                mcp.json, hooks/hooks.json, and .agents/plugins/marketplace.json
//              - other tools' own .<tool>-plugin/plugin.json, named only
//   skills   skills alone (skills/*/SKILL.md, or a SKILL.md at the top) with no
//            manifest and no code of an agent's own
//
// A repository with several plugins has one inspected in full: the one the
// request names (its plugin: line), else the first, and the others are listed.
// The plugin's files are its own folder (less any other plugin's folder inside
// it), or, for a marketplace entry that lists some of the repository's skills,
// those skills' folders, with the repository's own license and readme always.
//
// What a plugin adds to the person's tools is a fact each: each command and
// sub-agent with its size, each rule, each hook (what starts it and what it
// runs), each MCP server (a program it starts on the machine, or an address it
// connects to, with what it needs), and each value the plugin asks the person
// for. And for its scripts, by pattern: reading the home folder, stored
// credentials or the whole environment, and downloading code to run.
//
// A fact here never holds a setting's value or a header's value: only names.
//
//   needs: node >= 22. Nothing here reads the network or writes a file:
//   `read(file)` answers a file's text, or null.
//   import { shapeOf, pickPlugin, scopeOf, pluginFacts, eventWords, hookLevel } from "./plugin-facts.mjs"
import { posix } from "node:path";
import { linesOf } from "./codebase.mjs";
import { isTestFile } from "./facts.mjs";
import { ASSISTANT_DIRS, bodyOf, closureOf, CODE, codeLines, isAssistantSkill } from "./agent-facts.mjs";
import { scrub } from "./secrets.mjs";
import { traceOne } from "./trace-programs.mjs";

const trim = (s) => String(s ?? "").trim();
const join = (...parts) => posix.normalize(posix.join(...parts.filter((p) => p !== ""))).replace(/^\.\/?$/, "").replace(/^\.\//, "").replace(/\/$/, "");
const under = (root, f) => root === "" || f === root || f.startsWith(`${root}/`);
const json = (text) => { try { const v = JSON.parse(String(text ?? "")); return v && typeof v === "object" ? v : null; } catch { return null; } };
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The Agent Plugins 1.0.0 manifest's schema address. */
export const AGENT_PLUGINS_SCHEMA = /^https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\/plugin\.schema\.json$/;

/** The tools a manifest folder names. */
export const TOOL_OF_FOLDER = { ".claude-plugin": "Claude Code", ".cursor-plugin": "Cursor", ".codex-plugin": "Codex" };
/** The tools a plugin made to the open standard installs into (Cursor's and Codex's docs). */
export const AGENT_PLUGINS_TOOL = "Agent Plugins";

/** A tool's name from its own manifest folder (".kimi-plugin" as "Kimi"). */
const toolOfFolder = (dir) => TOOL_OF_FOLDER[dir] ?? (/^\.([a-z0-9]+)-plugin$/i.exec(dir) ? `${dir.slice(1, 2).toUpperCase()}${dir.slice(2, dir.indexOf("-plugin"))}` : null);

/** The line a JSON key is written on in a text, at or after line `after`, or 1. */
export function lineOfKey(text, key, after = 0) {
  const lines = linesOf(String(text ?? ""));
  const re = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  for (let i = Math.max(0, after); i < lines.length; i += 1) if (re.test(lines[i])) return i + 1;
  return 1;
}

// ── Which shape the repository has ──

/** Every plugin manifest in the repository: [{tool, file, root, data}]. */
function manifestsIn(files, read) {
  const out = [];
  for (const f of files) {
    const dir = posix.dirname(f) === "." ? "" : posix.dirname(f);
    const base = posix.basename(f);
    if (base === "plugin.json" && /(^|\/)\.[a-z0-9]+-plugin$/i.test(dir)) {
      const tool = toolOfFolder(posix.basename(dir));
      const data = json(read(f));
      if (tool && data) out.push({ tool, file: f, root: posix.dirname(dir) === "." ? "" : posix.dirname(dir), data });
      continue;
    }
    // Gemini CLI's extension manifest, at the extension's own root.
    if (base === "gemini-extension.json" && !dir.split("/").some((p) => p.startsWith("."))) {
      const data = json(read(f));
      if (data) out.push({ tool: "Gemini CLI", file: f, root: dir, data });
      continue;
    }
    // The open standard's manifest sits at the plugin's own root and names its schema.
    if (base === "plugin.json" && !dir.split("/").some((p) => p.startsWith("."))) {
      const data = json(read(f));
      if (data && AGENT_PLUGINS_SCHEMA.test(trim(data.$schema))) out.push({ tool: AGENT_PLUGINS_TOOL, file: f, root: dir, data, agent_package: Boolean(data.extensions?.["net.agentdoc.package"]) });
    }
  }
  return out;
}

/** The marketplaces: [{tool, file, root, data}]. */
function marketplacesIn(files, read) {
  const out = [];
  for (const f of files) {
    let tool = null; let root = null;
    if (/(^|\/)\.claude-plugin\/marketplace\.json$/.test(f)) { tool = "Claude Code"; root = posix.dirname(posix.dirname(f)); }
    else if (/(^|\/)\.cursor-plugin\/marketplace\.json$/.test(f)) { tool = "Cursor"; root = posix.dirname(posix.dirname(f)); }
    else if (/(^|\/)\.agents\/plugins\/marketplace\.json$/.test(f)) { tool = "Codex"; root = posix.dirname(posix.dirname(posix.dirname(f))); }
    if (!tool) continue;
    const data = json(read(f));
    if (data && Array.isArray(data.plugins)) out.push({ tool, file: f, root: root === "." ? "" : root, data });
  }
  return out;
}

/** Where a marketplace entry's plugin is: {local: folder} or {elsewhere: address}. */
export function sourceOf(entry, market) {
  const s = entry?.source;
  const base = trim(market.data?.metadata?.pluginRoot);
  const local = (p) => {
    const t = trim(p);
    if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || posix.isAbsolute(t)) return null;
    const rel = /^\.\.?(\/|$)/.test(t) ? t : base ? posix.join(base, t) : t;
    const at = join(market.root, rel);
    return at.startsWith("..") ? null : at;
  };
  if (typeof s === "string") { const at = local(s); return at === null ? { elsewhere: trim(s) } : { local: at }; }
  if (s && typeof s === "object") {
    const kind = trim(s.source).toLowerCase();
    if (kind === "github" && trim(s.repo)) return { elsewhere: `https://github.com/${trim(s.repo)}` };
    if (kind === "npm" && trim(s.package)) return { elsewhere: `npm package ${trim(s.package)}` };
    if (trim(s.path) && (kind === "local" || !kind)) { const at = local(s.path); if (at !== null) return { local: at }; }
    if (trim(s.url)) { const at = local(s.url); return at === null ? { elsewhere: trim(s.url) } : { local: at }; }
    if (trim(s.repo)) return { elsewhere: trim(s.repo) };
  }
  return { elsewhere: "a source Inspect does not read" };
}

/** The folders a repository's own agent code would be in: code outside its
 *  skills, its tests, the coding assistants' folders, and the top's tooling. */
function agentCode(files, skillFolders) {
  const tooling = /^(?:scripts?|tools?|bin|\.github|docs?|examples?|templates?|evals?|benchmarks?)\//;
  return files.filter((f) => CODE.has(posix.extname(f).toLowerCase()) && !isTestFile(f) && !tooling.test(f)
    && !ASSISTANT_DIRS.some((d) => f.startsWith(d)) && !skillFolders.some((d) => under(d, f))
    && !/(^|\/)(node_modules|vendor|dist|build|\.venv)\//.test(f));
}

/** A skill's folder, from its SKILL.md. */
const folderOf = (f) => (posix.dirname(f) === "." ? "" : posix.dirname(f));

/**
 * The repository's shape: {kind: "agent" | "plugin" | "skills", plugins,
 * manifests, marketplaces}. Each plugin: {name, display_name, root, skills
 * (null for every skill under its root, else the folders an entry lists),
 * tools, manifests, entries, description, version, author, license,
 * elsewhere}. Plugins come in the order the first marketplace lists them, then
 * the manifests no marketplace lists, by folder.
 */
export function shapeOf(files, read) {
  const manifests = manifestsIn(files, read);
  const marketplaces = marketplacesIn(files, read);
  const byKey = new Map();
  const order = [];
  const keyOf = (root, skills) => `${root}|${skills ? [...skills].sort().join(",") : "*"}`;
  const plugin = (root, skills = null) => {
    const k = keyOf(root, skills);
    if (!byKey.has(k)) { byKey.set(k, { root, skills, tools: new Set(), manifests: [], entries: [], elsewhere: null }); order.push(k); }
    return byKey.get(k);
  };
  for (const m of marketplaces) {
    m.data.plugins.forEach((e, i) => {
      if (!e || typeof e !== "object") return;
      const src = sourceOf(e, m);
      if (src.elsewhere) {
        const k = `elsewhere|${m.file}|${i}`;
        byKey.set(k, { root: null, skills: null, tools: new Set([m.tool]), manifests: [], entries: [{ market: m, index: i, entry: e }], elsewhere: src.elsewhere });
        order.push(k);
        return;
      }
      const skills = Array.isArray(e.skills) && e.skills.length ? e.skills.map((s) => join(src.local, trim(s))).filter((s) => !s.startsWith("..")) : null;
      const p = plugin(src.local, skills && skills.length ? skills : null);
      p.tools.add(m.tool);
      p.entries.push({ market: m, index: i, entry: e });
    });
  }
  for (const m of manifests.filter((x) => !x.agent_package)) {
    const p = plugin(m.root);
    p.tools.add(m.tool);
    p.manifests.push(m);
  }
  // A marketplace entry that lists the repository's root with no skills of its
  // own is the plugin its manifests describe: one plugin, not two.
  const plugins = order.map((k) => byKey.get(k)).map((p) => {
    const pick = (field) => { for (const t of ["Claude Code", AGENT_PLUGINS_TOOL, "Cursor", "Codex"]) { const m = p.manifests.find((x) => x.tool === t); const v = m?.data?.[field]; if (typeof v === "string" && trim(v)) return trim(v); } for (const m of p.manifests) { const v = m.data?.[field]; if (typeof v === "string" && trim(v)) return trim(v); } for (const e of p.entries) { const v = e.entry?.[field]; if (typeof v === "string" && trim(v)) return trim(v); } return null; };
    const author = (() => { for (const m of [...p.manifests.map((x) => x.data), ...p.entries.map((x) => x.entry)]) { const a = m?.author; const n = typeof a === "string" ? a : a?.name; if (trim(n)) return trim(n); } return null; })();
    const entryName = p.entries.map((e) => trim(e.entry?.name)).find(Boolean) ?? null;
    const name = (p.skills ? entryName : null) ?? pick("name") ?? entryName ?? (p.root ? posix.basename(p.root) : null);
    const display = (() => { for (const m of [...p.manifests.map((x) => x.data), ...p.entries.map((x) => x.entry)]) { const v = m?.displayName ?? m?.interface?.displayName; if (trim(v)) return trim(v); } return null; })();
    return {
      name, display_name: display && display.toLowerCase() !== String(name ?? "").toLowerCase() ? display : null, root: p.root, skills: p.skills, elsewhere: p.elsewhere,
      tools: [...p.tools], manifests: p.manifests, entries: p.entries,
      description: (p.skills ? p.entries.map((e) => trim(e.entry?.description)).find(Boolean) : null) ?? pick("description"),
      version: pick("version"), author, license: pick("license"),
    };
  });
  if (plugins.length) return { kind: "plugin", plugins, manifests, marketplaces };
  // No manifest: skills alone, when the repository holds no agent code of its own.
  const skillFiles = files.filter((f) => posix.basename(f) === "SKILL.md" && !isAssistantSkill(folderOf(f)));
  if (skillFiles.length && !agentCode(files, skillFiles.map(folderOf)).length) {
    return { kind: "skills", plugins: [], manifests, marketplaces, skills: skillFiles.map(folderOf) };
  }
  return { kind: "agent", plugins: [], manifests, marketplaces };
}

/** A plugin's name as a person reads it: its display name, else its name. */
export const pluginName = (p) => p?.display_name ?? p?.name ?? (p?.root ? posix.basename(p.root) : "the plugin");

/**
 * The plugin to inspect: {ok: true, plugin, by: "request" | "first" | null,
 * note?} or {ok: false, refusal}. `want` is the request's plugin: line, or
 * null. A plugin kept in another repository is never the first, and is
 * refused by name with where it is.
 */
export function pickPlugin(shape, want, repo) {
  const w = trim(want).toLowerCase();
  if (shape.kind !== "plugin") return { ok: true, plugin: null, by: null, ...(w ? { note: `${repo} holds no plugins, so the plugin named, ${trim(want)}, was not used; Inspect inspected the repository as a whole.` } : {}) };
  const local = shape.plugins.filter((p) => !p.elsewhere);
  const names = (p) => [p.name, p.display_name, p.root ? posix.basename(p.root) : null, ...p.entries.map((e) => e.entry?.name)].map((x) => trim(x).toLowerCase()).filter(Boolean);
  const listed = and(shape.plugins.map((p) => p.name ?? pluginName(p)).filter(Boolean));
  if (w) {
    const hit = shape.plugins.find((p) => names(p).includes(w));
    if (!hit) return { ok: false, refusal: `There is no plugin named ${JSON.stringify(trim(want))} in ${repo}; it holds ${listed}. Name one of those, or leave the plugin out to inspect the first; nothing was inspected.` };
    if (hit.elsewhere) return { ok: false, refusal: `The plugin ${hit.name} is listed in ${repo} but kept elsewhere, at ${hit.elsewhere}; inspect it there. Nothing was inspected.` };
    return { ok: true, plugin: hit, by: "request" };
  }
  if (!local.length) return { ok: false, refusal: `Every plugin ${repo} lists is kept in another repository (${and(shape.plugins.map((p) => p.elsewhere))}); inspect one of those. Nothing was inspected.` };
  return { ok: true, plugin: local[0], by: local.length > 1 ? "first" : null };
}

/** The files of one plugin: its folder less any other plugin's folder inside
 *  it, or the skills an entry lists with its manifests; the repository's own
 *  license and readme always. Every file of the repository for an agent. */
export function scopeOf(files, shape, plugin) {
  if (!plugin) return files;
  const R = plugin.root;
  const nested = shape.plugins.filter((p) => !p.elsewhere && p !== plugin && p.root !== R && p.root !== null && under(R, p.root) && p.root !== "").map((p) => p.root);
  // The repository's license and readme, and the marketplaces and manifests
  // that name its plugins, which the list of plugins cites.
  const named = new Set([...shape.marketplaces.map((m) => m.file), ...shape.plugins.flatMap((p) => p.manifests.map((m) => m.file))]);
  const top = (f) => named.has(f) || (!f.includes("/") && /^(?:LICEN[CS]E|COPYING|NOTICE|README)(?:[.-][A-Za-z0-9.]+)?$/i.test(f));
  const own = (f) => under(R, f) && !nested.some((n) => under(n, f));
  if (!plugin.skills) return files.filter((f) => top(f) || own(f));
  const atRoot = (f) => own(f) && !f.slice(R ? R.length + 1 : 0).includes("/");
  const manifestsDir = (f) => own(f) && /^\.(?:claude|cursor|codex)-plugin\//.test(f.slice(R ? R.length + 1 : 0));
  return files.filter((f) => top(f) || atRoot(f) || manifestsDir(f) || plugin.skills.some((s) => under(s, f)) || plugin.entries.some((e) => e.market.file === f));
}

/** The skill folders a plugin's tools load: skills/<name> under its root, the
 *  folders its manifests or its entry name, or a SKILL.md at its root when it
 *  has no skills folder. */
export function loadedSkills(files, plugin) {
  if (!plugin) return null;
  const R = plugin.root;
  const skillDirs = new Set(files.filter((f) => posix.basename(f) === "SKILL.md").map(folderOf));
  if (plugin.skills) return new Set(plugin.skills.filter((s) => skillDirs.has(s)));
  const out = new Set();
  for (const d of skillDirs) if (posix.dirname(d) === join(R, "skills")) out.add(d);
  for (const m of plugin.manifests) {
    for (const p of asList(m.data?.skills)) {
      const at = join(R, trim(p));
      if (skillDirs.has(at)) out.add(at);
      for (const d of skillDirs) if (posix.dirname(d) === at) out.add(d);
    }
  }
  if (!out.size && skillDirs.has(R) && !files.some((f) => f.startsWith(join(R, "skills") + "/"))) out.add(R);
  return out;
}

// ── What a plugin adds: commands, sub-agents, rules, hooks, MCP servers ──

/** Markdown files a component path names: a file, or the files of a folder. */
function mdFiles(files, root, paths, exts = /\.(?:md|mdc|markdown)$/i, deep = true) {
  const out = [];
  for (const p of paths) {
    const at = join(root, trim(p));
    if (files.includes(at) && exts.test(at)) { out.push(at); continue; }
    for (const f of files) if (f.startsWith(`${at}/`) && exts.test(f) && (deep || !f.slice(at.length + 1).includes("/"))) out.push(f);
  }
  return [...new Set(out)];
}

/** A Markdown component's front matter, with the fields a command, a sub-agent and a rule name. */
function frontOf(text) {
  const lines = linesOf(String(text ?? ""));
  const out = {};
  if (trim(lines[0]) !== "---") return out;
  for (let i = 1; i < lines.length && i < 80; i += 1) {
    if (trim(lines[i]) === "---") break;
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (m && !(m[1] in out)) out[m[1]] = trim(m[2]).replace(/^["']|["']$/g, "");
  }
  return out;
}
const listOf = (v) => trim(v).replace(/^\[|\]$/g, "").split(/\s*,\s*|\s+(?=[A-Z][a-zA-Z]+(?:\(|\s|$))/).map((x) => trim(x).replace(/^["']|["']$/g, "")).filter(Boolean);

/** Whether a tool a component may use runs shell commands. */
export const SHELL_TOOL = /^(?:Bash|Shell|shell|terminal|run_terminal_cmd)\b/;

/** The words for what starts a hook, by its event (Claude Code's, Cursor's and Codex's names). */
const EVENTS = {
  sessionstart: "when a session starts", sessionend: "when a session ends", userpromptsubmit: "each time the person sends a message", beforesubmitprompt: "each time the person sends a message",
  pretooluse: "before each tool it uses", posttooluse: "after each tool it uses", posttoolusefailure: "after a tool fails", permissionrequest: "when it asks for a permission",
  notification: "when the tool shows a notification", stop: "when the assistant finishes a reply", subagentstart: "when a sub-agent starts", subagentstop: "when a sub-agent finishes",
  precompact: "before the conversation is compacted", beforeshellexecution: "before each shell command", aftershellexecution: "after each shell command",
  beforemcpexecution: "before each use of an MCP server", aftermcpexecution: "after each use of an MCP server", beforereadfile: "before each file it reads", afterfileedit: "after each file it edits",
  afteragentresponse: "after each reply", afteragentthought: "after each step of its thinking", workspaceopen: "when a project opens", beforetabfileread: "before Tab reads a file", aftertabfileedit: "after Tab edits a file",
  monitor: "the whole session, in the background",
};
const MATCHED = { startup: "starts", resume: "resumes", clear: "is cleared", compact: "is compacted" };
const TOOL_WORDS = { bash: "shell command", shell: "shell command", write: "file it writes", edit: "file edit", multiedit: "file edit", read: "file it reads", skill: "skill it runs", webfetch: "web page it fetches", websearch: "web search", task: "sub-agent it starts", agent: "sub-agent it starts", glob: "file search", grep: "text search", notebookedit: "notebook edit" };
const or = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
/** What starts a hook, in words: "When a session starts, is cleared or is compacted". */
export function eventWords(event, matcher) {
  const e = trim(event).toLowerCase();
  const m = trim(matcher);
  if (e === "sessionstart" && m && m !== "*") {
    const ways = [...new Set(m.split("|").map((x) => MATCHED[trim(x).toLowerCase()]).filter(Boolean))];
    if (ways.length) return `When a session ${or(ways)}`;
  }
  let w = EVENTS[e] ?? `on the ${trim(event).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} event`;
  if (m && m !== "*" && /tooluse/.test(e)) {
    const tools = [...new Set(m.split("|").map((x) => { const t = trim(x); return TOOL_WORDS[t.toLowerCase()] ?? (/^mcp__/.test(t) ? "use of an MCP server" : `use of ${t}`); }).filter(Boolean))];
    if (tools.length) w = `${e.startsWith("pre") ? "before" : "after"} each ${or(tools)}`;
  }
  return `${w[0].toUpperCase()}${w.slice(1)}`;
}

/** The plugin folder a command line's variables name. */
const ROOT_VARS = /\$\{?(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|PLUGIN_ROOT|CODEX_PLUGIN_ROOT)\}?/g;
/** A program that fetches a package and runs it, each time. */
const RUNNER = /^(?:npx|bunx|pnpx|uvx|pipx)$/;
/** The files of the plugin a command runs: each word that names one, and, for
 *  a launcher, a bare word naming a file beside it ("session-start"). */
export function filesRun(command, root, have) {
  const words = String(command ?? "").replace(ROOT_VARS, root || ".").match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const out = [];
  for (const raw of words) {
    const w = raw.replace(/^["']|["']$/g, "");
    if (!/[/\\]|\.[a-z]{1,4}$/i.test(w) || /^https?:/i.test(w)) continue;
    const at = join(root, w.replace(/\\/g, "/").replace(/^\.\//, ""));
    const plain = join(w.replace(/\\/g, "/"));
    for (const c of [at, plain]) if (have(c) && !out.includes(c)) out.push(c);
  }
  for (const f of [...out]) {
    if (!/\.(?:cmd|bat|sh|ps1)$|(^|\/)[^.]+$/i.test(f)) continue;
    for (const raw of words) {
      const w = raw.replace(/^["']|["']$/g, "");
      if (!/^[\w-]+$/.test(w)) continue;
      const beside = join(posix.dirname(f), w);
      if (beside !== f && have(beside) && !out.includes(beside)) out.push(beside);
    }
  }
  return out;
}

/** What a program's text does that matters on a person's machine, by pattern. */
export const TOUCHES = [
  { what: "home-folder", re: /\bos\.homedir\s*\(|\bhomedir\s*\(\)|\bexpanduser\s*\(|\bPath\.home\s*\(|(?:^|[\s"'`(=])~\/(?!\/)|\$\{?HOME\}?\b|\$\{?USERPROFILE\}?|process\.env\.(?:HOME|USERPROFILE)\b|\benviron(?:\.get)?\s*[[(]\s*["'](?:HOME|USERPROFILE)["']/ },
  { what: "credential-store", re: /\.ssh\/|\.aws\/(?:credentials|config)|\.netrc\b|\.npmrc\b|\.pypirc\b|\.docker\/config\.json|\.kube\/config|\.config\/gh\b|\.git-credentials|\bsecurity\s+find-(?:generic|internet)-password|\bgh\s+auth\s+token|\bgcloud\s+auth\s+print-access-token|\bkeychain\b|\bkeytar\b|(?:Google\/Chrome|Chromium|BraveSoftware|Mozilla\/Firefox)\/[^"'\n]*(?:Cookies|Login Data|cookies\.sqlite|logins\.json)/i },
  { what: "environment", re: /\.\.\.\s*process\.env\b|Object\.(?:keys|entries|assign)\s*\(\s*(?:\{\s*\}\s*,\s*)?process\.env\s*\)|JSON\.stringify\s*\(\s*process\.env|\benv\s*:\s*process\.env\b|\bos\.environ\.copy\s*\(|\bdict\s*\(\s*os\.environ\s*\)|\bos\.environ\.items\s*\(|^\s*printenv\b/m },
  // A hook's output that the tool adds to the assistant's instructions (0.5.3).
  { what: "adds-context", re: /\badditionalContext\b|\badditional_context\b|\bhookSpecificOutput\b/, hooksOnly: true },
  { what: "download-run", re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString)\b|\bnpx\s+(?:-y|--yes)\b|\bnpm\s+(?:i|install)\s+(?:-g|--global)\b|\bpip3?\s+install\b|\buv\s+(?:tool\s+)?install\b|\bgit\s+(?:pull|clone)\b/i, runs: true },
];
/** A line that starts a program, in a file that is not a shell script: a
 *  command written in a message or a comment runs nothing. */
const STARTS = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|system|popen|Popen|check_output|check_call|run)\s*\(|\$`|\bBun\.\$/;
const isShell = (file, text) => /\.(?:sh|bash|zsh|cmd|bat|ps1)$/i.test(file) || (!posix.extname(file) && /^#!.*\b(?:ba|z)?sh\b/.test(String(text ?? "")));
/** The lines of a program's text where a pattern holds, comments left out. */
function linesWhere(p, file, text) {
  const shell = isShell(file, text);
  return linesOf(String(text ?? "")).map((l, i) => (!/^\s*(?:\/\/|#(?!!)|\*|--|rem\s|::)/i.test(l) && p.re.test(l) && (!p.runs || shell || STARTS.test(l)) ? i + 1 : 0)).filter(Boolean);
}

/** What one program does that matters on the person's machine, with the
 *  files of the plugin it imports, followed all the way down: {file, kind,
 *  lines, imports, hosts, starts, touches}. The shell's trace reads a file
 *  named with no extension when it starts with #!. */
function programOf(file, read, root, fileSet) {
  const all = CODE.has(posix.extname(file).toLowerCase()) ? closureOf(file, root, read, fileSet) : [file];
  const hosts = new Set(); const starts = new Set(); const touches = new Set(); let lines = 0;
  for (const f of all.length ? all : [file]) {
    const t = String(read(f) ?? "");
    let tr = { hosts: [], commands: [] };
    try { tr = traceOne(f, t); } catch { /* a program the trace cannot read is said by its size alone */ }
    for (const h of tr.hosts) hosts.add(h.host);
    for (const c of tr.commands) starts.add(c.what);
    // What a hook prints is its own file's to say: a module it imports may
    // print for other hooks (0.5.5, vercel-plugin's telemetry hook).
    for (const p of TOUCHES) if ((!p.hooksOnly || f === file) && linesWhere(p, f, t).length) touches.add(p.what);
    lines += codeLines(t);
  }
  const t = String(read(file) ?? "");
  const ext = posix.extname(file).toLowerCase();
  const first = linesOf(t)[0] ?? "";
  const kind = /\.(?:m?[jt]sx?|cjs|cts|mts)$/.test(ext) || /\bnode\b|\bbun\b|\bdeno\b/.test(first) ? "a JavaScript program"
    : ext === ".py" || /\bpython/.test(first) ? "a Python program"
      : /\.(?:sh|bash|zsh)$/.test(ext) || /\b(?:ba|z)?sh\b/.test(first) ? "a shell script"
        : ext === ".cmd" || ext === ".bat" ? "a script" : ext === ".ps1" ? "a PowerShell script" : "a program";
  return { file, kind, lines, imports: Math.max(0, all.length - 1), hosts: [...hosts].slice(0, 20), starts: [...starts].slice(0, 20), touches: [...touches] };
}

/** The programs a command line starts that the plugin does not hold. */
function outsidePrograms(command) {
  const words = String(command ?? "").replace(ROOT_VARS, "").match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const first = (words[0] ?? "").replace(/^["']|["']$/g, "");
  const runner = RUNNER.test(posix.basename(first)) ? posix.basename(first) : null;
  const pkg = runner ? words.slice(1).map((w) => w.replace(/^["']|["']$/g, "")).find((w) => !w.startsWith("-")) ?? null : null;
  return { first: posix.basename(first), runner, package: pkg };
}

/** Whether a package a runner fetches is pinned to one version. */
export const pinned = (pkg) => {
  const p = trim(pkg);
  if (!p) return false;
  const at = p.lastIndexOf("@");
  const v = at > 0 ? p.slice(at + 1) : (/==\s*([\w.]+)$/.exec(p)?.[1] ?? "");
  return Boolean(v) && !/^(?:latest|next|canary|beta|alpha)$/i.test(v) && /\d/.test(v) && !/[\^~*x><]/.test(v);
};

/** A hooks file's handlers: [{event, matcher, type, command, url, prompt, timeout, async, line}].
 *  Claude Code's shape ({hooks: {Event: [{matcher, hooks: [...]}]}}) and Cursor's
 *  ({version, hooks: {event: [{command, matcher}]}}) both. */
function handlersOf(doc, text) {
  const map = doc?.hooks && typeof doc.hooks === "object" && !Array.isArray(doc.hooks) ? doc.hooks : doc && !doc.hooks ? doc : {};
  const out = [];
  for (const [event, groups] of Object.entries(map)) {
    if (!Array.isArray(groups)) continue;
    const line = lineOfKey(text, event);
    for (const g of groups) {
      if (!g || typeof g !== "object") continue;
      const list = Array.isArray(g.hooks) ? g.hooks : [g];
      // Claude Code's and Codex's entries hold their handlers; Cursor's are the handler.
      const flat = !Array.isArray(g.hooks);
      for (const h of list) {
        if (!h || typeof h !== "object") continue;
        const type = trim(h.type).toLowerCase() || (h.command ? "command" : h.url ? "http" : h.prompt ? "prompt" : "command");
        const command = typeof h.command === "string" ? h.command : Array.isArray(h.args) ? [h.command, ...h.args].filter(Boolean).join(" ") : "";
        out.push({ flat, event, matcher: typeof g.matcher === "string" ? g.matcher : typeof h.matcher === "string" ? h.matcher : "", type, command, url: typeof h.url === "string" ? h.url : "", prompt: typeof h.prompt === "string" ? h.prompt : "", timeout: Number(h.timeout) || null, async: h.async === true, line: lineOfKey(text, "command", line - 1) || line });
      }
    }
  }
  return out;
}

/** An MCP configuration's servers: [{name, line, ...}]. */
function serversOf(map, text) {
  const out = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [name, s] of Object.entries(map)) {
    if (!s || typeof s !== "object") continue;
    const url = trim(s.url ?? s.serverUrl ?? s.httpUrl);
    const command = trim(s.command);
    const args = Array.isArray(s.args) ? s.args.map((a) => String(a)) : [];
    const transport = command ? "stdio" : /sse/i.test(trim(s.type ?? s.transport)) ? "sse" : /^wss?:/i.test(url) ? "ws" : url ? "http" : "unknown";
    let host = null;
    try { host = url ? new URL(url).hostname.toLowerCase() : null; } catch { host = null; }
    const env = s.env && typeof s.env === "object" ? Object.keys(s.env) : [];
    const headers = s.headers && typeof s.headers === "object" ? Object.keys(s.headers) : [];
    // The settings its values name (${VAR} or ${user_config.key}), never the values.
    const named = [...new Set([...Object.values(s.env ?? {}), ...Object.values(s.headers ?? {}), ...args].flatMap((v) => [...String(v).matchAll(/\$\{([A-Za-z_][\w.]*)\}/g)].map((m) => m[1])).filter((v) => !/^(?:CLAUDE|CURSOR|CODEX)?_?PLUGIN_(?:ROOT|DATA)$/.test(v)))];
    const runner = RUNNER.test(posix.basename(command)) ? posix.basename(command) : command === "docker" ? "docker" : null;
    const pkg = runner && runner !== "docker" ? args.find((a) => !a.startsWith("-")) ?? null : runner === "docker" ? args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-e" && args[i - 1] !== "--env" && /[/:]/.test(a)) ?? null : null;
    out.push({
      name, line: lineOfKey(text, name), transport, ...(url ? { url: scrub(url).slice(0, 300), host } : {}),
      ...(command ? { command: posix.basename(command), args: args.slice(0, 12).map((a) => scrub(a).slice(0, 200)) } : {}),
      ...(runner ? { runner, package: pkg, pinned: pinned(pkg) } : {}),
      env, headers, settings: named, auth: trim(s.auth ?? s.oauth?.type ?? (s.oauth ? "oauth" : "")).toLowerCase() || (headers.some((h) => /authorization|api[-_]?key|token/i.test(h)) ? "header" : null),
      ...(typeof s.note === "string" && trim(s.note) ? { note: scrub(trim(s.note)).slice(0, 600) } : typeof s.description === "string" && trim(s.description) ? { note: scrub(trim(s.description)).slice(0, 600) } : {}),
    });
  }
  return out;
}

/**
 * The facts of one plugin, without ids: [{kind, file, line, data}].
 *   plugin-manifest  each of its manifests: the tool, name, version, author
 *   plugin           each plugin the repository holds, when it holds several
 *                    or lists one kept elsewhere, and whether it is inspected
 *   slash-command    each command, with its size and the tools it may use
 *   sub-agent        each sub-agent, with its size and its tools
 *   rule             each of Cursor's rules
 *   hook             each hook: what starts it, what it runs, and what that
 *                    program reaches, starts and touches
 *   mcp-server       each MCP server: a program it starts, or an address
 *   user-config      each value the plugin asks the person for
 *   capability       what its scripts touch on the machine: the home folder,
 *                    stored credentials, the whole environment, code it
 *                    downloads and runs
 * `shape` is shapeOf's answer, `plugin` the one inspected (or null for a
 * repository of skills alone), `files` the plugin's files.
 */
export function pluginFacts(files, read, shape, plugin, allFiles = files) {
  const out = [];
  const add = (kind, file, line, data) => out.push({ kind, file, line: Number(line) > 0 ? Number(line) : 1, data });
  const fileSet = new Set(files);
  const have = (f) => fileSet.has(f) || read(f) !== null;
  if (shape.kind === "plugin") {
    for (const p of shape.plugins) {
      if (shape.plugins.length < 2 && !p.elsewhere) break;
      const e = p.entries[0];
      const file = e?.market.file ?? p.manifests[0]?.file;
      if (!file) continue;
      const text = read(file) ?? "";
      const line = e ? lineOfValue(text, "name", e.entry?.name, lineOfKey(text, "plugins")) : lineOfKey(text, "name");
      const skillCount = p.skills ? p.skills.length : p.elsewhere ? null : loadedSkills(allFiles, p).size;
      add("plugin", file, line, { name: p.name, ...(p.display_name ? { display_name: p.display_name } : {}), ...(p.description ? { description: scrub(p.description).slice(0, 300) } : {}), tools: p.tools, ...(p.elsewhere ? { elsewhere: p.elsewhere } : { root: p.root || "." }), ...(skillCount !== null ? { skills: skillCount } : {}), inspected: p === plugin });
    }
  }
  if (!plugin) return [...out, ...touchFacts(files, read, "")];
  const R = plugin.root;
  for (const m of plugin.manifests) {
    const text = read(m.file) ?? "";
    const d = m.data ?? {};
    add("plugin-manifest", m.file, lineOfKey(text, "name"), {
      tool: m.tool, name: trim(d.name) || null, ...(trim(d.displayName ?? d.interface?.displayName) ? { display_name: trim(d.displayName ?? d.interface?.displayName) } : {}),
      version: trim(d.version) || null, author: trim(typeof d.author === "string" ? d.author : d.author?.name) || null, license: trim(d.license) || null,
      ...(trim(d.description) ? { description: scrub(trim(d.description)).slice(0, 400) } : {}), ...(d.$schema ? { schema: trim(d.$schema) } : {}),
      // The open standard keeps each client's own files in a folder named by a reverse domain.
      ...(m.tool === AGENT_PLUGINS_TOOL ? { extensions: Object.keys(d.extensions ?? {}).slice(0, 20), extension_folders: [...new Set(files.filter((f) => under(R, f) && f !== R).map((f) => f.slice(R ? R.length + 1 : 0)).filter((rel) => rel.includes("/")).map((rel) => rel.split("/")[0]).filter((x) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(x)))].slice(0, 20) } : {}),
    });
  }
  const manifestOf = (tool) => plugin.manifests.find((m) => m.tool === tool)?.data ?? null;
  const claude = manifestOf("Claude Code"); const cursor = manifestOf("Cursor"); const codex = manifestOf("Codex");
  const usesClaude = plugin.tools.includes("Claude Code"); const usesCursor = plugin.tools.includes("Cursor"); const usesCodex = plugin.tools.includes("Codex");

  // Commands and sub-agents: what a manifest names, else the default folder.
  const component = (kind, field, folder, exts, toolsOf) => {
    const byFile = new Map();
    const take = (list, tool) => { for (const f of list) { if (!byFile.has(f)) byFile.set(f, new Set()); byFile.get(f).add(tool); } };
    for (const [tool, m, on] of [["Claude Code", claude, usesClaude], ["Cursor", cursor, usesCursor], ["Codex", codex, usesCodex]]) {
      if (!on || !toolsOf.includes(tool)) continue;
      const v = m?.[field];
      if (v && typeof v === "object" && !Array.isArray(v)) take(Object.values(v).map((x) => (typeof x?.source === "string" ? join(R, x.source) : null)).filter((x) => x && have(x)), tool);
      else if (v !== undefined) take(mdFiles(files, R, asList(v).filter((x) => typeof x === "string"), exts), tool);
      else take(mdFiles(files, R, [folder], exts), tool);
    }
    for (const [f, tools] of byFile) {
      const text = read(f) ?? "";
      const fm = frontOf(text);
      const body = bodyOf(text);
      const name = trim(fm.name) || posix.basename(f).replace(/\.[^.]+$/, "");
      const may = listOf(fm["allowed-tools"] ?? fm.allowedTools ?? fm.tools ?? "");
      add(kind, f, fm.description ? lineOfFront(text, "description") : 1, {
        name, ...(trim(fm.description) ? { description: scrub(trim(fm.description)).slice(0, 400) } : {}), tools: [...tools],
        ...(may.length ? { may_use: may.slice(0, 30), shell: may.some((t) => SHELL_TOOL.test(t)) } : {}), ...(trim(fm.model) ? { model: trim(fm.model) } : {}),
        ...(kind === "rule" ? { always: /^true$/i.test(trim(fm.alwaysApply)), ...(trim(fm.globs) ? { globs: trim(fm.globs) } : {}) } : {}),
        size: { chars: body.length, lines: linesOf(body).filter((l) => trim(l)).length },
      });
    }
  };
  component("slash-command", "commands", "commands", /\.(?:md|mdc|markdown|txt)$/i, ["Claude Code", "Cursor"]);
  component("sub-agent", "agents", "agents", /\.(?:md|mdc|markdown)$/i, ["Claude Code", "Cursor"]);
  component("rule", "rules", "rules", /\.(?:md|mdc|markdown)$/i, ["Cursor"]);

  // Hooks: the default file, and what each manifest names, with the tools that load each.
  const hookFiles = new Map();
  const hookFile = (f, tool) => { if (!have(f)) return; if (!hookFiles.has(f)) hookFiles.set(f, new Set()); hookFiles.get(f).add(tool); };
  const inline = [];
  for (const [tool, m, on] of [["Claude Code", claude, usesClaude], ["Cursor", cursor, usesCursor], ["Codex", codex, usesCodex]]) {
    if (!on) continue;
    const v = m?.hooks;
    // Claude Code merges what its manifest names with hooks/hooks.json; for
    // Cursor and Codex a manifest's hooks replace the default file.
    if (tool === "Claude Code" || v === undefined) hookFile(join(R, "hooks/hooks.json"), tool);
    for (const x of asList(v)) {
      if (typeof x === "string") hookFile(join(R, x), tool);
      else if (x && typeof x === "object" && Object.keys(x).length) inline.push({ tool, doc: { hooks: x }, file: plugin.manifests.find((mm) => mm.tool === tool)?.file });
    }
  }
  const hookFacts = [];
  // A file in Cursor's shape is Cursor's; one in Claude Code's shape is the others'.
  const shapedFor = (h, tools) => { const fit = [...tools].filter((t) => (h.flat ? t === "Cursor" : t !== "Cursor")); return fit.length ? fit : [...tools]; };
  for (const [f, tools] of hookFiles) { const text = read(f) ?? ""; for (const h of handlersOf(json(text), text)) hookFacts.push({ ...h, file: f, tools: shapedFor(h, tools) }); }
  for (const x of inline) { const text = read(x.file) ?? ""; for (const h of handlersOf(x.doc, text)) hookFacts.push({ ...h, file: x.file, line: lineOfKey(text, "hooks"), tools: [x.tool] }); }
  // Claude Code's monitors run a command in the background for the whole session.
  const monitorsFile = typeof claude?.experimental?.monitors === "string" ? join(R, claude.experimental.monitors) : join(R, "monitors/monitors.json");
  if (usesClaude && have(monitorsFile)) {
    const text = read(monitorsFile) ?? "";
    for (const m of asList(json(text))) if (m && typeof m.command === "string") hookFacts.push({ event: "Monitor", matcher: "", type: "command", command: m.command, url: "", prompt: "", timeout: null, async: true, line: lineOfKey(text, "command"), file: monitorsFile, tools: ["Claude Code"], name: trim(m.name) });
  }
  // The same hook loaded by several tools is one hook: the same event and
  // the same files run (or the same command line when it runs none of the plugin's).
  const seen = new Map();
  for (const h of hookFacts) {
    const runs = h.type === "command" ? filesRun(h.command, R, have) : [];
    const key = `${h.event.toLowerCase()}|${h.type}|${runs.length ? runs.join(",") : `${h.matcher}|${h.command.replace(ROOT_VARS, "").replace(/["']/g, "").replace(/^\.?\//, "").trim()}`}|${h.url}`;
    if (seen.has(key)) { const was = seen.get(key); for (const t of h.tools) if (!was.tools.includes(t)) was.tools.push(t); continue; }
    seen.set(key, h);
  }
  for (const h of seen.values()) {
    const runs = h.type === "command" ? filesRun(h.command, R, have) : [];
    const programs = runs.map((f) => programOf(f, read, R, fileSet));
    const outside = h.type === "command" ? outsidePrograms(h.command) : null;
    const lineText = (h.command || h.url || h.prompt).replace(ROOT_VARS, "<plugin>");
    add("hook", h.file, h.line, {
      event: h.event, ...(h.matcher ? { matcher: h.matcher } : {}), trigger: eventWords(h.event, h.matcher), type: h.type, tools: h.tools,
      ...(h.type === "command" ? { command: scrub(lineText).slice(0, 300) } : {}), ...(h.url ? { url: scrub(h.url).slice(0, 300) } : {}), ...(h.prompt ? { prompt_chars: h.prompt.length } : {}),
      ...(h.timeout ? { timeout: h.timeout } : {}), ...(h.async ? { background: true } : {}),
      files: runs, programs: programs.map((p) => ({ kind: p.kind, lines: p.lines, imports: p.imports, hosts: p.hosts, starts: p.starts, touches: p.touches })),
      ...(outside && !runs.length ? { runs_outside: outside.first || null, ...(outside.runner ? { runner: outside.runner, package: outside.package, pinned: pinned(outside.package) } : {}) } : {}),
      ...(outside?.runner && runs.length ? { runner: outside.runner, package: outside.package, pinned: pinned(outside.package) } : {}),
    });
  }

  // MCP servers: the default files, and what each manifest names or holds inline.
  const servers = new Map();
  const take = (list, file, tool) => {
    for (const s of list) {
      const key = `${s.name.toLowerCase()}|${s.url ?? ""}|${s.command ?? ""}|${(s.args ?? []).join(" ")}`;
      // One server several tools name: each copy may say what another leaves out (its sign-in, its note).
      if (servers.has(key)) { const was = servers.get(key); if (!was.tools.includes(tool)) was.tools.push(tool); if (!was.auth && s.auth) was.auth = s.auth; if (!was.note && s.note) was.note = s.note; continue; }
      servers.set(key, { ...s, file, tools: [tool] });
    }
  };
  const fileServers = (f, tool) => { if (!have(f)) return; const text = read(f) ?? ""; const d = json(text); take(serversOf(d?.mcpServers ?? d?.servers ?? null, text), f, tool); };
  for (const [tool, m, on, defaults] of [["Claude Code", claude, usesClaude, [".mcp.json"]], ["Cursor", cursor, usesCursor, ["mcp.json"]], ["Codex", codex, usesCodex, ["mcp.json", ".mcp.json"]], [AGENT_PLUGINS_TOOL, manifestOf(AGENT_PLUGINS_TOOL), plugin.tools.includes(AGENT_PLUGINS_TOOL), ["mcp.json"]]]) {
    if (!on) continue;
    const v = tool === "Codex" ? m?.mcpServers ?? m?.extensions?.["com.openai"]?.mcpServers : m?.mcpServers;
    if (tool === "Claude Code" || v === undefined || tool === AGENT_PLUGINS_TOOL) for (const d of defaults) fileServers(join(R, d), tool);
    for (const x of asList(v)) {
      if (typeof x === "string" && /\.json$/i.test(x)) fileServers(join(R, x), tool);
      else if (x && typeof x === "object") { const mf = plugin.manifests.find((mm) => mm.tool === tool)?.file; take(serversOf(x, read(mf) ?? ""), mf, tool); }
    }
  }
  // Another tool's manifest that carries its own servers inline (Kimi, Antigravity and others).
  for (const m of plugin.manifests.filter((x) => !["Claude Code", "Cursor", "Codex", AGENT_PLUGINS_TOOL].includes(x.tool))) {
    if (m.data?.mcpServers && typeof m.data.mcpServers === "object") take(serversOf(m.data.mcpServers, read(m.file) ?? ""), m.file, m.tool);
  }
  for (const s of servers.values()) {
    const { file, line, ...data } = s;
    const runs = s.transport === "stdio" ? filesRun([s.command, ...(s.args ?? [])].join(" "), R, have) : [];
    add("mcp-server", file, line, { ...data, ...(runs.length ? { files: runs, programs: runs.map((f) => { const p = programOf(f, read, R, fileSet); return { kind: p.kind, lines: p.lines, imports: p.imports, hosts: p.hosts, touches: p.touches }; }) } : {}) });
  }

  // The values it asks the person for.
  if (claude?.userConfig && typeof claude.userConfig === "object") {
    const mf = plugin.manifests.find((m) => m.tool === "Claude Code").file; const text = read(mf) ?? "";
    for (const [key, o] of Object.entries(claude.userConfig)) if (o && typeof o === "object") add("user-config", mf, lineOfKey(text, key), { name: key, tool: "Claude Code", title: trim(o.title) || null, type: trim(o.type) || null, sensitive: o.sensitive === true, required: o.required === true });
  }
  if (cursor?.variables?.properties && typeof cursor.variables.properties === "object") {
    const mf = plugin.manifests.find((m) => m.tool === "Cursor").file; const text = read(mf) ?? "";
    const req = new Set(asList(cursor.variables.required));
    for (const [key, o] of Object.entries(cursor.variables.properties)) add("user-config", mf, lineOfKey(text, key), { name: key, tool: "Cursor", title: trim(o?.title ?? o?.description) || null, type: trim(o?.type) || null, sensitive: /key|token|secret|password/i.test(key), required: req.has(key) });
  }

  return [...out, ...touchFacts(files, read, R)];
}

/** What a plugin's or a skill's scripts touch on the machine, one fact per
 *  file and kind: [{kind: "capability", file, line, data: {what, match, lines}}].
 *  The coding assistants' own folders and the tests are left out. */
export function touchFacts(files, read, R = "") {
  const out = [];
  const add = (kind, file, line, data) => out.push({ kind, file, line, data });
  for (const f of files) {
    const t = read(f);
    if (typeof t !== "string" || t.length > 1_000_000 || isTestFile(f)) continue;
    const code = CODE.has(posix.extname(f).toLowerCase()) || ((!posix.extname(f) || /\.(?:cmd|ps1)$/i.test(f)) && /^#!|^@echo|^:\s*<</.test(t));
    if (!code || ASSISTANT_DIRS.some((d) => under(join(R, d.replace(/\/$/, "")), f))) continue;
    const lines = linesOf(t);
    for (const p of TOUCHES.filter((x) => !x.hooksOnly)) {
      const at = linesWhere(p, f, t);
      if (at.length) add("capability", f, at[0], { what: p.what, match: (lines[at[0] - 1].match(p.re)?.[0] ?? "").trim().slice(0, 80), lines: at.slice(0, 40) });
    }
  }
  return out;
}

/** The line a JSON key is written on with this value, at or after line `after`, else that key's first line. */
function lineOfValue(text, key, value, after = 0) {
  const lines = linesOf(String(text ?? ""));
  const v = JSON.stringify(String(value ?? ""));
  for (let i = Math.max(0, after); i < lines.length; i += 1) if (lines[i].includes(`"${key}"`) && lines[i].includes(v)) return i + 1;
  return lineOfKey(text, key, after);
}
/** The line of a front matter field. */
function lineOfFront(text, key) {
  const lines = linesOf(String(text ?? ""));
  for (let i = 1; i < Math.min(lines.length, 80); i += 1) { if (trim(lines[i]) === "---") break; if (new RegExp(`^${key}\\s*:`).test(lines[i])) return i + 1; }
  return 1;
}

// ── What the report says it inspected ──
/** The tools named first, in this order; any other is a tool it is also packaged for. */
export const MAIN_TOOLS = ["Claude Code", "Cursor", "Codex", AGENT_PLUGINS_TOOL];
/**
 * The report's subject member: null for an agent; else {kind, name,
 * display_name, version, author, description, tools, also_for, skills,
 * plugins?, picked_by?}. `plugins` lists every plugin of a repository that
 * holds several (or lists one kept elsewhere), each with whether it is the
 * one inspected.
 */
export function subjectOf(shape, picked, files, allFiles = files) {
  if (shape.kind === "agent") return null;
  if (shape.kind === "skills") return { kind: "skills", name: null, tools: [], also_for: [], skills: shape.skills.length };
  const p = picked.plugin;
  const tools = MAIN_TOOLS.filter((t) => p.tools.includes(t));
  const also = p.tools.filter((t) => !MAIN_TOOLS.includes(t));
  const many = shape.plugins.length > 1 || shape.plugins.some((x) => x.elsewhere);
  return {
    kind: "plugin", name: p.name, ...(p.display_name ? { display_name: p.display_name } : {}), version: p.version ?? null, author: p.author ?? null,
    ...(p.description ? { description: scrub(p.description).slice(0, 400) } : {}), tools, also_for: also, skills: loadedSkills(files, p).size,
    ...(many ? {
      plugins: shape.plugins.map((x) => ({ name: x.name ?? pluginName(x), ...(x.description ? { description: scrub(x.description).slice(0, 300) } : {}), tools: x.tools, ...(x.elsewhere ? { elsewhere: x.elsewhere } : { skills: x.skills ? x.skills.length : loadedSkills(x === p ? files : allFiles, x).size }), inspected: x === p })),
      picked_by: picked.by ?? "first",
    } : {}),
  };
}
/** The tools a subject installs into, in words: "Claude Code, Cursor and Codex". */
export function toolWords(subject) {
  const t = (subject?.tools ?? []).map((x) => (x === AGENT_PLUGINS_TOOL ? "any tool that reads the Agent Plugins format" : x));
  return and(t);
}

// ── The level of a hook, by rule ──
/**
 * A hook's level and categories, by rule: {level, categories: [ids], why}.
 *   - one that sends what happens in the session to an address: high
 *   - one that runs a program which calls an outside address, reads stored
 *     credentials, the home folder or the whole environment, downloads code
 *     to run, or fetches a package it does not pin: high
 *   - any other that runs a program on the machine: medium
 *   - one that only asks a model, and runs no code: low
 */
export function hookLevel(data) {
  const d = data ?? {};
  if (d.type === "http") return { level: "high", categories: ["LLM02:2025", "ASI03"], why: "it sends what happens in the session to an outside address" };
  if (d.type === "prompt" || d.type === "agent") return { level: "low", categories: ["LLM01:2025"], why: "it asks a model and runs no program" };
  const programs = Array.isArray(d.programs) ? d.programs : [];
  const touches = new Set(programs.flatMap((p) => p.touches ?? []));
  const hosts = programs.flatMap((p) => p.hosts ?? []);
  if (hosts.length) return { level: "high", categories: ["ASI05", "LLM02:2025"], why: "what it runs calls an outside address" };
  if (touches.has("credential-store")) return { level: "high", categories: ["ASI05", "ASI03"], why: "what it runs reads stored credentials" };
  if (touches.has("download-run") || (d.runner && !d.pinned)) return { level: "high", categories: ["ASI05", "LLM03:2025"], why: "it fetches code to run each time" };
  if (touches.has("home-folder") || touches.has("environment")) return { level: "medium", categories: ["ASI05", "ASI03"], why: "it runs a program on the machine without asking, and that program works in the home folder or reads the whole environment" };
  return { level: "medium", categories: ["ASI05"], why: "it runs a program on the machine without asking" };
}
