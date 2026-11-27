// How tied an agent is to its platform, and what moving it would take (0.6.0),
// read by rule from AgentMesh's agent platforms database.
//
// The database is a copy of AgentMesh's data/agent-platforms, taken byte for
// byte at one AgentMesh commit (assets/agent-platforms/pinned.json). It rates
// nine platforms in twelve categories, and each cell names, as the vendor's
// documentation writes them, what an agent's repository shows when it uses
// that feature: a package, an import, a call, a setting, a file, a key in a
// config file or a command. Inspect looks for each of them in the code:
//
//   - which platforms the agent is built on: a platform counts once the code
//     depends on one of its packages, imports one of its modules, holds a
//     file only that platform names, or its dependencies name one of its
//     frameworks (agent-facts.mjs FRAMEWORKS);
//   - which features of those platforms it uses, each at its file and line,
//     never a feature the platform merely offers: a call or a key in code
//     counts only in a file that imports that platform; a setting, a file or
//     a command only once the platform counts;
//   - which open standards the database names it uses through the standard's
//     own library (MCP, A2A, OpenTelemetry) or files (Agent Skills, Agent
//     Plugins 1.0.0).
//
// From those alone, readingOf says, for each category it uses, what it uses
// and how open that is, and for each other platform what moving it would
// take (swapping its outside services, and re-hosting its own code), what it
// would lose (a category the destination rates none or partial) and what
// replaces each feature, by the destination's own cell. It gives no
// recommendation. Tests, folders kept for coding assistants, lockfiles and
// vendored code are not the agent, and are not read.
//
//   needs: node >= 22. Reads only its own copy of the database.
//   import { loadDatabase, platformUses, readingOf, CATEGORY_KEYS } from "./platforms.mjs"
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { linesOf } from "./codebase.mjs";
import { isTestFile } from "./facts.mjs";
import { ASSISTANT_DIRS } from "./agent-facts.mjs";

const trim = (s) => String(s ?? "").trim();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Where the copy of the database is, beside this skill's scripts. */
export const DATABASE = new URL("../assets/agent-platforms/", import.meta.url);

/** The twelve categories, in the database's order. */
export const CATEGORY_KEYS = ["tracing", "evaluations", "prompt-management", "keys-and-secrets", "memory-and-state", "human-approval", "deployment", "sandboxes", "tool-connections", "agent-to-agent", "identity-and-access", "packaging"];

/** The copy of the database: {pinned, checked, platforms, categories}.
 *  `checked` is the earliest date any entry was checked, the database's own
 *  date; each category's title is the schema's, without its parentheses. */
export function loadDatabase(dir = DATABASE) {
  const at = (p) => new URL(p, dir);
  const pinned = JSON.parse(readFileSync(at("pinned.json"), "utf8"));
  const schema = JSON.parse(readFileSync(at("platform.schema.json"), "utf8"));
  const platforms = readdirSync(at("platforms/")).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(at(`platforms/${f}`), "utf8")));
  const props = schema.properties.categories.properties;
  const categories = CATEGORY_KEYS.map((key) => ({ key, title: trim(String(props[key]?.title ?? key).replace(/\s*\([^)]*\)\s*/g, " ")), about: props[key]?.description ?? "" }));
  const checked = platforms.map((p) => p.checked).filter(Boolean).sort()[0] ?? pinned.checked ?? null;
  // 0.7.0: the harnesses people run agents in, each named by its own name.
  let harnesses = [];
  try {
    harnesses = readdirSync(at("harnesses/")).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(at(`harnesses/${f}`), "utf8")));
  } catch { harnesses = []; }
  return { pinned, checked, platforms, categories, harnesses };
}

// ── Reading the code ──

const PY = new Set([".py"]);
const JS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const LANG_EXT = { python: PY, typescript: JS, javascript: JS, csharp: new Set([".cs"]), go: new Set([".go"]), java: new Set([".java", ".kt"]) };
const ALL_CODE = new Set([...PY, ...JS, ".cs", ".go", ".java", ".kt"]);
const CONFIG_EXT = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg"]);
const ext = (f) => posix.extname(f).toLowerCase();
const base = (f) => posix.basename(f);
const isEnvFile = (f) => /^\.env(\..+)?$/.test(base(f)) || /\.env$/.test(base(f));
const isDocker = (f) => /^(Dockerfile|Containerfile)(\..+)?$/.test(base(f)) || /\.dockerfile$/i.test(base(f));
const isCi = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /(^|\/)\.gitlab-ci\.ya?ml$/.test(f) || /(^|\/)(cloudbuild|azure-pipelines|buildspec)[^/]*\.ya?ml$/.test(f);
const isScript = (f) => [".sh", ".bash", ".zsh", ".ps1"].includes(ext(f)) || /^(Makefile|makefile|GNUmakefile|justfile|Justfile|Procfile|Taskfile\.ya?ml)$/.test(base(f)) || isDocker(f) || isCi(f) || base(f) === "package.json" || base(f) === "pyproject.toml";
const isConfig = (f) => CONFIG_EXT.has(ext(f)) || isEnvFile(f) || isDocker(f) || /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f);

/** Whether a file is part of the agent this reading is about: not a test, not
 *  a folder kept for the coding assistants that work on the repository (CI
 *  workflows are read for commands only), not a lockfile. */
export function isAgentFile(f, { forCommands = false } = {}) {
  if (isTestFile(f) || /(^|\/)(tests?|__tests__|fixtures?|testdata)\//.test(f)) return false;
  if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/.test(base(f))) return false;
  if (ASSISTANT_DIRS.some((d) => `${f}`.startsWith(d))) return forCommands && isCi(f);
  return true;
}

/** A file's lines with its comments and docstrings blanked, so a name a
 *  comment mentions is never read as code: Python's # and triple-quoted
 *  strings, JavaScript's, C#'s, Go's and Java's line and block comments, and
 *  the # comments of YAML, TOML, shell and settings files. The lines stay
 *  where they were, so every line number holds. */
