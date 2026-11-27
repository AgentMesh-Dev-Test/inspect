// F6, Could it move? (0.6.0): how tied an agent is to its platform and what
// moving it would take, read by rule from AgentMesh's agent platforms
// database (a copy pinned to one AgentMesh commit).
//
// What is worth pinning: the copy is the pinned bytes; a platform and each of
// its features count only from what the code holds, at its file and line, and
// never from a comment, a test, a coding assistant's folder or a name some
// other code happens to use; the rows, the destinations and the work to move
// follow one rule for every vendor, AgentMesh among them; a plugin is read
// only for what applies to it; the model says only what each outside service
// is needed for, and is held to plain facts; the report, its working copy
// and its Markdown carry the reading, the evidence only where it belongs.
//
// Nothing here touches a network or a model: GitHub, OSV, the screening and
// the model are the helpers' stand-ins.
//   node --test test/portability.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_KEYS, loadDatabase, platformUses, readingOf, codeOnly } from "../scripts/platforms.mjs";
import { checkPortability } from "../scripts/checks.mjs";
import { firstPrompt, secondPrompt, judge } from "../scripts/judge.mjs";
import { markdownOf, workingCopy } from "../scripts/report.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { ENV, ROOT, inTemp, model, reportSchema, schemaProblems, smallAgent, world, claudePlugin } from "./helpers.mjs";

const DB = join(ROOT, "assets", "agent-platforms");
const db = loadDatabase();

/** A small LangGraph agent that uses LangSmith's sandboxes and tracing, and
 *  LangGraph's checkpoints and interrupts; with a comment, a test, a coding
 *  assistant's folder and a docstring that name features it does not use. */
function langgraphAgent(extra = {}) {
  return {
    LICENSE: "MIT License\n",
    "pyproject.toml": "[project]\nname = \"maker\"\nkeywords = [\"langchain\", \"openevals\"]\ndependencies = [\n  \"langgraph>=1.2\",\n  \"langsmith>=0.14\",\n  \"deepagents>=0.7\",\n]\n\n[dependency-groups]\ndev = [\"openevals>=0.1\"]\n",
    ".env.example": "LANGSMITH_TRACING=true\nLANGSMITH_API_KEY=\nMAKER_SANDBOX=docker  # docker | langsmith\n",
    "src/maker/graph.py": "from langgraph.checkpoint.memory import InMemorySaver\nfrom langgraph.types import interrupt, Command\n\n# client.evaluate is how LangSmith scores runs; this agent does not.\ndef build():\n    saver = InMemorySaver()\n    return saver\n",
    "src/maker/sandbox.py": "import os\n\n\ndef pool():\n    \"\"\"Uses SandboxClient from LangSmith, and never Command(resume=...) here.\"\"\"\n    from langsmith.sandbox import SandboxClient\n    return SandboxClient(api_key=os.environ.get(\"LANGSMITH_API_KEY\"))\n",
    "src/maker/notes.py": "class Memory:\n    pass\n\nMemory()\n",
    "tests/test_eval.py": "from langsmith import Client\nimport openevals\n\ndef test_it():\n    Client().evaluate(lambda x: x)\n",
    ".claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: Deploy with langgraph deploy.\n---\n\nRun `langgraph deploy`.\n",
    "CLAUDE.md": "Instructions for Claude Code.\n",
    ...extra,
  };
}
const filesOf = (o) => Object.keys(o).sort();
const readerOf = (o) => (f) => (f in o ? o[f] : null);
const readOf = (files, frameworks = []) => {
  const found = platformUses({ files: filesOf(files), read: readerOf(files), db, frameworks });
  return { found, reading: readingOf({ found, db, frameworks, languages: [{ language: "Python", files: 3 }], ownCode: { files: 3, lines: 21 } }) };
};

