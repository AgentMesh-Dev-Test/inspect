// What the agent needs that a setting alone cannot say (0.7.2): a system the
// code checks for by probing (a program on the PATH, a daemon that answers),
// and a stop that names alternatives ("No sandbox is available. Install
// Docker and build the image, or set LANGSMITH_API_KEY and
// DESIGN_AGENT_SANDBOX_SNAPSHOT for LangSmith Sandboxes."), which makes one
// of those alternatives required. Facts by rule, from the code alone, the same
// way for every repository: no repository's name decides anything here.
//
//   needs: node >= 22. Nothing here reads the network or writes a file.
//   import { probeFacts, oneOfFacts, onStartPath, groupFindings, applyGroups } from "./needs.mjs"
import { posix } from "node:path";

const trim = (s) => String(s ?? "").trim();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The words that stop a program, in the languages Inspect reads. */
export const STOPS = /\b(?:raise|throw|sys\.exit|process\.exit|SystemExit|panic!|log\.Fatal(?:f|ln)?|os\.Exit)\b|(?:^|[;&|]|\bthen|\belse)\s*exit\s+[1-9]/;
/** The verbs a stop's remedy starts with. */
const REMEDY = "install|set|run|start|use|provide|configure|export|build|choose|add|enable|pass|give|connect|create|define|point";

// ── A system the code probes for ──
/** A program's name as a person writes it. */
const PROGRAMS = { docker: "Docker", podman: "Podman", git: "Git", gh: "GitHub's command-line tool", node: "Node.js", npm: "npm", npx: "npm", deno: "Deno", bun: "Bun", python: "Python", python3: "Python", ffmpeg: "FFmpeg", ffprobe: "FFmpeg", kubectl: "Kubernetes (kubectl)", chrome: "Chrome", chromium: "Chromium", uv: "uv", java: "Java", go: "Go", cargo: "Rust (cargo)", redis: "Redis", "redis-server": "Redis", psql: "PostgreSQL", ollama: "Ollama", playwright: "Playwright" };
export const programName = (bin) => PROGRAMS[String(bin).toLowerCase()] ?? String(bin);

/** The lines a condition at index i governs: its own line after the colon or
 *  brace, and the lines indented under it (at most five). */
function governed(lines, i) {
  const cond = String(lines[i] ?? "");
  const indent = (s) => /^\s*/.exec(s)[0].length;
  const out = [cond.replace(/^.*?(?::|\)|\{)\s*(?=\S|$)/, "")];
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
    const l = String(lines[j] ?? "");
    if (!l.trim()) continue;
    if (indent(l) <= indent(cond)) break;
    out.push(l);
  }
  return out.join("\n");
}
/** Whether the program stops at line i when what it probes is missing: a
 *  stop on the line, or a condition on the line or the next whose body stops. */