export function codeOnly(file, lines) {
  const e = ext(file);
  if (PY.has(e)) {
    const out = [];
    let quote = null;
    for (const l of lines) {
      let s = ""; let i = 0;
      while (i < l.length) {
        if (quote) { const j = l.indexOf(quote, i); if (j < 0) { i = l.length; break; } i = j + 3; quote = null; continue; }
        const m = /("""|'''|#)/.exec(l.slice(i));
        if (!m) { s += l.slice(i); break; }
        s += l.slice(i, i + m.index);
        if (m[1] === "#") break;
        quote = m[1]; i += m.index + 3;
      }
      out.push(s);
    }
    return out;
  }
  if (JS.has(e) || [".cs", ".go", ".java", ".kt"].includes(e)) {
    const out = [];
    let block = false;
    for (const l of lines) {
      let s = ""; let i = 0;
      while (i < l.length) {
        if (block) { const j = l.indexOf("*/", i); if (j < 0) { i = l.length; break; } i = j + 2; block = false; continue; }
        const m = /(\/\*|\/\/)/.exec(l.slice(i));
        if (!m) { s += l.slice(i); break; }
        // Inside a string, such as an address, it is no comment.
        const before = l.slice(0, i + m.index);
        if (/^(?:[^"'`]|"[^"]*"|'[^']*'|`[^`]*`)*["'`][^"'`]*$/.test(before)) { s += l.slice(i, i + m.index + 2); i += m.index + 2; continue; }
        s += l.slice(i, i + m.index);
        if (m[1] === "//") break;
        block = true; i += m.index + 2;
      }
      out.push(s);
    }
    return out;
  }
  if (CONFIG_EXT.has(e) || isEnvFile(file) || isDocker(file) || [".sh", ".bash", ".zsh"].includes(e) || /^(Makefile|makefile|justfile|Procfile)$/.test(base(file))) return lines.map((l) => (/^\s*#/.test(l) ? "" : l));
  return lines;
}

/** Every import of one Python file: [{module, names, line, star}]. A
 *  parenthesised list over several lines is one import. */
export function pythonImports(text) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].replace(/#.*$/, "");
    let m = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.*)$/.exec(l);
    if (m) {
      let rest = m[2];
      const line = i + 1;
      if (/\(/.test(rest) && !/\)/.test(rest)) { while (i + 1 < lines.length && !/\)/.test(rest)) { i += 1; rest += ` ${lines[i].replace(/#.*$/, "")}`; } }
      else while (/\\\s*$/.test(rest) && i + 1 < lines.length) { i += 1; rest = `${rest.replace(/\\\s*$/, "")} ${lines[i].replace(/#.*$/, "")}`; }
      const names = rest.replace(/[()\\]/g, " ").split(",").map((s) => trim(s).split(/\s+as\s+/)[0]).map(trim).filter(Boolean);
      out.push({ module: m[1], names: names.filter((n) => n !== "*"), star: names.includes("*"), line });
      continue;
    }
    m = /^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)\s*$/.exec(l);
    if (m) for (const part of m[1].split(",")) out.push({ module: trim(part).split(/\s+/)[0], names: [], plain: true, line: i + 1 });
  }
  return out;
}

/** Every import of one JavaScript or TypeScript file: [{module, names, star, line}]. */
export function scriptImports(text) {
  const t = String(text ?? "");
  const out = [];
  const lineAt = (i) => t.slice(0, i).split("\n").length;
  const clauseNames = (c) => {
    const names = []; let star = false;
    const braces = /\{([^}]*)\}/.exec(c);
    if (braces) for (const p of braces[1].split(",")) { const n = trim(p).replace(/^type\s+/, "").split(/\s+as\s+/)[0]; if (n) names.push(trim(n)); }
    if (/\*\s+as\s+\w+/.test(c)) star = true;
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(c.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+\w+/, ""));
    if (def && def[1] !== "type") names.push("default");
    return { names, star };
  };
  // A type-only import (import type, or every name marked type) is erased
  // when the code is compiled: it is kept, and marked, but it is no use of
  // the module (vercel-plugin's hooks import only a type from the Claude
  // Agent SDK, a development dependency).
  for (const m of t.matchAll(/\b(?:import|export)\s+(type\s+)?([\w*${}\s,]+?)\s+from\s+["']([^"'\n]+)["']/g)) {
    const braces = /\{([^}]*)\}/.exec(m[2]);
    const outside = m[2].replace(/\{[^}]*\}/, "").replace(/[\s,]/g, "");
    const allTypes = !!braces && !outside && braces[1].split(",").map(trim).filter(Boolean).every((n) => /^type\s/.test(n));
    out.push({ module: m[3], ...clauseNames(m[2]), line: lineAt(m.index), ...(m[1] || allTypes ? { type_only: true } : {}) });
  }
  for (const m of t.matchAll(/\bimport\s+["']([^"'\n]+)["']/g)) out.push({ module: m[1], names: [], star: true, line: lineAt(m.index) });
  for (const m of t.matchAll(/\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) out.push({ module: m[1], names: [], star: true, line: lineAt(m.index) });
  return out;
}

/** Every using line of a C# file, and every import of a Go or Java file. */
function otherImports(file, text) {
  const out = [];
  const lines = linesOf(text);
  if (ext(file) === ".cs") lines.forEach((l, i) => { const m = /^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/.exec(l); if (m) out.push({ module: m[1], names: [], star: true, line: i + 1 }); });
  if (ext(file) === ".go") { let block = false; lines.forEach((l, i) => { if (/^\s*import\s*\(/.test(l)) { block = true; return; } if (block && /^\s*\)/.test(l)) { block = false; return; } const m = (block ? /^\s*(?:[\w.]+\s+)?"([^"]+)"/ : /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/).exec(l); if (m) out.push({ module: m[1], names: [], star: true, line: i + 1 }); }); }
  if (ext(file) === ".java" || ext(file) === ".kt") lines.forEach((l, i) => { const m = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;?\s*$/.exec(l); if (m) out.push({ module: m[1], names: [], star: true, line: i + 1 }); });
  return out;
}

const importsOf = (file, text) => (PY.has(ext(file)) ? pythonImports(text) : JS.has(ext(file)) ? scriptImports(text) : otherImports(file, text));

/** A package's name as manifests are compared: lower case, and for every
 *  ecosystem but npm's scoped names, runs of -, _ and . as one -. */
export const packageKey = (name) => { const n = trim(name).toLowerCase(); return n.startsWith("@") ? n : n.replace(/[-_.]+/g, "-"); };
const DEV_GROUP = /^(dev|devs|develop|development|test|tests|testing|lint|linting|docs?|typing|types|ci|bench|benchmarks?)$/i;
const REQ = /^\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?/;
const extrasOf = (s) => new Set(String(s ?? "").replace(/[[\]]/g, "").split(",").map((x) => trim(x).toLowerCase()).filter(Boolean));

/** Every dependency a manifest declares, not counting development ones:
 *  [{name, key, extras, line, eco}], eco python, npm, nuget or go. */
export function manifestDependencies(file, text) {
  const out = [];
  const lines = linesOf(text);
  const b = base(file);
  const push = (name, extras, line, eco) => out.push({ name, key: packageKey(name), extras: extrasOf(extras), line, eco });
  if (b === "package.json") {
    let pkg = null;
    try { pkg = JSON.parse(String(text ?? "")); } catch { pkg = null; }
    if (!pkg || typeof pkg !== "object") return out;
    for (const group of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const dep of Object.keys(pkg[group] ?? {})) {
        const i = lines.findIndex((l) => l.includes(`"${dep}"`));
        push(dep, "", i >= 0 ? i + 1 : 1, "npm");
      }
    }
    return out;
  }
  if (b === "pyproject.toml") {
    let table = ""; let arrayKey = null;
    lines.forEach((raw, i) => {
      const l = raw.replace(/\s+#.*$/, "");
      const t = /^\s*\[([^\]]+)\]\s*$/.exec(l);
      if (t) { table = trim(t[1]); arrayKey = null; return; }
      const poetry = /^tool\.poetry\.(?:dependencies|group\.([\w-]+)\.dependencies|dev-dependencies)$/.exec(table);
      if (poetry) {
        if (table.endsWith("dev-dependencies") || (poetry[1] && DEV_GROUP.test(poetry[1]))) return;
        const m = /^\s*([A-Za-z0-9][\w.-]*)\s*=\s*(.*)$/.exec(l);
        if (m && m[1].toLowerCase() !== "python") push(m[1], (/extras\s*=\s*\[([^\]]*)\]/.exec(m[2]) ?? [])[1]?.replace(/["']/g, "") ?? "", i + 1, "python");
        return;
      }
      const open = /^\s*([\w.-]+|"[^"]+")\s*=\s*\[(.*)$/.exec(l);
      let inline = null;
      if (open) { arrayKey = open[1].replace(/"/g, ""); inline = open[2]; }
      const counts = (table === "project" && arrayKey === "dependencies") || ((table === "project.optional-dependencies" || table === "dependency-groups") && arrayKey && !DEV_GROUP.test(arrayKey));
      const body = inline ?? (arrayKey ? l : "");
      if (counts) for (const s of body.matchAll(/["']([^"']+)["']/g)) { const m = REQ.exec(s[1]); if (m) push(m[1], m[2], i + 1, "python"); }
      if (arrayKey && /\]\s*,?\s*$/.test(inline ?? l) && !/^\s*\[/.test(inline ?? "")) arrayKey = null;
    });
    return out;
  }
  if (/^requirements[^/]*\.(txt|in)$/.test(b) || /(^|\/)requirements\/[^/]+\.(txt|in)$/.test(file)) {
    if (/(dev|test|lint|docs?)/i.test(b.replace(/^requirements/, ""))) return out;
    lines.forEach((l, i) => { if (/^\s*(#|-)/.test(l)) return; const m = REQ.exec(l); if (m) push(m[1], m[2], i + 1, "python"); });
    return out;
  }
  if (b === "setup.py") {
    const t = String(text ?? "");
    const m = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(t);
    if (m) { const start = t.slice(0, m.index).split("\n").length; for (const s of m[1].matchAll(/["']([^"']+)["']/g)) { const r = REQ.exec(s[1]); if (r) push(r[1], r[2], start + m[1].slice(0, s.index).split("\n").length - 1, "python"); } }
    return out;
  }
  if (b === "Pipfile") {
    let table = "";
    lines.forEach((l, i) => { const t = /^\s*\[([^\]]+)\]/.exec(l); if (t) { table = t[1]; return; } if (table !== "packages") return; const m = /^\s*([A-Za-z0-9][\w.-]*)\s*=/.exec(l); if (m) push(m[1], "", i + 1, "python"); });
    return out;
  }
  if (ext(file) === ".csproj" || b === "Directory.Packages.props") {
    lines.forEach((l, i) => { for (const m of l.matchAll(/<Package(?:Reference|Version)\s+Include="([^"]+)"/g)) push(m[1], "", i + 1, "nuget"); });
    return out;
  }
  if (b === "go.mod") {
    let block = false;
    lines.forEach((l, i) => { if (/^\s*require\s*\(/.test(l)) { block = true; return; } if (block && /^\s*\)/.test(l)) { block = false; return; } const m = (block ? /^\s*([\w.\-/]+)\s+v/ : /^\s*require\s+([\w.\-/]+)\s+v/).exec(l); if (m) out.push({ name: m[1], key: m[1].toLowerCase(), extras: new Set(), line: i + 1, eco: "go" }); });
  }
  return out;
}
const ECO_OF_LANG = { python: ["python"], typescript: ["npm"], javascript: ["npm"], csharp: ["nuget"], go: ["go"], java: [] };

/** One import line of the database as {lang, module, names}: Python's
 *  "from M import a, b" and "import M", JavaScript's "import {a} from 'M'",
 *  C#'s "using M;", or a module alone. */
export function evidenceImport(value, language = "any") {
  const v = trim(value);
  let m = /^from\s+([\w.]+)\s+import\s+(.+?)\s*$/.exec(v);
  if (m) return { lang: "python", module: m[1], names: m[2].split(",").map((s) => trim(s).split(/\s+as\s+/)[0]).filter((n) => n && n !== "*") };
  m = /^import\s+([\w.]+)\s*$/.exec(v);
  if (m && language !== "typescript" && language !== "javascript") return { lang: "python", module: m[1], names: [] };
  m = /^import\s+(.+?)\s+from\s+["']([^"']+)["'];?\s*$/.exec(v);
  if (m) { const braces = /\{([^}]*)\}/.exec(m[1]); return { lang: "js", module: m[2], names: braces ? braces[1].split(",").map((s) => trim(s).split(/\s+as\s+/)[0]).filter(Boolean) : [] }; }
  m = /^using\s+([\w.]+)\s*;?\s*$/.exec(v);
  if (m) return { lang: "csharp", module: m[1], names: [] };
  const lang = language === "python" ? "python" : language === "csharp" ? "csharp" : language === "go" ? "go" : language === "java" ? "java" : "js";
  return { lang, module: v, names: [] };
}

/** The top of a module, as a package is known by: Python's first part (two
 *  for the namespace packages google and azure), a JavaScript package's name
 *  (with its scope), C#'s first three parts, a Go module's first three. */
export function moduleRoot(module, lang) {
  const m = trim(module);
  if (lang === "python") { const parts = m.split("."); return ["google", "azure"].includes(parts[0]) && parts[1] ? `${parts[0]}.${parts[1]}` : parts[0]; }
  if (lang === "csharp") return m.split(".").slice(0, 3).join(".");
  if (lang === "go") return m.split("/").slice(0, 2).join("/");
  if (lang === "java") return m.split(".").slice(0, 3).join(".");
  return m.startsWith("@") ? m.split("/").slice(0, 2).join("/") : m.split("/")[0];
}

/** The libraries of the open standards themselves: their use is the
 *  standard's, never a platform's, so they are no sign of any platform. */
export const STANDARD_LIBRARIES = [
  { standard: "MCP", category: "tool-connections", python: ["mcp"], js: ["@modelcontextprotocol/sdk"], csharp: ["ModelContextProtocol"], packages: ["mcp", "@modelcontextprotocol/sdk", "modelcontextprotocol"] },
  { standard: "A2A", category: "agent-to-agent", python: ["a2a"], js: ["@a2a-js/sdk"], csharp: ["A2A"], packages: ["a2a-sdk", "@a2a-js/sdk", "a2a"] },
  { standard: "OpenTelemetry", category: "tracing", python: ["opentelemetry"], js: ["@opentelemetry/api", "@opentelemetry/sdk-node", "@opentelemetry/sdk-trace-node", "@opentelemetry/sdk-trace-base"], csharp: ["OpenTelemetry"], packages: ["opentelemetry-api", "opentelemetry-sdk", "@opentelemetry/api", "@opentelemetry/sdk-node"] },
];
const STANDARD_ROOT = (root, lang) => STANDARD_LIBRARIES.some((s) => (lang === "python" ? s.python : lang === "csharp" ? s.csharp : s.js).some((r) => root === r || root.startsWith(`${r}.`) || root.startsWith(`${r}/`))) || /^(@opentelemetry\/|opentelemetry[-_.]|@modelcontextprotocol\/)/i.test(root);

/** Names in a database import line that every agent of a framework imports
 *  (its Agent class), which show no one feature. */
const EVERY_AGENT = new Set(["Agent", "Runner", "Crew", "Task", "Mastra", "Tool", "tool", "function_tool"]);

/** The classes and functions a cell's words name: in backquotes, or a word
 *  with two capitals or more (InMemorySaver), never a common word. */
export function namedIn(what) {
  const t = String(what ?? "");
  const out = new Set();
  for (const m of t.matchAll(/`([A-Za-z_][\w]*)(?:\(\))?`/g)) out.add(m[1]);
  for (const m of t.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+)\b/g)) out.add(m[1]);
  return [...out].filter((n) => !EVERY_AGENT.has(n) && n.length > 3);
}

/** The database's file names that more than one platform could hold, or any
 *  repository might, which never show a platform on their own. */
const ANY_REPOSITORY = new Set([".env", ".env.example", "Dockerfile", "SKILL.md", "uv.lock", "plugin.json", "mcp.json", ".mcp.json", "agent.json", "evals/", ".test.json", "config/agents.yaml", ".claude/skills/"]);

/** A file of the database that shows a platform on its own: a config file
 *  only that platform names, never a Markdown file a coding assistant reads. */
const ANCHOR_FILE = /\.(jsonc?|ya?ml|toml)$/;

function fileMatches(value, files) {
  const v = trim(value);
  if (v.endsWith("/")) { const d = v.replace(/\/$/, ""); return files.filter((f) => f.startsWith(`${d}/`) || f.includes(`/${d}/`)).slice(0, 1).map((f) => ({ file: f, line: 1 })); }
  if (v.startsWith(".") && !v.includes("/") && v.split(".").length > 2) return files.filter((f) => base(f).endsWith(v) || base(f) === v.slice(1)).map((f) => ({ file: f, line: 1 }));
  if (v.includes("/")) return files.filter((f) => f === v || f.endsWith(`/${v}`)).map((f) => ({ file: f, line: 1 }));
  return files.filter((f) => base(f) === v).map((f) => ({ file: f, line: 1 }));
}

/** A literal from the database as a pattern over a line: a name or a dotted
 *  name whole, anything else with any spacing around its punctuation and
 *  either quote. */
export function literalPattern(value) {
  const v = trim(value);
  if (/^@?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(v)) return new RegExp(`(?<![\\w$.])${esc(v)}(?![\\w$])`);
  let p = "";
  for (const ch of v) {
    if (/\s/.test(ch)) p += "\\s*";
    else if (ch === '"' || ch === "'") p += "[\"']";
    else if (/[=([,:{]/.test(ch)) p += `\\s*${esc(ch)}\\s*`;
    else p += esc(ch);
  }
  return new RegExp(`${/^[A-Za-z_]/.test(v) ? "(?<![\\w$])" : ""}${p}`);
}

/** A key of a config file: in JSON "key":, in YAML key:, in TOML key = or a
 *  table, and in code a quoted key or a keyword argument. */
const keyPatterns = (k) => ({
  config: new RegExp(`(?:["']${esc(k)}["']\\s*:|^\\s*-?\\s*${esc(k)}\\s*:|^\\s*${esc(k)}\\s*=|^\\s*\\[(?:[\\w.-]+\\.)?${esc(k)}\\])`),
  code: new RegExp(`(?:["']${esc(k)}["']\\s*:|(?<![\\w$.])${esc(k)}\\s*=(?!=))`),
});

/**
 * What the code uses of each platform, and of the open standards:
 * {uses, standards, present}.
 *   uses       [{platform, category, kind, value, language, file, line}], one
 *              for each place an evidence item of a platform the code uses is
 *              found (at most PLACES of each)
 *   standards  [{standard, category, kind, value, file, line}]
 *   present    Map(platform id -> [{how, value, file, line}]), what shows the
 *              code uses that platform at all
 * `frameworks` are the framework facts' data ({framework, package}, with
 * their file and line), which name a platform by its products.
 */
export const PLACES = 6;
export function platformUses({ files, read, db, frameworks = [] }) {
  const agent = files.filter((f) => isAgentFile(f));
  const commandFiles = files.filter((f) => isAgentFile(f, { forCommands: true }) && isScript(f));
  const textCache = new Map();
  const text = (f) => { if (!textCache.has(f)) { const t = read(f); textCache.set(f, typeof t === "string" && t.length <= 2_000_000 ? t : null); } return textCache.get(f); };
  const lineCache = new Map();
  const linesIn = (f) => { if (!lineCache.has(f)) lineCache.set(f, text(f) === null ? null : codeOnly(f, linesOf(text(f)))); return lineCache.get(f); };
  const code = agent.filter((f) => ALL_CODE.has(ext(f)));
  const config = agent.filter((f) => isConfig(f));
  const importCache = new Map();
  const imports = (f) => { if (!importCache.has(f)) { const t = text(f); importCache.set(f, t === null ? [] : importsOf(f, t).filter((im) => !im.type_only)); } return importCache.get(f); };
  const langOf = (f) => (PY.has(ext(f)) ? "python" : JS.has(ext(f)) ? "js" : ext(f) === ".cs" ? "csharp" : ext(f) === ".go" ? "go" : "java");
  // A module the repository holds itself is the agent's own, whatever its name.
  const local = (root, file) => {
    if (langOf(file) !== "python") return false;
    const top = file.includes("/") ? file.split("/")[0] : "";
    const r = root.replace(/\./g, "/");
    return ["", "src", top].some((d) => files.includes(posix.join(d, `${r}.py`)) || files.includes(posix.join(d, r, "__init__.py")));
  };
  const deps = [];
  for (const f of agent) for (const d of manifestDependencies(f, text(f) ?? "")) deps.push({ ...d, file: f });

  const present = new Map();
  const roots = new Map();
  const note = (id, how, value, at) => { if (!present.has(id)) present.set(id, []); if (present.get(id).length < PLACES) present.get(id).push({ how, value, file: at.file, line: at.line }); };
  const dbFiles = new Map();
  for (const p of db.platforms) for (const c of Object.values(p.categories)) for (const e of c.evidence ?? []) if (e.kind === "file") { if (!dbFiles.has(e.value)) dbFiles.set(e.value, new Set()); dbFiles.get(e.value).add(p.id); }

  for (const p of db.platforms) {
    const r = { python: new Set(), js: new Set(), csharp: new Set(), go: new Set(), java: new Set() };
    for (const c of Object.values(p.categories)) for (const e of c.evidence ?? []) {
      if (e.kind === "import") { const ev = evidenceImport(e.value, e.language); const root = moduleRoot(ev.module, ev.lang); if (!STANDARD_ROOT(root, ev.lang)) r[ev.lang]?.add(root); }
      if (e.kind === "package" && (e.language === "python" || e.language === "any") && !e.value.startsWith("@")) { const root = packageKey(e.value.replace(/\[.*$/, "")).replace(/-/g, "_"); if (!STANDARD_ROOT(root, "python")) r.python.add(root); }
      if (e.kind === "package" && e.value.startsWith("@")) { const root = moduleRoot(e.value, "js"); if (!STANDARD_ROOT(root, "js")) r.js.add(root); }
    }
    roots.set(p.id, r);
    // Its packages, as a manifest declares them.
    for (const c of Object.values(p.categories)) for (const e of c.evidence ?? []) {
      if (e.kind !== "package") continue;
      const [name, ex] = [e.value.replace(/\[.*$/, ""), /\[([^\]]*)\]/.exec(e.value)?.[1] ?? ""];
      const key = packageKey(name);
      if (STANDARD_LIBRARIES.some((s) => s.packages.map(packageKey).includes(key))) continue;
      const d = deps.find((x) => x.key === key && (e.language === "any" || (ECO_OF_LANG[e.language] ?? []).includes(x.eco)));
      if (d) note(p.id, "package", e.value.replace(/\[.*$/, ""), d);
    }
    // Its modules, as the code imports them.
    for (const f of code) {
      const lang = langOf(f);
      for (const im of imports(f)) {
        const root = moduleRoot(im.module, lang);
        if (r[lang]?.has(root) && !local(root, f)) { note(p.id, "import", root, { file: f, line: im.line }); break; }
      }
    }
    // A file only this platform names.
    for (const [value, owners] of dbFiles) if (owners.size === 1 && owners.has(p.id) && !ANY_REPOSITORY.has(value) && ANCHOR_FILE.test(value)) for (const at of fileMatches(value, agent).slice(0, 1)) note(p.id, "file", value, at);
    // Its frameworks, by the names the dependencies give them.
    const products = p.products.map((x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const fw of frameworks) {
      const n = String(fw.framework ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const k = String(fw.package ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if ((n && products.some((x) => x.includes(n))) || (k && products.some((x) => x.includes(k)))) note(p.id, "framework", fw.framework, fw);
    }
  }

  const importsPlatform = (id, f) => { const r = roots.get(id); const lang = langOf(f); return imports(f).some((im) => { const root = moduleRoot(im.module, lang); return r[lang]?.has(root) && !local(root, f); }); };
  const uses = [];
  for (const p of db.platforms) {
    if (!present.has(p.id)) continue;
    for (const category of CATEGORY_KEYS) {
      const cell = p.categories[category];
      if (!cell || cell.rating === "none" || cell.rating === "unknown") continue;
      for (const e of cell.evidence ?? []) {
        const places = matchEvidence(e, { p, cell, deps, agent, code, config, commandFiles, imports, linesIn, langOf, local, importsPlatform });
        for (const at of places.slice(0, PLACES)) uses.push({ platform: p.id, category, kind: e.kind, value: e.value, language: e.language ?? "any", file: at.file, line: at.line, files: new Set(places.map((x) => x.file)).size, ...(at.names?.length ? { names: at.names } : {}), ...(e.openness ? { openness: e.openness, ...(e.standard ? { standard: e.standard } : {}) } : {}) });
      }
    }
  }

  // The open standards, through their own libraries and files.
  const standards = [];
  for (const s of STANDARD_LIBRARIES) {
    const keys = s.packages.map(packageKey);
    for (const d of deps) if (keys.includes(d.key)) standards.push({ standard: s.standard, category: s.category, kind: "package", value: d.name, file: d.file, line: d.line });
    for (const f of code) {
      const lang = langOf(f);
      const list = lang === "python" ? s.python : lang === "csharp" ? s.csharp : lang === "js" ? s.js : [];
      const im = imports(f).find((x) => { const root = moduleRoot(x.module, lang); return list.some((r) => root === r || x.module === r || x.module.startsWith(`${r}/`) || x.module.startsWith(`${r}.`)) && !local(root, f); });
      if (im) standards.push({ standard: s.standard, category: s.category, kind: "import", value: im.module, file: f, line: im.line });
    }
  }
  const skillFiles = agent.filter((f) => base(f) === "SKILL.md");
  for (const f of skillFiles.slice(0, PLACES)) standards.push({ standard: "Agent Skills", category: "packaging", kind: "file", value: "SKILL.md", file: f, line: 1, files: skillFiles.length });
  for (const f of agent.filter((x) => base(x) === "plugin.json")) {
    if (/"\$schema"\s*:\s*"https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\/plugin\.schema\.json"/.test(text(f) ?? "")) standards.push({ standard: "Agent Plugins 1.0.0", category: "packaging", kind: "file", value: "plugin.json", file: f, line: 1 });
  }
  return { uses, standards, present };
}

/** Where one evidence item is found: [{file, line}]. */
function matchEvidence(e, ctx) {
  const { p, cell, deps, agent, code, config, commandFiles, imports, linesIn, langOf, local, importsPlatform } = ctx;
  const lang = e.language ?? "any";
  const inLang = (f) => lang === "any" || (LANG_EXT[lang] ?? new Set()).has(ext(f));
  const out = [];
  const scan = (files, re, gate = () => true) => {
    for (const f of files) {
      if (!gate(f)) continue;
      const ls = linesIn(f) ?? [];
      for (let i = 0; i < ls.length; i += 1) if (ls[i].length <= 4000 && re.test(ls[i])) { out.push({ file: f, line: i + 1 }); break; }
    }
  };
  switch (e.kind) {
    case "package": {
      const name = e.value.replace(/\[.*$/, "");
      const want = extrasOf(/\[([^\]]*)\]/.exec(e.value)?.[1] ?? "");
      for (const d of deps) if (d.key === packageKey(name) && (lang === "any" || (ECO_OF_LANG[lang] ?? []).includes(d.eco)) && [...want].every((x) => d.extras.has(x))) out.push({ file: d.file, line: d.line });
      break;
    }
    case "import": {
      const ev = evidenceImport(e.value, lang);
      // The names the line gives, and the classes and functions the cell's
      // own words name beside them (InMemorySessionService beside
      // DatabaseSessionService), from the same module only.
      const said = namedIn(cell?.what);
      const wanted = [...new Set([...(ev.names.length > 1 ? ev.names.filter((n) => !EVERY_AGENT.has(n)) : ev.names), ...(ev.names.length ? said : [])])];
      for (const f of code) {
        const fl = langOf(f);
        if ((ev.lang === "python") !== (fl === "python") || (ev.lang === "js" && fl !== "js") || (ev.lang === "csharp" && fl !== "csharp") || (ev.lang === "go" && fl !== "go")) continue;
        const hit = imports(f).find((im) => {
          if (local(moduleRoot(im.module, fl), f)) return false;
          if (im.module === ev.module) return !wanted.length || im.star || im.names.some((n) => wanted.includes(n));
          return !ev.names.length && (im.module.startsWith(`${ev.module}.`) || im.module.startsWith(`${ev.module}/`));
        });
        if (hit) out.push({ file: f, line: hit.line, names: wanted.length ? hit.names.filter((n) => wanted.includes(n)) : [] });
      }
      break;
    }
    case "call": {
      const re = literalPattern(e.value);
      scan(code.filter(inLang), re, (f) => importsPlatform(p.id, f));
      break;
    }
    case "env": {
      const re = new RegExp(`(?<![A-Za-z0-9_])${esc(e.value)}(?![A-Za-z0-9_])`);
      scan([...code.filter(inLang), ...config], re);
      break;
    }
    case "file":
      out.push(...fileMatches(e.value, agent));
      break;
    case "config": {
      const named = /\b([\w.-]+\.(?:jsonc?|ya?ml|toml))\b/.exec(e.note ?? "")?.[1] ?? null;
      const cfg = named ? config.filter((f) => base(f) === named) : config;
      if (/^[A-Za-z_][\w-]*$/.test(e.value)) {
        const k = keyPatterns(e.value);
        scan(cfg, k.config);
        if (!named) scan(code.filter(inLang), k.code, (f) => importsPlatform(p.id, f));
      } else {
        const re = literalPattern(e.value);
        scan(cfg, re);
        if (!named) scan(code.filter(inLang), re, (f) => importsPlatform(p.id, f));
      }
      break;
    }
    case "cli": {
      const re = literalPattern(e.value);
      scan(commandFiles, re);
      break;
    }
    default:
      break;
  }
  const seen = new Set();
  return out.filter((x) => { const k = `${x.file}:${x.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── The reading ──

/** How open a feature is, the most tied first. */
export const LEVEL_ORDER = ["proprietary", "mixed", "open-source", "open-standard", "unknown", "not-applicable"];
/** How a destination's cell stands against what the agent uses, the worst first. */
export const RATING_ORDER = ["none", "partial", "unknown", "native", "standard"];
const KIND_WEIGHT = { import: 0, call: 0, package: 1, config: 2, env: 3, file: 4, cli: 5 };
/** Categories that are the runtime itself, a format or a protocol, never an
 *  outside service the agent reaches: they are not swapped one by one. */
export const NOT_A_SERVICE = ["deployment", "packaging", "tool-connections", "agent-to-agent"];
/** The categories that are about a plugin or skills at all (0.6.0): what they
 *  are packaged as and the MCP servers they connect to. The rest are about an
 *  agent that runs on its own. */
export const PLUGIN_CATEGORIES = ["packaging", "tool-connections"];

/** A cell's first sentence, the database's own words. */
export const firstSentence = (s) => { const t = trim(s); const m = /^(.+?[.!?])(?:\s+(?=[A-Z`(])|$)/.exec(t); return m ? m[1] : t; };
/** The sentence of a cell that names most of what the code shows, the first
 *  on a tie: OpenAI's deployment cell names ChatKit only in its second
 *  sentence, and that is the one for an agent that uses ChatKit. */
const COMMON_TOKENS = new Set(["from", "import", "true", "false", "with", "none", "client", "python", "typescript", "javascript"]);
export function leadSentence(what, values = [], vendor = []) {
  const sentences = trim(what).split(/(?<=[.!?])\s+(?=[A-Z`(])/).filter(Boolean);
  // The vendor's own name is in most of its sentences, so it tells none apart.
  const own = new Set(vendor.flatMap((v) => String(v ?? "").toLowerCase().split(/[^a-z0-9]+/)));
  const tokens = [...new Set(values.flatMap((v) => String(v).toLowerCase().split(/[^a-z0-9]+/)).filter((x) => x.length >= 4 && !COMMON_TOKENS.has(x) && !own.has(x)))];
  let best = 0; let score = 0;
  sentences.forEach((s, i) => {
    const words = new Set(s.toLowerCase().replace(/`/g, "").split(/[^a-z0-9]+/));
    // 0.6.3: a longer name tells more (chatkit over beta, in chatkit_beta).
    const n = tokens.filter((x) => words.has(x)).reduce((sum, x) => sum + x.length, 0);
    if (n > score) { score = n; best = i; }
  });
  return sentences[best] ?? trim(what);
}

/** A count in words a person reads. */
const filesWord = (n) => (n === 1 ? "one file" : `${n.toLocaleString("en-US")} files`);

/**
 * The reading: {database, built_on, uses, not_used, not_applicable, harnesses}.
 * `found` is platformUses's answer, each place carrying the fact id it was
 * kept as (`fact`); `ownCode` the own-code fact's data, `languages` the
 * language facts' data; `subject` a plugin's or skills' subject (absent for
 * an agent) and `pluginParts` its hooks, commands and sub-agents, as facts.
 */
export function readingOf({ found, db, frameworks = [], ownCode = null, languages = [], subject = null, pluginParts = {}, schedules = false }) {
  const byId = new Map(db.platforms.map((p) => [p.id, p]));
  const title = (key) => db.categories.find((c) => c.key === key)?.title ?? key;
  // The agent's language: that of the files that import the platform it is
  // built on, else the language most of its files are in.
  const langOfFile = (f) => (PY.has(ext(f)) ? "Python" : [".ts", ".tsx", ".mts", ".cts"].includes(ext(f)) ? "TypeScript" : JS.has(ext(f)) ? "JavaScript" : ext(f) === ".cs" ? "C#" : ext(f) === ".go" ? "Go" : ext(f) === ".java" ? "Java" : null);
  const anchored = [...found.present.values()].flat().filter((x) => x.how === "import").map((x) => langOfFile(x.file)).filter(Boolean);
  const most = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mainLanguage = most(anchored) ?? languages.filter((l) => ["Python", "TypeScript", "JavaScript", "C#", "Go", "Java"].includes(l.language))[0]?.language ?? null;
  const family = (l) => { const t = String(l ?? "").toLowerCase(); return t === "typescript" || t === "javascript" ? "javascript" : t === "c#" ? "csharp" : t; };

  // Built on: the platforms the code shows, the one with the most categories first.
  const catsOf = (id) => new Set(found.uses.filter((u) => u.platform === id).map((u) => u.category));
  const builtOn = [...found.present.keys()].map((id) => ({ id, cats: catsOf(id).size, framework: found.present.get(id).some((x) => x.how === "framework" || x.how === "package") }))
    .sort((a, b) => Number(b.framework) - Number(a.framework) || b.cats - a.cats || a.id.localeCompare(b.id));
  const names = [...new Set(frameworks.map((f) => f.framework).filter(Boolean))];
  const primary = builtOn[0]?.id ?? null;

  // How tied, one row per category used.
  const rows = [];
  for (const key of CATEGORY_KEYS) {
    if (subject && !PLUGIN_CATEGORIES.includes(key)) continue;
    const sources = [];
    for (const b of builtOn) {
      const places = found.uses.filter((u) => u.platform === b.id && u.category === key).sort((x, y) => (KIND_WEIGHT[x.kind] ?? 9) - (KIND_WEIGHT[y.kind] ?? 9));
      if (!places.length) continue;
      const cell = byId.get(b.id).categories[key];
      const codeFiles = new Set(places.filter((u) => u.kind === "import" || u.kind === "call" || (u.kind === "config" && ALL_CODE.has(ext(u.file)))).map((u) => u.file));
      // 0.7.0 (debt 939): each place is as open as the part of the cell its
      // evidence shows; the use is as open as its least open place, so
      // design-agent's create_deep_agent skills read open, langgraph.json not.
      const placeLevels = places.map((u) => u.openness ?? cell.portability.level);
      const own = places.every((u) => u.openness);
      const level = own ? placeLevels.sort((a, z) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(z))[0] : cell.portability.level;
      const standards = own && level === "open-standard" ? [...new Set(places.map((u) => u.standard).filter(Boolean))] : cell.portability.standards ?? [];
      sources.push({
        platform: b.id, vendor: byId.get(b.id).vendor, name: byId.get(b.id).name, rating: cell.rating, level, standards, ...(own ? { by_evidence: true } : {}),
        what: trim(cell.what), lead: leadSentence(cell.what, places.map((u) => u.value), [b.id, byId.get(b.id).vendor]), note: cell.portability.note,
        reach: { code_files: codeFiles.size, settings_only: codeFiles.size === 0 && places.every((u) => ["env", "config", "file", "cli", "package"].includes(u.kind)) },
        // Every place an import of a class kept in the agent's own memory
        // (ADK's InMemorySessionService, LangGraph's InMemorySaver): it
        // reaches no service, whatever else the cell's rating covers.
        in_process: places.every((u) => u.kind === "import" && (u.names ?? []).length > 0 && u.names.every((n) => /^InMemory[A-Z]/.test(n))),
        evidence: places.map((u) => ({ file: u.file, line: u.line, kind: u.kind, value: u.value, ...(u.fact ? { fact: u.fact } : {}) })),
      });
    }
    const std = found.standards.filter((s) => s.category === key);
    // 0.6.0: a plugin's MCP servers are the open standard, whichever tool connects to them.
    if (subject && key === "tool-connections" && (pluginParts.mcp ?? []).length && !std.some((s) => s.standard === "MCP")) {
      const mcp = pluginParts.mcp;
      sources.push({ platform: null, standard: "MCP", rating: "standard", level: "open-standard", standards: ["MCP"], what: "MCP servers, which any tool that speaks the Model Context Protocol can connect to.", reach: { code_files: 0, settings_only: false }, evidence: mcp.slice(0, PLACES).map((f) => ({ file: f.file, line: f.line, kind: "file", value: f.kind, ...(f.id ? { fact: f.id } : {}) })) });
    }
    for (const name of [...new Set(std.map((s) => s.standard))]) {
      const places = std.filter((s) => s.standard === name);
      sources.push({ platform: null, standard: name, rating: "standard", level: "open-standard", standards: [name], what: STANDARD_WHAT[name], reach: { code_files: new Set(places.filter((x) => x.kind === "import").map((x) => x.file)).size, settings_only: false }, evidence: places.map((u) => ({ file: u.file, line: u.line, kind: u.kind, value: u.value, ...(u.fact ? { fact: u.fact } : {}) })) });
    }
    if (!sources.length) continue;
    const level = sources.map((s) => s.level).sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))[0];
    const tied = sources.find((s) => s.level === level);
    // An outside dependency: a vendor's own or partly open feature, which
    // moves only by being swapped. The runtime itself is said under Moving it.
    // 0.6.3: not when all it uses of the tied cell is kept in its own memory.
    const inProcess = sources.filter((s) => s.level === level).every((s) => s.in_process);
    const outside = (level === "proprietary" || level === "mixed") && !NOT_A_SERVICE.includes(key) && !inProcess;
    const reach = tied.reach;
    const swap = level === "open-standard" ? "standard" : level === "open-source" ? "library" : key === "deployment" ? "runtime" : inProcess ? "in-process" : reach.settings_only ? "settings" : reach.code_files <= 1 ? "one-file" : "files";
    rows.push({ category: key, title: title(key), level, outside, swap, code_files: reach.code_files, sources, needs: null, choices: null });
  }
  // A plugin's own parts that are its tool's format, not a standard.
  if (subject) {
    const toolsOfPlugin = subject.tools?.length ? subject.tools : [];
    // 0.6.3: its manifests too, each in its own tool's format, unless it is
    // an Agent Plugins 1.0.0 manifest (the open standard, said under Packaging).
    for (const [key, words] of [["manifests", "Plugin manifests"], ["hooks", "Hooks"], ["commands", "Commands and sub-agents"]]) {
      const parts = pluginParts[key] ?? [];
      if (!parts.length) continue;
      const tools = key === "manifests" ? [...new Set(parts.map((f) => f.data?.tool).filter(Boolean))] : toolsOfPlugin;
      rows.push({ category: key, title: words, level: "proprietary", outside: false, swap: "tool", code_files: 0, plugin_part: true, sources: [{ platform: null, tools, rating: "native", level: "proprietary", standards: [], what: tools.length > 1 ? `${and(tools)} each read their own format.` : `${tools[0] ?? "Its tool"} reads its own format.`, reach: { code_files: 0, settings_only: false }, evidence: parts.slice(0, PLACES).map((f) => ({ file: f.file, line: f.line, kind: "file", value: f.kind, ...(f.id ? { fact: f.id } : {}) })) }], needs: null, choices: null });
    }
  }
  const used = new Set(rows.filter((r) => !r.plugin_part).map((r) => r.category));
  const notApplicable = subject ? CATEGORY_KEYS.filter((k) => !PLUGIN_CATEGORIES.includes(k)) : [];
  const notUsed = CATEGORY_KEYS.filter((k) => !used.has(k) && !notApplicable.includes(k));

  // 0.7.0: Run it in, one reading per harness of the catalogue; the
  // organization's preferred harnesses pick which are shown (the host says
  // which, the view filters). AgentMesh is not a harness.
  const harnesses = harnessReadings({ db, rows, builtOn, primary, subject, pluginParts, ownCode, mainLanguage, found, schedules, byId });
  return {
    database: { repository: db.pinned.repository, path: db.pinned.path, commit: db.pinned.commit, checked: db.checked, platforms: db.platforms.length, harnesses: (db.harnesses ?? []).length },
    built_on: {
      platforms: builtOn.map((b) => ({ platform: b.id, name: byId.get(b.id).name, vendor: byId.get(b.id).vendor, categories: b.cats, evidence: found.present.get(b.id).map((x) => ({ file: x.file, line: x.line, kind: x.how, value: x.value, ...(x.fact ? { fact: x.fact } : {}) })) })),
      frameworks: names, language: mainLanguage,
      ...(subject ? { tools: subject.tools ?? [], also_for: subject.also_for ?? [], kind: subject.kind } : {}),
    },
    uses: rows, not_used: notUsed, not_applicable: notApplicable, harnesses,
  };
}

/** The seven things a harness may run, in the catalogue's order and words. */
export const CAPABILITIES = [
  ["skills", "Skills"], ["mcp", "Tool servers (MCP)"], ["plugins", "Plugins"], ["hooks", "Hooks"],
  ["a2a", "Agent-to-agent (A2A)"], ["scheduled-work", "Scheduled work"], ["sandboxes", "Sandboxes"],
];
const STATE_OF = { yes: "kept", partial: "partly", no: "lost", unknown: "unknown" };

/**
 * One reading per harness: {harness, name, vendor, kind, house_stack, takes,
 * lines: [{capability, title, state, says}]}. A line is said for each of the
 * seven capabilities the subject uses: kept (the harness supports it), partly,
 * lost (its documentation says it does not), unknown (not found), or gained
 * (the subject gets it today from its vendor's own service, and the harness
 * provides it itself). `takes` says what running it there takes, by rule.
 */
export function harnessReadings({ db, rows, builtOn = [], primary = null, subject = null, pluginParts = {}, ownCode = null, mainLanguage = null, found = { standards: [] }, schedules = false, byId = new Map() }) {
  const row = (cat) => rows.find((r) => r.category === cat && !r.plugin_part);
  const skillsUsed = found.standards.some((x) => x.standard === "Agent Skills") || (subject?.skills ?? 0) > 0;
  const pluginsUsed = subject?.kind === "plugin" || found.standards.some((x) => x.standard === "Agent Plugins 1.0.0");
  const used = {
    skills: skillsUsed,
    mcp: !!row("tool-connections") || (pluginParts.mcp ?? []).length > 0,
    plugins: pluginsUsed,
    hooks: (pluginParts.hooks ?? []).length > 0,
    a2a: !!row("agent-to-agent"),
    "scheduled-work": !!schedules,
    sandboxes: !!row("sandboxes"),
  };
  const vendorOf = (r) => r?.sources?.find((x) => x.platform)?.vendor ?? null;
  const ownFiles = ownCode?.files ?? 0;
  const fileWords = (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "file" : "files"}`;
  const tools = subject?.tools ?? [];
  const family = (l) => { const t = String(l ?? "").toLowerCase(); return t === "typescript" || t === "javascript" ? "javascript" : t === "c#" ? "csharp" : t; };
  const out = [];
  for (const h of db.harnesses ?? []) {
    const sup = (cap) => h.supports?.[cap]?.support ?? "unknown";
    const lines = [];
    for (const [cap, title] of CAPABILITIES) {
      if (!used[cap]) continue;
      let state = STATE_OF[sup(cap)] ?? "unknown";
      const what = firstSentence(h.supports?.[cap]?.what ?? "");
      let says = what;
      // Gained: today from its vendor's own service, there from the harness itself.
      const r = cap === "sandboxes" ? row("sandboxes") : null;
      if (r && r.outside && sup(cap) === "yes" && !(h.platform && r.sources.some((x) => x.platform === h.platform))) {
        state = "gained";
        says = `${h.name} provides it, in place of ${vendorOf(r) ?? "its vendor"}'s service. ${what}`.trim();
      }
      lines.push({ capability: cap, title, state, says });
    }
    // What running it there takes, by rule.
    let takes;
    if (subject?.kind === "plugin") {
      const fits = (h.plugin_formats ?? []).filter((f) => tools.includes(f));
      const open = (h.plugin_formats ?? []).includes("Agent Plugins 1.0.0") && found.standards.some((x) => x.standard === "Agent Plugins 1.0.0");
      if (fits.length || open) takes = `Installs as it is, as ${open ? "an Agent Plugins 1.0.0 plugin" : `a ${fits[0]} plugin`}`;
      else if (sup("skills") === "yes") takes = `Its skills load as they are; its ${tools.length ? and(tools) : "own"} manifest does not install there`;
      else takes = sup("skills") === "unknown" ? "Not known whether its skills load there" : "Its skills do not load there";
    } else if (subject) {
      takes = sup("skills") === "yes" ? "Its skills load as they are" : sup("skills") === "partial" ? "Its skills load there in part" : sup("skills") === "no" ? "Its skills do not load there" : "Not known whether its skills load there";
    } else if (h.kind === "cloud-runtime") {
      const plat = h.platform ? byId.get(h.platform) : null;
      const langs = new Set((plat?.products ?? []).flatMap((x) => x.languages ?? []).map(family));
      if (h.platform && h.platform === primary) takes = `Built for it: its code runs there as written${ownFiles ? ` (${fileWords(ownFiles)})` : ""}`;
      else if (!ownFiles) takes = "Re-hosting it as a service there";
      else if (mainLanguage && langs.size && !langs.has(family(mainLanguage))) takes = `Re-hosting its own code, ${fileWords(ownFiles)} of ${mainLanguage}, in a language ${h.name} does not list`;
      else takes = `Re-hosting its own code there: ${fileWords(ownFiles)}${mainLanguage ? ` of ${mainLanguage}` : ""}`;
    } else {
      // A harness or an assistant runs skills and tool servers, not an agent's own program.
      const mcp = sup("mcp");
      const code = ownFiles ? `its own code (${fileWords(ownFiles)}) ` : "its own code ";
      if (!ownFiles && skillsUsed) takes = "Its skills load as they are";
      else if (mcp === "yes" || mcp === "partial") takes = `Running ${code}as a tool server ${h.name} connects to${skillsUsed && sup("skills") === "yes" ? ", with its skills loaded as they are" : ""}`;
      else takes = mcp === "no" ? `${code.charAt(0).toUpperCase()}${code.slice(1)}has no way in: ${h.name} runs no tool servers` : `Not known how ${code}would run there`;
    }
    out.push({ harness: h.id, name: h.name, vendor: h.vendor, kind: h.kind, ...(h.house_stack ? { house_stack: true } : {}), ...(h.platform ? { platform: h.platform } : {}), checked: h.checked ?? null, takes, lines });
  }
  return out;
}

/** What each open standard is, for a row that uses it through its own library. */
export const STANDARD_WHAT = {
  MCP: "The Model Context Protocol's own library, which any MCP client or server speaks.",
  A2A: "The Agent2Agent protocol's own library, which any A2A agent speaks.",
  OpenTelemetry: "OpenTelemetry's own library, which sends traces to any OpenTelemetry backend.",
  "Agent Skills": "Skills in the Agent Skills format, folders with a SKILL.md that any tool reading Agent Skills loads.",
  "Agent Plugins 1.0.0": "A plugin manifest that names the Agent Plugins 1.0.0 schema.",
};

/** The work to move a row, in a few words, from the rule above. */
export function swapWords(row) {
  switch (row.swap) {
    case "standard": return "Moves as it is: an open standard";
    case "library": return "Comes with its code: open source";
    case "runtime": return "Its runtime: see each destination";
    case "in-process": return "Comes with its code: kept in its own memory, no service";
    case "settings": return "Light: settings only";
    case "one-file": return "Light: its code is in one file";
    case "tool": return "Its tool's own format";
    default: return `${row.code_files >= 5 ? "Heavier" : "Moderate"}: its code is in ${filesWord(row.code_files)}`;
  }
}
