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
import { guidanceOf, pinned } from "../scripts/guidance.mjs";
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

test("[F6.A4] 0.7.0: Run it in: one reading per harness of the catalogue, never AgentMesh; a line for each capability it uses, in the harness's own words; what running it there takes, by rule", () => {
  const files = langgraphAgent({ "src/maker/score.py": "from langsmith import Client\n\nclient = Client()\nclient.evaluate(lambda x: x)\n" });
  const { reading } = readOf(files);
  const h = reading.harnesses;
  assert.equal(h.length, db.harnesses.length, "every harness in the catalogue");
  assert.ok(h.length >= 17);
  assert.ok(!h.some((x) => /agentmesh/i.test(x.harness) || /AgentMesh/.test(x.name)), "AgentMesh is not a harness");
  assert.ok(!("destinations" in reading), "no destinations any more");
  const house = h.filter((x) => x.house_stack);
  assert.deepEqual(house.map((x) => x.harness), ["opencode"], "opencode is the House Stack's");
  for (const x of h) {
    const e = db.harnesses.find((y) => y.id === x.harness);
    for (const l of x.lines) {
      assert.ok(["kept", "partly", "lost", "unknown", "gained"].includes(l.state));
      const want = { yes: ["kept", "gained"], partial: ["partly"], no: ["lost"], unknown: ["unknown"] }[e.supports[l.capability].support];
      assert.ok(want.includes(l.state), `${x.name} ${l.capability}: ${l.state} from ${e.supports[l.capability].support}`);
    }
    assert.ok(x.takes.length > 10);
  }
  const caps = new Set(h[0].lines.map((l) => l.capability));
  assert.ok(caps.has("sandboxes"), "it uses LangChain's sandboxes");
  const sdk = h.find((x) => x.harness === "langsmith-agent-server");
  assert.match(sdk.takes, /^Built for it/, "the runtime of the platform it is built on");
  const cc = h.find((x) => x.harness === "claude-code");
  assert.match(cc.takes, /as a tool server Claude Code connects to/);
  const bedrock = h.find((x) => x.harness === "bedrock-agentcore");
  assert.match(bedrock.takes, /^Re-hosting its own code/);
  const gained = h.filter((x) => x.lines.some((l) => l.state === "gained"));
  assert.ok(gained.length > 0, "a harness with its own sandbox gains what LangChain's service gives today");
  for (const x of gained) assert.match(x.lines.find((l) => l.state === "gained").says, /in place of LangChain's service/);
});

test("[F6.A10] 0.7.0 (debt 939): a use of a mixed cell's open part reads open; its vendor's own part does not", () => {
  const open = readOf(langgraphAgent({ "src/maker/deep.py": "from deepagents import create_deep_agent\n\nagent = create_deep_agent(tools=[], skills=['./skills/'])\n" }));
  const pk = open.reading.uses.find((r) => r.category === "packaging");
  if (pk) {
    const lc = pk.sources.find((s) => s.platform === "langchain");
    if (lc) { assert.notEqual(lc.level, "mixed", "create_deep_agent's skills are Agent Skills"); assert.ok(lc.by_evidence); }
  }
  const tied = readOf(langgraphAgent({ "langgraph.json": "{\"graphs\": {\"a\": \"./src/maker/graph.py:graph\"}}\n" }));
  const dep = tied.reading.uses.find((r) => r.category === "packaging")?.sources.find((s) => s.platform === "langchain");
  if (dep) assert.equal(dep.level, "proprietary", "langgraph.json is LangChain's own");
});

test("[F6.A11] 0.7.0: the portability guidance's basics, by rule from the files: followed, missing, not known, or not applicable; unknown is never a guess", () => {
  const files = {
    "plugin.json": JSON.stringify({ name: "x", version: "1.0.0", description: "Does x.", keywords: ["x"] }),
    "skills/draft/SKILL.md": "---\nname: draft\ndescription: Drafts. Use when asked.\n---\nBody\n",
    ".mcp.json": JSON.stringify({ mcpServers: { crm: { type: "http", url: "https://mcp.example.com/crm" }, files: { command: "npx", args: ["-y", "@example/files-mcp"] } } }),
    "LICENSE": "MIT", "README.md": "# x",
    "package.json": JSON.stringify({ dependencies: { a: "^1.0.0" } }), "package-lock.json": "{}",
  };
  const g = guidanceOf({ all: Object.keys(files), read: (f) => files[f] ?? null, facts: [], portability: { uses: [] }, tags: null });
  const by = Object.fromEntries(g.basics.map((x) => [x.id, x]));
  assert.equal(by.plugin.state, "followed");
  assert.equal(by.skills.state, "followed");
  assert.equal(by.mcp.state, "missing", "npx without a version");
  assert.match(by.mcp.says, /files is fetched at start without a fixed version/);
  assert.equal(by.files.state, "missing");
  assert.equal(by.files.says, "No AGENTS.md");
  assert.equal(by.secrets.state, "followed");
  assert.equal(by.locks.state, "followed");
  assert.equal(by.release.state, "unknown", "GitHub did not say");
  assert.equal(by.samples.state, "missing");
  assert.equal(by.extras.state, "not-applicable");
  assert.equal(g.of, g.basics.filter((x) => x.state !== "not-applicable").length);
  assert.equal(g.followed, 4);
  assert.match(g.url, /portability-guidance-for-builders/);
  const tagged = guidanceOf({ all: Object.keys(files), read: (f) => files[f] ?? null, facts: [{ kind: "credential-shape", file: "a.py", line: 1, data: {} }], portability: { uses: [{ category: "agent-to-agent", outside: false }] }, tags: { count: 1 } });
  const t = Object.fromEntries(tagged.basics.map((x) => [x.id, x]));
  assert.equal(t.release.state, "followed");
  assert.equal(t.secrets.state, "missing");
  assert.deepEqual(tagged.extras.map((x) => [x.id, x.state]), [["a2a", "missing"]], "called by other agents with no card");
  assert.equal(pinned("@example/files-mcp@1.4.2"), true);
  assert.equal(pinned("@example/files-mcp@latest"), false);
  assert.equal(pinned("mcp-server-git==0.6.2"), true);
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
  for (const h of reading.harnesses) assert.ok(h.lines.every((l) => ["skills", "mcp", "plugins", "hooks"].includes(l.capability)), `${h.name}: only what a plugin uses`);
  assert.match(reading.harnesses.find((h) => h.harness === "claude-code").takes, /^Installs as it is, as a Claude Code plugin/);
  assert.match(reading.harnesses.find((h) => h.harness === "opencode").takes, /^Its skills load as they are; its Claude Code and Cursor manifest does not install there/);
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
    const at5 = md.indexOf("## Systems it uses"); const atMove = md.indexOf("## Portability"); const at6 = md.indexOf("## What it can do on its own");
    assert.ok(at5 > 0 && atMove > at5 && at6 > atMove, "after Systems it uses, before what it can do on its own");
    assert.match(md, /\[`src\/maker\/sandbox\.py:6`\]\(https:\/\/github\.com\/acme\/helper\/blob\/86d8f66\/src\/maker\/sandbox\.py#L6\)/);
    assert.match(md, /#### Claude Code/); assert.doesNotMatch(md, /#### AgentMesh/);
    assert.match(md, /Follows \d+ of \d+ basics in \[AgentMesh's portability guidance for builders\]\(https:\/\/agentmesh\.ai\/draft\/articles\/portability-guidance-for-builders\.html\)/);
    assert.equal(r.portability.guidance.basics.length, 9, "nine basics");
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
  // 0.7.0 (debt 939): ADK's own session classes are the open-source part of the cell, by their evidence.
  assert.equal(mem.outside, false); assert.ok(["in-process", "library"].includes(mem.swap), mem.swap);
  assert.ok(!reading.uses.filter((r) => r.outside).some((r) => r.category === "memory-and-state"), "nothing to swap");
  const vertex = { ...adk, "bot/run.py": "from google.adk.sessions import VertexAiSessionService\nVertexAiSessionService()\n" };
  assert.equal(readOf(vertex, [{ framework: "Google ADK", package: "google-adk", file: "pyproject.toml", line: 4 }]).reading.uses.find((r) => r.category === "memory-and-state").outside, true, "Vertex's sessions are a service");
  // 0.7.0: Run it in names each harness once, never AgentMesh, with what running it there takes.
  const { portabilityMarkdown } = await import("../scripts/report.mjs");
  const md = portabilityMarkdown({ portability: reading, repository: "https://github.com/x/y", commit: { sha: "0123456789abcdef" } }).join("\n");
  assert.match(md, /### Run it in/); assert.match(md, /#### opencode \(AgentMesh's House Stack runs agents in it\)/); assert.doesNotMatch(md, /#### AgentMesh/);
  assert.match(md, /#### Agent Runtime[^\n]*\n\n- What it takes: Built for it/);
  // A plugin's manifests in its tools' own format.
  const files = claudePlugin();
  const found = platformUses({ files: filesOf(files), read: readerOf(files), db });
  const plugin = readingOf({ found, db, subject: { kind: "plugin", name: "helper", tools: ["Claude Code"], also_for: [] }, pluginParts: { manifests: [{ id: "F0100", kind: "plugin-manifest", file: ".claude-plugin/plugin.json", line: 2, data: { tool: "Claude Code" } }] } });
  const man = plugin.uses.find((r) => r.category === "manifests");
  assert.equal(man.level, "proprietary"); assert.equal(man.sources[0].what, "Claude Code reads its own format.");
});
