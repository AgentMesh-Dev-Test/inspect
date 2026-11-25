// The agent's own parts, read off the code by fixed patterns: no model.
//
// The reverse engineer's facts (facts.mjs) say what any codebase reads, how
// it starts and what it tests; the security reviewer's trace (trace-programs.mjs)
// says what each program reaches. What an agent is made of besides needs its
// own patterns, and each match is a fact with its file and line:
//
//   skill         a folder holding SKILL.md, with the name and description
//                 its front matter gives
//   model         a model the code names (a provider:model string, a model
//                 family's name, a model= argument), and whether the line
//                 reads a setting, so a person can change it without the code
//   model-client  where the code builds a model client
//   tool          a tool the code hands a model (a @tool function, a tools=
//                 list, a tool() call, an MCP server it connects to)
//   capability    what a tool can do: run a shell command, write a file,
//                 drive a browser, send a message
//   human-step    where the code stops for a person (an interrupt, an
//                 approval, human in the loop)
//   memory        where it keeps something between jobs (a checkpointer, a
//                 store, a memory folder)
//   install-script a script that runs when the package is installed
//   license       a license file or a license the manifest declares, with
//                 its SPDX identifier where the text says which
//   framework     an agent framework its dependencies name
//   sdk           a service's own library it imports
//   part          whether a skill folder, or a script that runs as a
//                 command, can be lifted out on its own (lift_out yes or no,
//                 with each import that keeps it from standing alone)
//
// A match is a fact about a line, never a judgment: the model weighs them.
//
//   needs: node >= 22. Nothing here reads or writes a file: `read(file)`
//   answers a file's text, or null.
//   import { agentFacts, liftOut, isAssistantSkill } from "./agent-facts.mjs"
import { builtinModules } from "node:module";
import { posix } from "node:path";
import { linesOf } from "./codebase.mjs";
import { envReadsIn, isTestFile } from "./facts.mjs";

const trim = (s) => String(s ?? "").trim();
const ext = (f) => posix.extname(f).toLowerCase();
const base = (f) => posix.basename(f);

/** Code files read for patterns. */
export const CODE = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx", ".sh", ".bash"]);
/** Configuration files read for models, tools and memory. */
export const CONFIG = new Set([".json", ".toml", ".yaml", ".yml"]);
/** The largest file read for patterns, in characters. */
export const READ_CHARS = 1_000_000;

/** Skills kept for coding assistants that work on the repository, not the agent's own. */
export const ASSISTANT_DIRS = [".agents/", ".claude/", ".cursor/", ".github/", ".codex/", ".gemini/", ".windsurf/"];
export const isAssistantSkill = (folder) => ASSISTANT_DIRS.some((d) => `${folder}/`.startsWith(d));