function stopsAt(lines, i) {
  const line = String(lines[i] ?? "");
  if (STOPS.test(line)) return true;
  const isCond = (s) => /^\s*(?:if|elif|unless)\b|\bif\s*\(|\bif\s+not\b|^\s*if\b/.test(String(s ?? ""));
  if (isCond(line)) return STOPS.test(governed(lines, i));
  if (isCond(lines[i + 1])) return STOPS.test(governed(lines, i + 1));
  return false;
}

/**
 * Each place the code checks a system is there that it reads no setting
 * for: [{file, line, data: {system, program, how, stops}}].
 *   - "on-path": it looks a program up on the PATH (shutil.which("docker"),
 *     exec.LookPath, `command -v docker`, `which docker`);
 *   - "answers": it asks a daemon whether it answers (docker.from_env(),
 *     `docker version` or `docker info` started as a program);
 *   - "said": a stop whose words say a program is not installed, not on the
 *     PATH or not running ("Docker is not installed or not on PATH").
 * stops: the program stops there when the system is missing.
 */
export function probeFacts(files, read) {
  const out = [];
  const seen = new Set();
  const push = (file, line, program, how, stops, system) => {
    const name = system ?? programName(program);
    const k = `${file}:${line}:${name}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ file, line, data: { system: name, ...(program ? { program: String(program).toLowerCase() } : {}), how, stops } });
  };
  for (const file of files) {
    const text = read(file);
    if (typeof text !== "string" || text.length > 2_000_000) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.length > 600) return;
      for (const m of line.matchAll(/\b(?:shutil\.which|which|lookpath|exec\.LookPath|commandExists|command_exists|find_executable)\(\s*["'`]([\w.+-]{2,30})["'`]/gi)) push(file, i + 1, m[1], "on-path", stopsAt(lines, i));
      // A shell's lookup only where a command starts, never "which" in a
      // sentence; in other code, only a string that is that command.
      const shell = /\.(sh|bash|zsh)$/.test(file) || posix.basename(file) === "Makefile";
      const code = shell ? line.replace(/(^|\s)#.*$/, "") : line;
      const at = shell ? /(?:^|[;&|(]|\$\(|\bif\s+!?|\bthen\s+|\bdo\s+)\s*(?:command\s+-v|which|type\s+-p|hash)\s+([a-z][\w.+-]{1,30})\b/g : /["'`]\s*(?:command\s+-v|which)\s+([a-z][\w.+-]{1,30})\s*["'`]|["'`](?:which|where)["'`]\s*,\s*["'`]([\w.+-]{2,30})["'`]/g;
      for (const m of code.matchAll(at)) push(file, i + 1, m[1] ?? m[2], "on-path", stopsAt(lines, i));
      if (/\bdocker\.from_env\(|\bnew\s+Docker\s*\(|\bDockerClient\s*\(/.test(line)) push(file, i + 1, "docker", "answers", stopsAt(lines, i));
      for (const m of line.matchAll(/["'`](docker|podman)["'`]\s*,\s*["'`](version|info|ps)["'`]|["'`](docker|podman)\s+(version|info|ps)\b/g)) push(file, i + 1, m[1] ?? m[3], "answers", stopsAt(lines, i));
      if (STOPS.test(line) || /^\s*f?["'`]/.test(line)) {
        const m = /\b([A-Z][\w.+-]{1,30}|[a-z][\w+-]{1,20})(?:'s [\w`-]+ CLI)? (?:is not installed|is not on (?:the )?PATH|was not found on (?:the )?PATH|is not running|isn't installed|isn't running|could not be found on (?:the )?PATH)/.exec(line);
        if (m && (STOPS.test(line) || STOPS.test(String(lines[i - 1] ?? "")) || STOPS.test(String(lines[i - 2] ?? "")))) {
          const word = m[1];
          const program = PROGRAMS[word.toLowerCase()] ? word.toLowerCase() : null;
          push(file, i + 1, program, "said", true, program ? programName(program) : word);
        }
      }
    });
  }
  return out;
}

// ── A stop that names alternatives ──
/** The text of the stop that starts at line i: its own line and the lines
 *  until its brackets close (at most twelve), and the words of its string
 *  literals joined, with each interpolation said as "…". */
export function stopMessage(lines, i) {
  let depth = 0; const parts = [];
  for (let j = i; j < Math.min(lines.length, i + 12); j += 1) {
    const l = String(lines[j] ?? "");
    parts.push(l);
    for (const ch of l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) { if ("([{".includes(ch)) depth += 1; else if (")]}".includes(ch)) depth -= 1; }
    if (depth <= 0 && j >= i) break;
  }
  const words = [];
  for (const l of parts) for (const m of l.matchAll(/(?:\b[fFrRbB]{1,2})?(["'`])((?:\\.|(?!\1).)*)\1/g)) words.push(m[2]);
  return words.join("").replace(/\$\{[^}]*\}|\{[^{}]*\}/g, "…").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}
/** A setting's name, as the code writes it, in a message. */
const SETTING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const NOT_NAMES = new Set(["Install", "Set", "Run", "Start", "Use", "Provide", "Configure", "Export", "Build", "Choose", "Add", "Enable", "Pass", "Give", "Connect", "Create", "Define", "Point", "Either", "Or", "And", "The", "A", "An", "No", "Please", "Then", "To", "Its", "Your"]);
/** The system an alternative names: a capitalized name after for, use, with,
 *  via or on, else the first capitalized name that is no verb. */
function nameIn(words) {
  const w = words.replace(SETTING, " ").replace(/\s+/g, " ").trim();
  const after = /\b(?:[Ff]or|[Uu]se|[Uu]sing|[Ww]ith|[Vv]ia|[Oo]n|[Ii]nstall|[Ss]tart|[Rr]un)\s+(?:the\s+|a\s+|an\s+)?((?:[A-Z][\w.+-]*)(?:\s+[A-Z][\w.+-]*)*)/.exec(w);
  const cand = after && /^[A-Z]/.test(after[1]) ? after[1] : null;
  if (cand && !NOT_NAMES.has(cand.split(" ")[0])) return cand;
  for (const m of w.matchAll(/\b([A-Z][\w.+-]*(?:\s+[A-Z][\w.+-]*)*)/g)) {
    const first = m[1].split(" ")[0];
    if (NOT_NAMES.has(first)) { const rest = m[1].split(" ").slice(1).join(" "); if (rest) return rest; continue; }
    return m[1];
  }
  return null;
}
/**
 * The alternatives a stop's message names, when it names two or more, each a
 * system or a setting: {needs, options: [{name, settings, words}]} or null.
 * needs is what is missing in the message's own words ("sandbox" from "No
 * sandbox is available"), or null.
 */
export function alternativesIn(message) {
  const msg = trim(message);
  if (!/\bor\b/i.test(msg)) return null;
  const needs = /\bno ([a-z][a-z0-9 -]{1,30}?) (?:is |are |was |were |could be |can be )?(?:available|configured|found|set up|set|installed|running|reachable)\b/i.exec(msg)?.[1]
    ?? /\b(?:requires?|needs?) (?:either |one of )?(?:a |an )([a-z][a-z -]{1,30}?)(?:[:.,;]| to\b)/i.exec(msg)?.[1] ?? null;
  const verb = new RegExp(`^(?:either\\s+)?(?:${REMEDY})\\b`, "i");
  const sentences = msg.split(/(?<=[.!?:;])\s+/).map(trim).filter(Boolean);
  for (const s of sentences) {
    if (!verb.test(s) || !/\bor\b/i.test(s)) continue;
    const body = s.replace(/^either\s+/i, "").replace(/[.!?;:]+$/, "");
    let parts = body.split(new RegExp(`,?\\s+or\\s+(?=(?:${REMEDY})\\b)`, "i"));
    if (parts.length < 2) parts = body.split(/,?\s+or\s+/i);
    if (parts.length < 2) continue;
    const options = parts.map((p) => {
      const words = trim(p);
      const settings = [...new Set(words.match(SETTING) ?? [])];
      return { name: nameIn(words), settings, words };
    });
    if (options.every((o) => o.name || o.settings.length)) return { needs: needs ? needs.toLowerCase() : null, options };
  }
  return null;
}
/** The function the line at index i is in: its name, or null at the top level. */
export function enclosingFunction(lines, i) {
  const at = /^(\s*)/.exec(String(lines[i] ?? ""))[1].length;
  for (let j = i; j >= 0; j -= 1) {
    const l = String(lines[j] ?? "");
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)|^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|^(\s*)(?:pub\s+)?fn\s+(\w+)|^(\s*)func\s+(?:\([^)]*\)\s*)?(\w+)/.exec(l);
    if (!m) continue;
    const ind = (m[1] ?? m[3] ?? m[5] ?? m[7] ?? m[9] ?? "").length;
    const name = m[2] ?? m[4] ?? m[6] ?? m[8] ?? m[10];
    if (ind < at || j === i) return name;
  }
  return null;
}
/**
 * Each stop in the agent's own code (`own(file)`) whose message names two or
 * more alternatives: [{file, line, data: {needs, options, message, function}}].
 */
export function oneOfFacts(files, read, own) {
  const out = [];
  for (const file of files.filter(own)) {
    const text = read(file);
    if (typeof text !== "string" || text.length > 2_000_000) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!STOPS.test(line) || line.length > 600) return;
      const message = stopMessage(lines, i);
      const alt = alternativesIn(message);
      if (!alt) return;
      out.push({ file, line: i + 1, data: { ...alt, message: message.slice(0, 400), function: enclosingFunction(lines, i) } }); // cut-ok: the message is kept whole in its file; the fact keeps enough to say it
    });
  }
  return out;
}

// ── On the path the agent's commands share ──
/**
 * The files the agent starts from: its entry facts' code files, what a
 * pyproject.toml script or a package.json bin or main names, a file that runs
 * itself (`if __name__ == "__main__"`), and a LangGraph server's graphs.
 */
export function entryFiles({ files, read, facts }) {
  const set = new Set(files);
  const out = new Set();
  const code = /\.(py|mjs|cjs|js|ts|mts|go|rs|rb)$/;
  const byModule = (mod) => {
    const p = mod.replace(/\./g, "/");
    return files.find((f) => f.endsWith(`${p}.py`) || f.endsWith(`${p}/__init__.py`) || f.endsWith(`${p}/__main__.py`));
  };
  for (const f of facts.filter((x) => x.kind === "entry")) {
    if (f.file && code.test(f.file)) out.add(f.file);
    const m = /=\s*["']([\w.]+)(?::\w+)?["']/.exec(String(f.text ?? ""));
    if (m) { const hit = byModule(m[1]); if (hit) out.add(hit); }
  }
  for (const f of files) {
    const b = posix.basename(f);
    const dir = posix.dirname(f) === "." ? "" : `${posix.dirname(f)}/`;
    if (b === "package.json" && !/(^|\/)node_modules\//.test(f)) {
      try {
        const j = JSON.parse(read(f) ?? "{}");
        for (const p of [j.main, ...(typeof j.bin === "string" ? [j.bin] : Object.values(j.bin ?? {}))]) { const at = posix.normalize(`${dir}${String(p ?? "")}`); if (p && set.has(at)) out.add(at); }
      } catch { /* not JSON: no entry from it */ }
    }
    if (b === "langgraph.json") {
      try {
        const j = JSON.parse(read(f) ?? "{}");
        for (const g of Object.values(j.graphs ?? {})) { const at = posix.normalize(`${dir}${String(g ?? "").split(":")[0]}`); if (set.has(at)) out.add(at); }
      } catch { /* not JSON */ }
    }
    if (/\.py$/.test(f)) { const t = read(f); if (typeof t === "string" && /^if __name__ == ["']__main__["']\s*:/m.test(t)) out.add(f); }
  }
  return out;
}
/**
 * Whether the code at `file` in `fn` is on the path the agent's commands
 * share: the function is called from an entry file and from at least one
 * other file of its own code, so it is not one command's own step. A stop at
 * the top level of an entry file is on it too.
 */
export function onStartPath({ file, fn }, { ownFiles, read, entries }) {
  if (!fn) return entries.has(file);
  const re = new RegExp(`\\b${esc(fn)}\\b`);
  // A caller imports the module the function is in (its file's name, or its
  // folder's for __init__ and index files) and names the function: a word
  // two files share is not a call.
  const base = posix.basename(file).replace(/\.[^.]+$/, "");
  const stem = /^(?:__init__|index|mod)$/.test(base) ? posix.basename(posix.dirname(file)) : base;
  const imports = new RegExp(`^\\s*(?:from\\s+[\\w.]*\\b${esc(stem)}\\b[\\w.]*\\s+import\\b|import\\s+[\\w.]*\\b${esc(stem)}\\b)|\\bfrom\\s+["'][^"']*\\b${esc(stem)}(?:\\.[cm]?[jt]s)?["']|\\brequire\\(\\s*["'][^"']*\\b${esc(stem)}(?:\\.[cm]?[jt]s)?["']|^\\s*use\\s+[\\w:]*\\b${esc(stem)}\\b`, "m");
  const callers = ownFiles.filter((f) => { if (f === file) return false; const t = read(f) ?? ""; return re.test(t) && imports.test(t); });
  if (callers.length < 2 && !(callers.length === 1 && entries.has(callers[0]) && entries.has(file))) return false;
  if (callers.some((f) => entries.has(f))) return true;
  // One step further: a caller's own function called from an entry file.
  for (const f of callers) {
    const lines = String(read(f) ?? "").split(/\r?\n/);
    const i = lines.findIndex((l) => re.test(l) && !/^\s*(?:from|import)\b/.test(l));
    const g = i >= 0 ? enclosingFunction(lines, i) : null;
    if (g && g !== fn && [...entries].some((e) => new RegExp(`\\b${esc(g)}\\b`).test(read(e) ?? ""))) return true;
  }
  return false;
}

// ── The groups, as the report says them ──
const and = (xs, word = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`);
const cap = (s) => { const t = trim(s); return t ? `${t[0].toUpperCase()}${t.slice(1)}` : ""; };
/** A setting in words: LANGSMITH_API_KEY "LangSmith key" when the option
 *  names LangSmith, DESIGN_AGENT_SANDBOX_SNAPSHOT "sandbox snapshot" for the
 *  repository design-agent. */
export function settingWords(env, { optionName = "", repoName = "" } = {}) {
  const repo = new Set(String(repoName).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let toks = String(env).toLowerCase().split("_").filter(Boolean);
  while (toks.length > 1 && repo.has(toks[0])) toks = toks.slice(1);
  const secret = /^(key|token|secret|password)$/.test(toks.at(-1) ?? "");
  if (secret) toks = [...toks.slice(0, -1).filter((t) => t !== "api"), toks.at(-1)];
  // The option's own words keep their capitals ("Acme Cloud key" for
  // ACME_CLOUD_KEY beside "Acme Cloud Sandboxes"), as far as they match.
  const named = String(optionName).split(/\s+/).filter(Boolean);
  let same = true;
  return toks.map((t, i) => { same = same && named[i]?.toLowerCase() === t; return same ? named[i] : t; }).join(" ");
}
/** What a person supplies for one alternative, in words. */
export function supplyOf(option, repoName) {
  if (option.settings.length) {
    const ws = option.settings.map((s) => settingWords(s, { optionName: option.name ?? "", repoName }));
    return `Your ${and(ws)}`;
  }
  return cap(option.words.replace(/[.;:]+$/, ""));
}
/** The names a system finding gives the settings it reads. */
function settingsOf(f, byId) {
  const d = f.detail ?? {};
  return new Set([
    ...(Array.isArray(d.credentials) ? d.credentials : []),
    ...(Array.isArray(d.need_settings) ? d.need_settings.map((s) => s?.name) : []),
    ...(f.based_on ?? []).map((id) => byId.get(id)).filter((x) => x?.kind === "setting").map((x) => x.data?.name),
  ].filter(Boolean));
}
const firstWord = (s) => String(s ?? "").toLowerCase().split(/\s+/)[0] ?? "";

/**
 * The group findings (section 5, kind system, by script): one for each stop
 * on the path the agent's commands share whose message names alternatives,
 * so one of them is required. Its detail: need required by rule, one_of
 * [{name, supply, settings}], and supply, every alternative in words.
 */
// ── The model provider, by rule ──
/** The makers a model's name in the code points to: by its provider prefix
 *  ("anthropic:claude-opus-5-5", "google_genai:…") or its family ("gpt-",
 *  "claude-", "gemini-"). Each with the words a system's name may use for it. */
const MAKERS = [
  { name: "Anthropic", aliases: ["anthropic", "claude"], re: /^(?:anthropic[:/]|claude)/i },
  { name: "OpenAI", aliases: ["openai", "gpt"], re: /^(?:openai[:/]|azure_openai[:/]|gpt-|o[1-9]\b|chatgpt)/i },
  { name: "Google", aliases: ["google", "gemini", "vertex"], re: /^(?:google(?:_genai|_vertexai)?[:/]|vertexai[:/]|gemini)/i },
  { name: "Mistral", aliases: ["mistral"], re: /^(?:mistral(?:ai)?[:/]|mistral-|codestral)/i },
  { name: "Amazon Bedrock", aliases: ["bedrock"], re: /^bedrock[:/]/i },
  { name: "Groq", aliases: ["groq"], re: /^groq[:/]/i },
  { name: "Ollama", aliases: ["ollama"], re: /^ollama[:/]/i },
  { name: "Cohere", aliases: ["cohere"], re: /^(?:cohere[:/]|command-r)/i },
  { name: "xAI", aliases: ["xai", "grok"], re: /^(?:xai[:/]|grok-)/i },
  { name: "DeepSeek", aliases: ["deepseek"], re: /^deepseek/i },
];
/**
 * The model provider an agent needs (0.7.2): when its own code (outside its
 * skills and tests) calls a model, it needs a provider, and the providers
 * are those its own code names models of. Two or more are one group, Required
 * by rule; one is required by rule on its own: {group} or {single: maker} or null.
 */
export function modelProvider(facts) {
  const folders = facts.filter((f) => f.kind === "skill").map((f) => String(f.data?.folder ?? "")).filter(Boolean);
  const own = (f) => f.file && !folders.some((d) => f.file.startsWith(`${d}/`)) && !/(^|\/)(tests?|__tests__|spec|examples?|samples?)\//i.test(f.file);
  if (!facts.some((f) => f.kind === "model-client" && own(f))) return null;
  const named = [];
  for (const f of facts.filter((x) => x.kind === "model" && own(x))) {
    const m = MAKERS.find((k) => k.re.test(String(f.data?.match ?? "").trim()));
    if (m && !named.some((x) => x.maker === m)) named.push({ maker: m, fact: f });
  }
  if (!named.length) return null;
  if (named.length === 1) return { single: named[0].maker };
  const choices = named.map(({ maker }) => ({ name: maker.name, supply: `Your ${maker.name} key`, settings: [], aliases: maker.aliases }));
  return { group: {
    section: 5, kind: "system", by: "script", title: "Model provider",
    says: "Its own code calls a model; without one of these providers, it has none to call.",
    based_on: named.map((x) => x.fact.id), evidence: named.map((x) => ({ file: x.fact.file, line: x.fact.line })),
    detail: { system: "Model provider", of_models: true, need: "required", need_by: "rule", need_why: "its own code calls a model, from one of these providers", one_of: choices, supply: choices.map((c, i) => (i ? c.supply.replace(/^Your/, "your") : c.supply)).join(", or ") },
  } };
}
/** One provider named: the system the model wrote for it is required by rule. */
export function applySingleProvider(maker, systems) {
  for (const f of systems) {
    if (f.by === "script" || f.detail?.member_of) continue;
    const name = `${f.detail?.system ?? ""} ${f.title ?? ""}`.toLowerCase();
    if (!maker.aliases.some((w) => new RegExp(`\\b${esc(w)}\\b`).test(name))) continue;
    f.detail = { ...(f.detail ?? {}), need: "required", need_by: "rule", need_why: "its own code calls a model, and this is the only provider it names" };
    return f;
  }
  return null;
}

export function groupFindings(facts, { repoName = "" } = {}) {
  const out = [];
  for (const f of facts.filter((x) => x.kind === "one-of" && x.data?.on_start_path)) {
    const d = f.data;
    const choices = d.options.map((o) => ({ name: o.name ?? settingWords(o.settings[0], { repoName }), supply: supplyOf(o, repoName), settings: o.settings }));
    const names = choices.map((c) => c.name);
    if (new Set(names.map((n) => n.toLowerCase())).size < names.length) continue;
    const needs = trim(d.needs) || null;
    const title = needs ? cap(needs) : "One of these";
    out.push({
      section: 5, kind: "system", by: "script", title,
      says: "Without one of them, the agent stops before it runs.",
      based_on: [f.id], evidence: [{ file: f.file, line: f.line }],
      detail: { system: title, need: "required", need_by: "rule", need_why: "the code stops when none of them is there", one_of: choices, supply: choices.map((c, i) => (i ? c.supply.replace(/^(?:Your|Install|Set|Run|Start|Use|Build|A|An|The)(?= )/, (w) => w.toLowerCase()) : c.supply)).join(", or ") },
    });
  }
  return out;
}
/**
 * Mark each system finding the model wrote that is one of a group's
 * alternatives: by a setting the alternative names, or by its name. A member
 * that reads no setting of its own beyond the group's, and is not required by
 * a setting it reads, is said only in the group (need "one-of"); a member with
 * other uses keeps its own card, and its words name the group instead of
 * contradicting it. Returns the members it marked.
 */
export function applyGroups(groups, systems, byId) {
  const marked = [];
  for (const g of groups) {
    const groupSettings = new Set(g.detail.one_of.flatMap((c) => c.settings));
    const noun = g.title.toLowerCase();
    for (const f of systems) {
      if (f === g || f.by === "script" || f.detail?.one_of) continue;
      const mine = settingsOf(f, byId);
      const name = `${f.detail?.system ?? ""} ${f.title ?? ""}`.toLowerCase();
      const choice = g.detail.one_of.find((c) => c.settings.some((s) => mine.has(s)))
        ?? g.detail.one_of.find((c) => [firstWord(c.name), ...(c.aliases ?? [])].some((w) => w.length >= 3 && new RegExp(`\\b${esc(w)}\\b`).test(name)));
      if (!choice) continue;
      // The model provider's members: a system that cites a model the code
      // names or calls, or says it is a model or a provider; never one that
      // only makes images or speech with the same maker.
      if (g.detail.of_models && !(f.based_on ?? []).some((id) => ["model", "model-client"].includes(byId.get(id)?.kind)) && !/\b(?:models?|llms?|provider)\b/.test(name)) continue;
      const others = g.detail.one_of.filter((c) => c !== choice).map((c) => c.name);
      const d = { ...(f.detail ?? {}) };
      d.member_of = g.title; d.member_as = choice.name;
      const own = [...mine].filter((s) => !groupSettings.has(s));
      const requiredBySetting = d.need === "required" && d.need_by === "rule" && (d.need_settings ?? []).some((s) => s?.need === "required");
      if (!own.length && !requiredBySetting) {
        d.need = "one-of"; d.need_by = "rule"; d.need_why = `it is one of the choices for ${noun === "one of these" ? "what the code needs" : `the ${noun}`}`;
      } else if ((d.need === "required" && d.need_by !== "rule") || d.need === "unclear") {
        d.need = "optional"; d.need_by = "rule"; d.need_why = `for the ${noun}, ${and(others, "or")} can take its place`;
      }
      // Its words never say it can be left out while the group says one of them is required.
      if (!trim(d.without) || new RegExp(`\\b${esc(noun)}|\\blocal runs\\b`, "i").test(d.without)) d.without = noun === "one of these" ? `${and(others, "or")} must take its place` : `the ${noun} must come from ${and(others, "or")}`;
      f.detail = d;
      marked.push(f);
    }
  }
  return marked;
}