test("[F6.A1] the database is AgentMesh's own, byte for byte at the commit pinned.json names, with its date", () => {
  const pin = JSON.parse(readFileSync(join(DB, "pinned.json"), "utf8"));
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.equal(pin.path, "data/agent-platforms");
  const here = (d, p = "") => readdirSync(join(DB, p)).flatMap((n) => (n.endsWith(".json") || n.endsWith(".md") ? [p ? `${p}/${n}` : n] : here(d, p ? `${p}/${n}` : n)));
  const files = here(DB).filter((f) => f !== "pinned.json").sort();
  assert.deepEqual(pin.files.map((f) => f.file).sort(), files, "every file of the copy is pinned, and only those");
  for (const f of pin.files) assert.equal(createHash("sha256").update(readFileSync(join(DB, f.file))).digest("hex"), f.sha256, `${f.file} is the pinned bytes`);
  assert.equal(db.platforms.length, 9);
  for (const p of db.platforms) assert.deepEqual(Object.keys(p.categories).sort(), [...CATEGORY_KEYS].sort(), `${p.id} rates all twelve`);
  assert.equal(db.checked, db.platforms.map((p) => p.checked).sort()[0], "the database's date is its oldest entry's");
  assert.equal(db.categories.find((c) => c.key === "tool-connections").title, "Tool connections", "titles lose their parentheses");
});

test("[F6.A2] a LangGraph agent: built on LangChain's stack; one row for each category the code uses, each at its file and line; nothing a platform merely offers", () => {
  const files = langgraphAgent();
  const { reading } = readOf(files, [{ framework: "LangGraph", package: "langgraph", file: "pyproject.toml", line: 5 }]);
  assert.equal(reading.built_on.platforms[0].platform, "langchain");
  assert.equal(reading.built_on.platforms.length, 1, "CLAUDE.md is a coding assistant's, never a sign of Anthropic's platform");
  const row = (k) => reading.uses.find((r) => r.category === k);
  // deepagents is the database's own evidence of Deep Agents' skills, so packaging counts too.
  assert.deepEqual(reading.uses.map((r) => r.category), ["tracing", "memory-and-state", "human-approval", "sandboxes", "packaging"]);
  const sandbox = row("sandboxes");
  assert.equal(sandbox.outside, true);
  assert.equal(sandbox.swap, "one-file");
  assert.deepEqual(sandbox.sources[0].evidence.map((e) => `${e.file}:${e.line}`), ["src/maker/sandbox.py:6"], "the import, not the docstring above it");
  assert.equal(sandbox.sources[0].what, db.platforms.find((p) => p.id === "langchain").categories.sandboxes.what, "the database's own words");
  assert.equal(row("memory-and-state").swap, "library", "open source comes with its code");
  assert.equal(row("memory-and-state").outside, false);
  assert.equal(row("tracing").swap, "settings", "LangSmith tracing is reached by settings alone");
  assert.ok(row("tracing").sources[0].evidence.some((e) => e.file === ".env.example"));
  assert.ok(!row("evaluations"), "a comment, a test and a development dependency are not use");
  assert.ok(!row("deployment"), "a coding assistant's folder is not the agent");
  assert.ok(reading.not_used.includes("evaluations"));
});

test("[F6.A3] a name counts only where the code imports that platform; a module the repository holds is its own; comments and docstrings are never code", () => {
  const files = langgraphAgent({
    "pyproject.toml": "[project]\nname = \"maker\"\ndependencies = [\"langgraph>=1.2\"]\n",
    "agents/__init__.py": "",
    "agents/mcp.py": "class MCPServerStreamableHttp:\n    pass\n",
    "src/maker/use.py": "from agents.mcp import MCPServerStreamableHttp\n",
  });
  const { found } = readOf(files);
  assert.ok(!found.present.has("openai"), "its own agents package is not OpenAI's Agents SDK");
  assert.ok(!found.present.has("mastra"), "a class named Memory is not Mastra's");
  assert.ok(!found.uses.some((u) => u.file === "src/maker/notes.py"));
  assert.deepEqual(codeOnly("a.py", ["x = 1  # client.evaluate", '"""SandboxClient', 'still', 'done"""', "y = 2"]), ["x = 1  ", "", "", "", "y = 2"]);
  assert.deepEqual(codeOnly("a.ts", ["const u = 'https://x.test/a'; // evaluate", "/* Memory", "*/ go()"]), ["const u = 'https://x.test/a'; ", "", " go()"]);
});