const PATTERNS = [
  // A provider:model string, as LangChain's init_chat_model and others take it.
  { kind: "model", re: /["'`]((?:anthropic|openai|google_genai|google-genai|google_vertexai|google-vertex|vertexai|bedrock|bedrock_converse|azure_openai|ollama|groq|mistralai|fireworks|together|xai|deepseek|cohere|openrouter|perplexity)[:/][A-Za-z0-9._@\-]+)["'`]/g, group: 1 },
  // A model family's own name.
  { kind: "model", re: /["'`]((?:claude|gpt|o[1-9]|gemini|llama|mistral|mixtral|grok|deepseek|command|qwen|sonnet|haiku|opus)-[A-Za-z0-9._\-]*[0-9][A-Za-z0-9._\-]*)["'`]/g, group: 1 },
  { kind: "model", re: /\b(?:model|model_name|modelName|model_id|modelId)\s*[=:]\s*["'`]([A-Za-z0-9][A-Za-z0-9._:/@\-]{2,80})["'`]/g, group: 1 },
  { kind: "model-client", re: /\b(ChatAnthropic|ChatOpenAI|AzureChatOpenAI|ChatGoogleGenerativeAI|ChatVertexAI|ChatBedrock|ChatOllama|ChatGroq|init_chat_model|initChatModel|Anthropic|AsyncAnthropic|OpenAI|AsyncOpenAI|GoogleGenerativeAI|createAnthropic|createOpenAI|genai\.Client)\s*\(/g, group: 1 },
  { kind: "tool", re: /^\s*@(?:tool|function_tool|mcp\.tool|server\.tool)\b/gm, group: 0 },
  { kind: "tool", re: /\b(StructuredTool|BaseTool|DynamicStructuredTool|DynamicTool|tool)\s*\(\s*(?:async\s*)?(?:\(|function|name\s*=|\{|["'`])/g, group: 1 },
  { kind: "tool", re: /\btools\s*[=:]\s*\[/g, group: 0 },
  { kind: "tool", re: /\b(mcpServers|mcp_servers|MultiServerMCPClient|MCPClient|StdioServerParameters|McpServer)\b/g, group: 1 },
  { kind: "capability", what: "shell", re: /\b(subprocess\.(?:run|Popen|call|check_output|check_call)|os\.system|os\.popen|child_process|execSync|spawnSync|execFileSync|exec\s*\(|spawn\s*\(|ShellTool|BashTool|run_shell|execute_command|shell\s*=\s*True)\b/g, group: 1 },
  { kind: "capability", what: "file-write", re: /\b(write_file|edit_file|writeFile|writeFileSync|appendFileSync|open\s*\([^)]*,\s*["'](?:w|a|wb|ab|x)["']|\.write_text\s*\(|\.write_bytes\s*\(|shutil\.(?:copy|move|rmtree)|os\.remove|unlinkSync|rmSync)\b/g, group: 1 },
  { kind: "capability", what: "browser", re: /\b(playwright|puppeteer|selenium|webdriver|chromium\.launch|browser_use|BrowserToolkit)\b/gi, group: 1 },
  { kind: "capability", what: "send-message", re: /\b(chat_postMessage|chat\.postMessage|files_upload(?:_v2)?|conversations_replies|WebClient|sendMessage|send_message|smtplib|sendgrid|nodemailer|twilio|post_message|reply_to_thread)\b/g, group: 1 },
  { kind: "human-step", re: /\b(interrupt_on|interrupt_before|interrupt_after|HumanInTheLoopMiddleware|human_in_the_loop|humanInTheLoop|interrupt\s*\(|Command\s*\(\s*resume|requires_approval|require_approval|needs_approval|approval_required|ask_human|AskHuman)\b/g, group: 1 },
  // A question put to the person whose answers include an approval.
  { kind: "human-step", re: /\b(ask\s*\([^\n]*\b(?:APPROVE|approve|approval)\b)/g, group: 1 },
  { kind: "memory", re: /\b(checkpointer|InMemorySaver|MemorySaver|PostgresSaver|AsyncPostgresSaver|SqliteSaver|RedisSaver|InMemoryStore|PostgresStore|BaseStore|StoreBackend|CompositeBackend|FilesystemBackend|long_term_memory|memories)\b/g, group: 1 },
];

/** A line of a skill's instructions that waits for the person's approval. */
export const APPROVAL_WORDS = /\b(?:user|person|human|they)\b[^.\n]{0,60}\bapprov(?:e|es|ed|al)\b|\bapprov(?:e|es|ed|al)\b[^.\n]{0,40}\b(?:user|person|human)\b|\b(?:only )?after (?:the )?(?:user|person)?'?s? ?approval\b|\bwait (?:for|on) (?:the )?(?:user|person)'?s? (?:approval|OK|go-ahead)\b|\bask (?:the )?(?:user|person) (?:to )?(?:approve|confirm)\b/i;

/** Agent frameworks a dependency's name shows, by package name. */
export const FRAMEWORKS = {
  langgraph: "LangGraph", "langgraph-sdk": "LangGraph", "@langchain/langgraph": "LangGraph", langchain: "LangChain", "langchain-core": "LangChain", "@langchain/core": "LangChain",
  deepagents: "Deep Agents", "deepagents-cli": "Deep Agents", crewai: "CrewAI", "pyautogen": "AutoGen", "autogen-agentchat": "AutoGen", "llama-index": "LlamaIndex", "llama-index-core": "LlamaIndex",
  "openai-agents": "OpenAI Agents SDK", "@openai/agents": "OpenAI Agents SDK", "google-adk": "Google ADK", "@mastra/core": "Mastra", "pydantic-ai": "Pydantic AI", "claude-agent-sdk": "Claude Agent SDK", "@anthropic-ai/claude-agent-sdk": "Claude Agent SDK", ai: "Vercel AI SDK",
};

/** A service's own library, by the name it is imported as, and the service. */
export const SDKS = {
  slack_sdk: "Slack", slack_bolt: "Slack", "@slack/web-api": "Slack", "@slack/bolt": "Slack",
  anthropic: "Anthropic's API", "@anthropic-ai/sdk": "Anthropic's API", openai: "OpenAI's API",
  langsmith: "LangSmith", boto3: "Amazon Web Services", "google.cloud": "Google Cloud", "@google-cloud": "Google Cloud", "google.genai": "Google's Gemini API", "@google/genai": "Google's Gemini API",
  tavily: "Tavily", exa_py: "Exa", firecrawl: "Firecrawl", e2b: "E2B", e2b_code_interpreter: "E2B", modal: "Modal", daytona: "Daytona", daytona_sdk: "Daytona",
  stripe: "Stripe", twilio: "Twilio", sendgrid: "SendGrid", github: "GitHub", "@octokit/rest": "GitHub", replicate: "Replicate", elevenlabs: "ElevenLabs", fal_client: "fal", "@fal-ai/client": "fal",
  supabase: "Supabase", "@supabase/supabase-js": "Supabase", redis: "Redis", psycopg: "PostgreSQL", psycopg2: "PostgreSQL", pinecone: "Pinecone",
};

const PY_IMPORT = /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import\b|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))/;
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/g;

/** Every import a code file makes: [{spec, line, python}]. */
export function importsIn(file, text) {
  const out = [];
  const py = ext(file) === ".py";
  linesOf(text).forEach((line, i) => {
    if (py) {
      const m = PY_IMPORT.exec(line);
      if (!m) return;
      if (m[1]) out.push({ spec: m[1], line: i + 1, python: true });
      else for (const s of m[2].split(",")) out.push({ spec: trim(s).split(/\s+/)[0], line: i + 1, python: true });
      return;
    }
    for (const m of line.matchAll(JS_IMPORT)) out.push({ spec: m[1], line: i + 1, python: false });
  });
  return out;
}

const NODE_BUILTINS = new Set(builtinModules);
/** Python's own modules, the ones a script that stands alone leans on. */
export const PYTHON_STDLIB = new Set(["abc", "argparse", "array", "ast", "asyncio", "base64", "binascii", "bisect", "calendar", "collections", "colorsys", "concurrent", "contextlib", "copy", "csv", "dataclasses", "datetime", "decimal", "difflib", "enum", "errno", "fnmatch", "fractions", "functools", "gc", "getpass", "glob", "gzip", "hashlib", "heapq", "hmac", "html", "http", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "logging", "math", "mimetypes", "operator", "os", "pathlib", "pickle", "platform", "pprint", "queue", "random", "re", "secrets", "shlex", "shutil", "signal", "socket", "sqlite3", "statistics", "string", "struct", "subprocess", "sys", "tarfile", "tempfile", "textwrap", "threading", "time", "timeit", "traceback", "types", "typing", "unicodedata", "unittest", "urllib", "uuid", "warnings", "weakref", "xml", "zipfile", "zlib", "__future__"]);

/** Whether an import is the language's own module. */
export function isOwnModule(spec, python) {
  if (python) return PYTHON_STDLIB.has(spec.split(".")[0]);
  return spec.startsWith("node:") || NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split("/")[0]);
}

const RESOLVE = ["", ".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx", "/index.mjs", "/index.js", "/index.ts"];

/** A relative import's file inside the codebase, or null. */
export function resolveLocal(from, spec, python, fileSet) {
  if (python) {
    const mod = spec.replace(/^\.+/, "").split(".").filter(Boolean).join("/");
    const dir = posix.dirname(from);
    for (const c of [`${dir}/${mod}.py`, `${dir}/${mod}/__init__.py`]) if (fileSet.has(posix.normalize(c))) return posix.normalize(c);
    return null;
  }
  if (!/^\.\.?(\/|$)/.test(spec)) return null;
  const joined = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const e of RESOLVE) if (fileSet.has(joined + e)) return joined + e;
  return null;
}

/** A script and every file it imports inside `folder`, followed all the way down. */
export function closureOf(start, folder, read, fileSet) {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const t = read(f);
    if (t === null || t === undefined) return;
    for (const im of importsIn(f, t)) {
      const to = resolveLocal(f, im.spec, im.python, fileSet);
      if (to && (!folder || to.startsWith(`${folder}/`))) visit(to);
    }
  };
  visit(start);
  return [...seen].sort();
}

/** Variables every machine gives a program: reading one ties a part to nothing. */
export const MACHINE_VARS = new Set(["PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "USER", "USERNAME", "SHELL", "PWD", "LANG", "LC_ALL", "TZ", "TERM", "NODE_ENV", "CI", "APPDATA", "LOCALAPPDATA", "PATHEXT", "SYSTEMROOT", "COMSPEC", "NO_COLOR", "FORCE_COLOR", "DEBUG"]);
/** A name that says a variable holds a credential (the reverse engineer's words). */
export const CREDENTIAL_VAR = /(^|_)(KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|CERT)(_|$)/i;
/** A line that loads a module whose name is worked out at run time, or installs a package. */
const RUNTIME_PACKAGE = /\bimport\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))|\brequire\s*\(\s*(?!["'`])[A-Za-z_$]|\bimportlib\.import_module\s*\(|\b__import__\s*\(|\bnpm\b[^\n]{0,40}\binstall\b|["'`]npx["'`]|\bpip3?\s+install\b|\buv\s+(?:add|pip\s+install)\b/;

/**
 * Whether a part (a skill folder, or a script with the files it imports from
 * its own folder) can be lifted out on its own: {lift_out: "yes" | "no",
 * keeps: [{file, line, spec, why}], settings: [{file, line, name}]}. It can
 * when every import of its code files resolves inside `folder` or is the
 * language's own module, none of them reads a credential from its
 * environment, and none loads or installs a package at run time. The other
 * settings it reads are listed; a variable every machine has is not.
 */
export function liftOut(folder, codeFiles, read) {
  const keeps = [];
  const settings = [];
  const root = folder ? `${folder}/` : "";
  for (const f of codeFiles) {
    const text = read(f);
    if (text === null || text === undefined) continue;
    for (const im of importsIn(f, text)) {
      if (im.python) {
        if (im.spec.startsWith(".") && (!folder || f.startsWith(root))) continue;
        if (isOwnModule(im.spec, true)) continue;
        // A module beside the script, inside the part's own folder.
        const local = `${posix.dirname(f)}/${im.spec.split(".")[0]}.py`;
        if (local.startsWith(root) && read(local) !== null) continue;
        keeps.push({ file: f, line: im.line, spec: im.spec, why: "a Python package or module from outside the part" });
        continue;
      }
      if (/^\.\.?(\/|$)/.test(im.spec)) {
        const joined = posix.normalize(posix.join(posix.dirname(f), im.spec));
        if (!(folder ? joined.startsWith(root) : false) && joined !== folder) keeps.push({ file: f, line: im.line, spec: im.spec, why: "a file outside the part's own folder" });
        continue;
      }
      if (!isOwnModule(im.spec, false)) keeps.push({ file: f, line: im.line, spec: im.spec, why: "a package that has to be installed" });
    }
    for (const r of envReadsIn(text)) {
      if (MACHINE_VARS.has(r.name)) continue;
      if (CREDENTIAL_VAR.test(r.name)) keeps.push({ file: f, line: r.line, spec: r.name, why: "a credential it reads from its environment" });
      else if (!settings.some((s) => s.name === r.name)) settings.push({ file: f, line: r.line, name: r.name });
    }
    linesOf(text).forEach((line, i) => {
      if (/^\s*(?:\/\/|#|\*)/.test(line)) return;
      const m = RUNTIME_PACKAGE.exec(line);
      if (m) keeps.push({ file: f, line: i + 1, spec: m[0].trim(), why: "a package it loads or installs at run time" });
    });
  }
  return { lift_out: keeps.length ? "no" : "yes", keeps, settings };
}

/** A SKILL.md's front matter: {name, description, line}. */
export function frontMatter(text) {
  const lines = linesOf(text);
  if (trim(lines[0]) !== "---") return {};
  const out = {};
  for (let i = 1; i < lines.length && i < 60; i += 1) {
    if (trim(lines[i]) === "---") break;
    const m = /^(name|description)\s*:\s*(.*)$/.exec(lines[i]);
    if (m && !(m[1] in out)) { out[m[1]] = trim(m[2]).replace(/^["']|["']$/g, ""); out[`${m[1]}_line`] = i + 1; }
  }
  return out;
}

/** An SPDX identifier from a license file's own words, or null. */
export function spdxOfText(text) {
  const t = String(text ?? "").slice(0, 4000); // cut-ok: a license names itself in its first lines; the whole file stays in the codebase
  if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/\bMIT License\b/i.test(t) || /Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 3/i.test(t)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 3/i.test(t)) return "LGPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 3/i.test(t)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 2/i.test(t)) return "GPL-2.0";
  if (/Mozilla Public License,? (?:Version|v\.?) ?2\.0/i.test(t)) return "MPL-2.0";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(t)) return "ISC";
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  return null;
}

const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[.-][A-Za-z0-9.]+)?$/i;
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepublish", "preprepare", "postprepare"];

/** The line a key is written on in a JSON text, or 1. */
function lineOfKey(text, key, after = 0) {
  const lines = linesOf(text);
  const re = new RegExp(`^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  for (let i = after; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 1;
}

/**
 * The agent's own parts, as facts without ids: [{kind, file, line, data}].
 * `entries` are the files that start as commands (the reverse engineer's
 * surface.entries, and Python files with a __main__ check found here).
 */
export function agentFacts(files, read, { entries = [] } = {}) {
  const out = [];
  const add = (kind, file, line, data = {}) => out.push({ kind, file, line, data });
  const textOf = (f) => { const t = read(f); return t !== null && t !== undefined && t.length <= READ_CHARS ? t : null; };

  // Skills, and whether each folder can be lifted out on its own.
  const skillFolders = [];
  for (const f of files) {
    if (base(f) !== "SKILL.md") continue;
    const folder = posix.dirname(f) === "." ? "" : posix.dirname(f);
    const fm = frontMatter(textOf(f) ?? "");
    const code = files.filter((x) => folder && x.startsWith(`${folder}/`) && CODE.has(ext(x)));
    skillFolders.push(folder);
    add("skill", f, fm.name_line ?? 1, {
      name: fm.name || base(folder), folder, ...(fm.description ? { description: fm.description, description_line: fm.description_line } : {}),
      scripts: code, instructions_only: code.length === 0, for_coding_assistants: isAssistantSkill(folder),
    });
    add("part", f, fm.name_line ?? 1, { part: "skill", name: fm.name || base(folder), folder, ...liftOut(folder, code, textOf) });
    // A skill's own instructions that stop for the person's approval: one
    // fact for the file, at its first such line, with every line.
    const stops = linesOf(textOf(f) ?? "").map((l, i) => (APPROVAL_WORDS.test(l) ? i + 1 : 0)).filter(Boolean);
    if (stops.length) add("human-step", f, stops[0], { match: "an approval the skill's instructions wait for", in: "instructions", lines: stops });
  }

  // Scripts that run as commands, outside a skill's folder or inside one.
  const commandFiles = new Set(entries.map((e) => e.file));
  for (const f of files) {
    if (ext(f) !== ".py") continue;
    const t = textOf(f);
    if (t && /^if\s+__name__\s*==\s*["']__main__["']\s*:/m.test(t)) commandFiles.add(f);
  }
  const fileSet = new Set(files);
  for (const f of [...commandFiles].sort()) {
    if (isTestFile(f)) continue;
    const line = entries.find((e) => e.file === f)?.evidence?.[0]?.line ?? 1;
    const folder = posix.dirname(f) === "." ? "" : posix.dirname(f);
    const closure = closureOf(f, folder, textOf, fileSet);
    add("part", f, line, { part: "script", name: base(f), folder, files: closure, ...liftOut(folder, closure, textOf) });
  }

  for (const f of files) {
    const e = ext(f);
    const name = base(f);
    if (LICENSE_FILE.test(name)) {
      const t = textOf(f);
      add("license", f, 1, { spdx: spdxOfText(t), file_kind: /^NOTICE/i.test(name) ? "notice" : "license" });
      continue;
    }
    if (name === "package.json") {
      const t = textOf(f); let pkg = null;
      try { pkg = JSON.parse(t ?? ""); } catch { pkg = null; }
      if (pkg) {
        if (typeof pkg.license === "string" && trim(pkg.license)) add("license", f, lineOfKey(t, "license"), { spdx: trim(pkg.license), file_kind: "manifest" });
        const at = lineOfKey(t, "scripts");
        for (const s of INSTALL_SCRIPTS) if (trim(pkg.scripts?.[s])) add("install-script", f, lineOfKey(t, s, at - 1), { script: s, runs: trim(pkg.scripts[s]) });
        for (const dep of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) })) if (FRAMEWORKS[dep]) add("framework", f, lineOfKey(t, dep), { framework: FRAMEWORKS[dep], package: dep });
      }
      continue;
    }
    if (name === "setup.py") { add("install-script", f, 1, { script: "setup.py", runs: "setup.py runs as Python when the package is built or installed from source" }); continue; }
    if (name === "pyproject.toml") {
      const t = textOf(f) ?? "";
      linesOf(t).forEach((line, i) => {
        const lic = /^\s*license\s*=\s*(?:"([^"]+)"|\{\s*text\s*=\s*"([^"]+)")/.exec(line);
        if (lic) add("license", f, i + 1, { spdx: trim(lic[1] ?? lic[2]), file_kind: "manifest" });
        const be = /^\s*build-backend\s*=\s*"([^"]+)"/.exec(line);
        if (be && !/^(setuptools\.build_meta|hatchling\.build|poetry\.core\.masonry\.api|flit_core\.buildapi|pdm\.backend|uv_build|maturin|scikit_build_core\.build)$/.test(be[1])) add("install-script", f, i + 1, { script: "build-backend", runs: be[1] });
        if (/^\s*\[tool\.hatch\.build(?:\.targets\.[\w-]+)?\.hooks/.test(line)) add("install-script", f, i + 1, { script: "hatch build hook", runs: trim(line) });
        const dep = /^\s*"([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*[<>=!~;"]/.exec(line);
        if (dep && FRAMEWORKS[dep[1].toLowerCase()]) add("framework", f, i + 1, { framework: FRAMEWORKS[dep[1].toLowerCase()], package: dep[1].toLowerCase() });
      });
    }
    if (!CODE.has(e) && !CONFIG.has(e)) continue;
    // A test describes the agent; it is not what the agent does.
    if (isTestFile(f) || /(^|\/)(tests?|__tests__|fixtures?)\//.test(f)) continue;
    const t = textOf(f);
    if (t === null) continue;
    const lines = linesOf(t);
    // One fact for each kind, capability and match in a file, at its first
    // line, with every line it is on: a file that writes in forty places is
    // one fact about that file, not forty.
    const grouped = new Map();
    for (const p of PATTERNS) {
      if (CONFIG.has(e) && !["model", "tool", "memory", "human-step"].includes(p.kind)) continue;
      lines.forEach((line, i) => {
        p.re.lastIndex = 0;
        for (const m of line.matchAll(p.re)) {
          const value = trim(m[p.group] ?? m[0]);
          const key = `${p.kind}|${p.what ?? ""}|${["model", "tool", "human-step"].includes(p.kind) ? `${i}|` : ""}${value}`;
          const have = grouped.get(key);
          if (have) { if (!have.data.lines.includes(i + 1)) have.data.lines.push(i + 1); continue; }
          const data = { match: value, ...(p.what ? { what: p.what } : {}), lines: [i + 1], ...(CONFIG.has(e) ? { in_config: true } : {}) };
          if (p.kind === "model") {
            const reads = envReadsIn(line).map((r) => r.name);
            data.chosen_by = reads.length ? "setting" : "written in the code";
            if (reads.length) data.settings = reads;
          }
          if (p.kind === "tool" && /^\s*@/.test(line)) {
            const def = lines.slice(i + 1, i + 4).map((l) => /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(l)?.[1]).find(Boolean);
            if (def) data.name = def;
          }
          grouped.set(key, { kind: p.kind, line: i + 1, data });
        }
      });
    }
    for (const g of [...grouped.values()].sort((a, b) => a.line - b.line)) add(g.kind, f, g.line, g.data);
    if (CODE.has(e)) {
      const sdks = new Map();
      for (const im of importsIn(f, t)) {
        const top = im.python ? im.spec.split(".")[0] : im.spec.startsWith("@") ? im.spec.split("/").slice(0, 2).join("/") : im.spec.split("/")[0];
        const sdk = SDKS[im.spec] ?? SDKS[top] ?? (im.python && im.spec.startsWith("google.cloud") ? SDKS["google.cloud"] : null) ?? (!im.python && im.spec.startsWith("@google-cloud/") ? SDKS["@google-cloud"] : null);
        if (sdk && !sdks.has(sdk)) { sdks.set(sdk, true); add("sdk", f, im.line, { package: im.spec, service: sdk }); }
      }
    }
  }
  return { facts: out, skillFolders };
}