test("[F6.A4] moving it: AgentMesh first, then the two that keep the most, the rest under Every platform; what it would lose and what replaces each are the destination's own cells, by one rule for every vendor", () => {
  const files = langgraphAgent({ "src/maker/score.py": "from langsmith import Client\n\nclient = Client()\nclient.evaluate(lambda x: x)\n" });
  const { reading } = readOf(files);
  assert.ok(reading.uses.some((r) => r.category === "evaluations"), "client.evaluate in the agent's own code is use");
  const d = reading.destinations;
  assert.equal(d.length, 8, "every platform but the one it is built on");
  assert.equal(d[0].platform, "agentmesh");
  assert.deepEqual(d.map((x) => x.shown), [true, true, true, false, false, false, false, false]);
  for (const x of d) {
    const p = db.platforms.find((y) => y.id === x.platform);
    assert.deepEqual(x.cells.map((c) => c.category), reading.uses.map((r) => r.category), `${x.name}: a cell for each category used, and no other`);
    for (const c of x.cells) { assert.equal(c.rating, p.categories[c.category].rating); assert.equal(c.what, p.categories[c.category].what); }
    assert.deepEqual(x.loses, x.cells.filter((c) => c.rating === "none").map((c) => c.category), `${x.name}: what it would lose is what it rates none`);
    assert.deepEqual(x.partly, x.cells.filter((c) => c.rating === "partial").map((c) => c.category));
    assert.equal(x.runtime.deployment.what, p.categories.deployment.what);
    assert.deepEqual(x.swaps, reading.uses.filter((r) => r.outside).map((r) => r.category), "the services to swap, the same rule everywhere");
  }
  assert.ok(d[0].loses.includes("evaluations"), "AgentMesh's none for evaluations shows like anyone else's");
  const rest = d.slice(1, 3);
  for (const x of d.slice(3)) for (const y of rest) assert.ok(!(x.language_fits && !y.language_fits), "a platform in its language comes before one that is not");
});

test("[F6.A5] a plugin is read for what applies to it: how it is packaged, the MCP servers it connects to, and its tool's own hooks and commands; the rest is said not to apply", () => {
  const files = claudePlugin();
  const found = platformUses({ files: filesOf(files), read: readerOf(files), db });
  const subject = { kind: "plugin", name: "helper", tools: ["Claude Code", "Cursor"], also_for: [] };
  const reading = readingOf({ found, db, subject, pluginParts: { hooks: [{ id: "F0101", kind: "hook", file: "hooks/hooks.json", line: 2 }], commands: [{ id: "F0102", kind: "slash-command", file: "commands/deploy.md", line: 1 }] } });
  for (const r of reading.uses) assert.ok(["packaging", "tool-connections", "hooks", "commands"].includes(r.category), `${r.category} applies to a plugin`);
  const skills = reading.uses.find((r) => r.category === "packaging");
  assert.ok(skills.sources.some((s) => s.standard === "Agent Skills"), "its skills are in the Agent Skills format");
  assert.equal(reading.uses.find((r) => r.category === "hooks").level, "proprietary");
  assert.deepEqual(reading.not_applicable, CATEGORY_KEYS.filter((k) => !["packaging", "tool-connections"].includes(k)));
  assert.deepEqual(reading.built_on.tools, ["Claude Code", "Cursor"]);
  for (const d of reading.destinations) { assert.equal(d.runtime, null, "a plugin has no runtime to re-host"); assert.ok(d.cells.every((c) => ["packaging", "tool-connections"].includes(c.category))); }
});

test("[F6.A6] the model says only what each outside service is needed for: asked in the first call with the facts that show it, never in the second; its words are held to plain facts", () => {
  const files = langgraphAgent();
  const { reading, found } = readOf(files);
  const facts = found.uses.map((u, i) => { u.fact = `F${String(i + 1).padStart(4, "0")}`; return { id: u.fact, kind: "platform-use", file: u.file, line: u.line, data: { platform: u.platform, category: u.category } }; });
  const again = readingOf({ found, db, languages: [{ language: "Python", files: 3 }] });
  const first = firstPrompt("F0001 [platform-use] src/maker/sandbox.py:6", { repo: "acme/maker", portability: again });
  assert.match(first, /"portability"/);
  assert.match(first, /sandboxes, sandboxes and code execution from LangChain \(F\d{4}/);
  assert.match(first, /tracing/);
  assert.doesNotMatch(first, /memory-and-state,/, "open source that comes with its code is not an outside service");
  assert.doesNotMatch(secondPrompt("x", { repo: "acme/maker" }), /portability/);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cite = [facts[0].id];
  const c = checkPortability([
    { category: "sandboxes", needs: "a sandbox that can run a browser and encode media", choices: "Docker, picked by a setting", based_on: cite },
    { category: "tracing", needs: "Send traces to src/maker/tracing.py", choices: "", based_on: cite },
    { category: "memory-and-state", needs: "A place to keep each thread's state", based_on: cite },
    { category: "sandboxes", needs: "A second answer for the same row", based_on: cite },
  ], reading, byId);
  assert.deepEqual([...c.kept.keys()], ["sandboxes"]);
  assert.deepEqual(c.kept.get("sandboxes"), { needs: "A sandbox that can run a browser and encode media", choices: "Docker, picked by a setting", based_on: cite });
  assert.equal(c.held.length, 2, "a path in its words, and a row that is no outside service");
  for (const bad of [{ needs: "It is easy to swap for Docker" }, { needs: "A sandbox", based_on: [] }, { needs: "We recommend a hosted sandbox instead" }]) {
    const h = checkPortability([{ category: "sandboxes", choices: "", based_on: cite, ...bad }], reading, byId);
    assert.equal(h.kept.size, 0, JSON.stringify(bad));
  }
});

test("[F6.A7] the report carries the reading, with the evidence, and fits its schema; the Markdown says it after Systems it uses, each place a link to its line; the working copy carries it without the evidence", async () => {
  await inTemp(async (at) => {
    const files = { ...smallAgent(), ...langgraphAgent() };
    const answer = (prompt) => {
      const ids = [...prompt.matchAll(/sandboxes and code execution from LangChain \((F\d{4})/g)].map((m) => m[1]);
      return { text: JSON.stringify({ findings: [], skills: [], portability: [{ category: "sandboxes", needs: "A sandbox that can run a browser", choices: "Docker, picked by a setting", based_on: ids }] }) };
    };
    const starts = [];
    const m = model([answer]);
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: m.ask, onStart: (a) => starts.push(a) });
    const r = out.report;
    assert.deepEqual(schemaProblems(r, reportSchema()), []);
    assert.equal(r.portability.built_on.platforms[0].platform, "langchain");
    const sandbox = r.portability.uses.find((u) => u.category === "sandboxes");
    assert.equal(sandbox.needs, "A sandbox that can run a browser");
    assert.equal(sandbox.choices, "Docker, picked by a setting");
    for (const e of sandbox.sources[0].evidence) assert.ok(r.facts.some((f) => f.id === e.fact && f.kind === "platform-use" && f.file === e.file && f.line === e.line), "each place is a fact of the report");
    assert.doesNotMatch(m.asked[1].prompt, /\[platform-use\]/, "the second call reads what it read before");
    const md = markdownOf(r);
    const at5 = md.indexOf("## Systems it uses"); const atMove = md.indexOf("## Could it move?"); const at6 = md.indexOf("## What it can do on its own");
    assert.ok(at5 > 0 && atMove > at5 && at6 > atMove, "after Systems it uses, before what it can do on its own");
    assert.match(md, /\[`src\/maker\/sandbox\.py:6`\]\(https:\/\/github\.com\/acme\/helper\/blob\/86d8f66\/src\/maker\/sandbox\.py#L6\)/);
    assert.match(md, /#### AgentMesh/);
    assert.match(md, /From the agent platforms database at AgentMesh commit [0-9a-f]{7}, checked \d{4}-\d{2}-\d{2}\./);
    const withReading = starts.filter((s) => s.portability);
    assert.ok(withReading.length >= 1);
    const copy = workingCopy({ about: withReading.at(-1), findings: r.findings, stage: "Step 3 of 5: Judging." });
    assert.ok(copy.portability, "the working copy carries the reading");
    assert.doesNotMatch(JSON.stringify(copy.portability), /"evidence"/, "never its evidence");
    assert.deepEqual(schemaProblems(copy, reportSchema()), []);
  });
});

test("[F6.A8] a working copy short of room leaves out the database's words first, then all of the reading, before any field the Overview draws", () => {
  const files = langgraphAgent();
  const { reading } = readOf(files);
  const about = { owner: "acme", name: "maker", url: "https://github.com/acme/maker", sha: "86d8f667796890eb6d3612dbd1b9e941782fe03f", checked: true, version: "0.6.0", started_at: "2026-11-27T19:00:00Z", portability: reading };
  const system = (i) => ({ id: `S5-${String(i).padStart(3, "0")}`, section: 5, kind: "system", title: `System ${i}`, says: "x".repeat(300), by: "model", evidence: [{ file: "a.py", line: 1 }], detail: { system: `System ${i}`, need: "optional", supply: "A key", without: "y".repeat(200) } });
  const sized = (n, limit) => workingCopy({ about, findings: Array.from({ length: n }, (_, i) => system(i + 1)), stage: "Done", limit });
  const full = sized(10, 60_000);
  assert.ok(full.portability && !full.portability.words_left_out);
  const roomy = JSON.stringify(sized(10, 1e9)).length;
  const lean = sized(10, roomy - 500);
  assert.ok(lean.portability?.words_left_out || !lean.findings[0].says, "the words go first");
  const tight = sized(10, JSON.stringify({ ...sized(10, 1e9), portability: undefined }).length - 2000);
  assert.ok(tight.findings.every((f) => f.detail?.need), "each system's need is kept while the reading gives way");
});

test("[F6.A2] a row says the sentence of its cell that names what the code uses, never one only the vendor's name matches", async () => {
  const { leadSentence } = await import("../scripts/platforms.mjs");
  const what = db.platforms.find((p) => p.id === "openai").categories.deployment.what;
  assert.match(leadSentence(what, ["OpenAI-Beta: chatkit_beta=v1"], ["openai", "OpenAI"]), /ChatKit/);
  assert.equal(leadSentence(what, ["nothing-it-names"], ["openai"]), what.split(/(?<=\.)\s(?=[A-Z])/)[0], "the first sentence when none names it");
});

test("[F6.A2] 0.6.3: a requirements file names frameworks; a type-only import is no use; a class kept in the agent's own memory reaches no service; a plugin's own manifests are its tools' format; the Markdown says a destination's deployment once", async () => {
  const { collectFacts } = await import("../scripts/collect.mjs");
  const req = { "python-backend/requirements.txt": "openai-agents\nopenai-chatkit\nfastapi\n", "python-backend/requirements-dev.txt": "crewai\n", "python-backend/agents.py": "from agents import Agent\n" };
  const fws = collectFacts({ files: filesOf(req), read: readerOf(req), bytesOf: () => null }).facts.filter((x) => x.kind === "framework").map((x) => x.data.framework);
  assert.deepEqual(fws, ["OpenAI Agents SDK"], "requirements.txt names the framework; a development requirements file does not");
  const { scriptImports } = await import("../scripts/platforms.mjs");
  // A type-only import is marked, and is no use of the module.
  assert.equal(scriptImports('import type { X } from "@anthropic-ai/claude-agent-sdk";\n')[0].type_only, true);
  assert.equal(scriptImports('import { type X, type Y } from "m";\n')[0].type_only, true);
  assert.equal(scriptImports('import { type X, y } from "m";\n')[0].type_only, undefined);
  const ts = { "package.json": "{\"devDependencies\":{\"@anthropic-ai/claude-agent-sdk\":\"^0.2.70\"}}\n", "hooks/src/inject.mts": 'import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";\nexport const x = 1;\n' };
  assert.equal(platformUses({ files: filesOf(ts), read: readerOf(ts), db }).present.has("anthropic"), false, "a type-only import shows no platform");
  // ADK's in-memory sessions: in the cell the database rates partly open, but no service.
  const adk = {
    "pyproject.toml": "[project]\nname = \"t\"\ndependencies = [\n  \"google-adk==2.13.0\",\n]\n",
    "bot/agent.py": "from google.adk.agents import LlmAgent\nroot_agent = LlmAgent(name='x')\n",
    "bot/run.py": "from google.adk import Runner\nfrom google.adk.sessions import InMemorySessionService, Session\nRunner(session_service=InMemorySessionService())\n",
  };
  const { reading } = readOf(adk, [{ framework: "Google ADK", package: "google-adk", file: "pyproject.toml", line: 4 }]);
  const mem = reading.uses.find((r) => r.category === "memory-and-state");
  assert.ok(mem, "memory is a row");
  assert.equal(mem.outside, false); assert.equal(mem.swap, "in-process");
  assert.ok(reading.destinations.every((d) => !d.swaps.includes("memory-and-state")), "nothing to swap");
  const vertex = { ...adk, "bot/run.py": "from google.adk.sessions import VertexAiSessionService\nVertexAiSessionService()\n" };
  assert.equal(readOf(vertex, [{ framework: "Google ADK", package: "google-adk", file: "pyproject.toml", line: 4 }]).reading.uses.find((r) => r.category === "memory-and-state").outside, true, "Vertex's sessions are a service");
  // A destination's deployment is its re-host line, never again as a cell.
  const { portabilityMarkdown } = await import("../scripts/report.mjs");
  const withDeploy = { ...reading, destinations: reading.destinations.map((d) => ({ ...d, cells: [...d.cells, { category: "deployment", title: "Deployment and scaling", rating: "native", what: "Runs it.", level: "proprietary" }] })) };
  const md = portabilityMarkdown({ portability: withDeploy, repository: "https://github.com/x/y", commit: { sha: "0123456789abcdef" } }).join("\n");
  assert.match(md, /on AgentMesh's deployment:/); assert.doesNotMatch(md, /for \*\*deployment and scaling\*\*/);
  // A plugin's manifests in its tools' own format.
  const files = claudePlugin();
  const found = platformUses({ files: filesOf(files), read: readerOf(files), db });
  const plugin = readingOf({ found, db, subject: { kind: "plugin", name: "helper", tools: ["Claude Code"], also_for: [] }, pluginParts: { manifests: [{ id: "F0100", kind: "plugin-manifest", file: ".claude-plugin/plugin.json", line: 2, data: { tool: "Claude Code" } }] } });
  const man = plugin.uses.find((r) => r.category === "manifests");
  assert.equal(man.level, "proprietary"); assert.match(man.sources[0].what, /Claude Code's own format/);
});
