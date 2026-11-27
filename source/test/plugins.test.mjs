// 0.5.0: Inspect reads plugin and skill repositories, not only agents.
//
// What is worth pinning: each shape is told by its own files (Agent Plugins
// 1.0.0, Claude Code, Cursor and Codex plugins, marketplaces of several, and
// skills alone), and an agent's repository is read exactly as before; of
// several plugins one is inspected, the one asked for or the first, with
// only its files, and the rest listed; what a plugin adds is a fact each
// (commands, sub-agents, rules, hooks, MCP servers, the keys it asks for);
// each hook says what starts it and what it runs, at a level by rule; an MCP
// server says where it runs and what the person supplies, and one fetched
// fresh each time is a risk; the report carries what it inspected, the
// working copy too, and the model is told where a plugin runs.
//
// Nothing here touches a network or a model: GitHub, OSV and the screening
// are stand-ins (helpers.mjs), and the model answers from the test.
//   node --test test/plugins.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { eventWords, hookLevel, pickPlugin, pinned, scopeOf, shapeOf } from "../scripts/plugin-facts.mjs";
import { firstPrompt, glancePrompt, secondPrompt, subjectLines, HOOK_WORDS } from "../scripts/judge.mjs";
import { markdownOf, workingCopy } from "../scripts/report.mjs";
import { readRequest } from "../scripts/request.mjs";
import { claudePlugin, ENV, inTemp, j, md, MIT, model, reportSchema, schemaProblems, smallAgent, world } from "./helpers.mjs";

const run = async (files, text = "repository: acme/helper\ncommit: 86d8f66", ask = model().ask) => inTemp((at) => inspect({ text, workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask }));
const read = (files) => (f) => (typeof files[f] === "string" ? files[f] : null);
const shape = (files) => shapeOf(Object.keys(files).sort(), read(files));

test("[F2.A8] each shape is told by its own files, and an agent's repository is read as one", () => {
  const cc = shape(claudePlugin());
  assert.equal(cc.kind, "plugin");
  assert.deepEqual(cc.plugins.map((p) => [p.name, p.root, [...p.tools].sort()]), [["helper", "", ["Claude Code", "Cursor"]]]);
  const open = shape({ "plugin.json": j({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "tidy" }), "skills/a/SKILL.md": md({ name: "a" }, "x"), "mcp.json": j({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { s: { type: "streamable-http", url: "https://s.acme.test/mcp" } } }), "com.acme.client/settings.json": "{}" });
  assert.equal(open.kind, "plugin");
  assert.deepEqual(open.plugins[0].tools, ["Agent Plugins"]);
  const codex = shape({ ".codex-plugin/plugin.json": j({ name: "cx", skills: "./skills/" }), "skills/a/SKILL.md": md({ name: "a" }, "x") });
  assert.deepEqual(codex.plugins[0].tools, ["Codex"]);
  assert.equal(shape({ "skills/a/SKILL.md": md({ name: "a" }, "x"), "skills/b/SKILL.md": md({ name: "b" }, "y"), "scripts/check.py": "print(1)\n" }).kind, "skills");
  assert.equal(shape({ "SKILL.md": md({ name: "solo" }, "x") }).kind, "skills");
  // Skills beside an agent's own code are the agent's: design-agent's shape.
  assert.equal(shape({ ...smallAgent(), "skills/a/SKILL.md": md({ name: "a" }, "x") }).kind, "agent");
  assert.equal(shape(smallAgent()).kind, "agent");
  // A Common Agent package is an agent, though its manifest is an Agent Plugin's.
  assert.equal(shape({ ...smallAgent(), "package/plugin.json": j({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "x", extensions: { "net.agentdoc.package": {} } }) }).kind, "agent");
});

test("[F1.A13] of several plugins, the one the request names, else the first, with only its files; one not there is refused", async () => {
  const files = {
    LICENSE: MIT,
    ".claude-plugin/marketplace.json": j({ name: "acme", owner: { name: "Acme" }, plugins: [{ name: "one", source: "./plugins/one", description: "The first." }, { name: "two", source: "./plugins/two" }, { name: "far", source: { source: "github", repo: "acme/far" } }] }),
    "plugins/one/.claude-plugin/plugin.json": j({ name: "one" }),
    "plugins/one/commands/hi.md": md({ description: "Says hi." }, "Hi."),
    "plugins/two/.claude-plugin/plugin.json": j({ name: "two" }),
    "plugins/two/commands/bye.md": md({ description: "Says bye." }, "Bye."),
    "plugins/two/package.json": j({ name: "two", dependencies: { leftpad: "1.0.0" } }),
  };
  const s = shape(files);
  assert.deepEqual(s.plugins.map((p) => [p.name, p.elsewhere ?? p.root]), [["one", "plugins/one"], ["two", "plugins/two"], ["far", "https://github.com/acme/far"]]);
  const first = pickPlugin(s, null, "acme/tools");
  assert.equal(first.plugin.name, "one");
  // The other plugins' manifests are kept, for the list of plugins to cite; none of their other files.
  assert.deepEqual(scopeOf(Object.keys(files), s, first.plugin).filter((f) => f.startsWith("plugins/two/")), ["plugins/two/.claude-plugin/plugin.json"], "only the first plugin's files are read");
  assert.equal(readRequest("repository: acme/tools\nplugin: two").plugin, "two");

  const out = await run(files, "repository: acme/helper");
  assert.equal(out.report.subject.name, "one");
  assert.equal(out.report.subject.picked_by, "first");
  const listed = out.report.findings.find((f) => f.kind === "plugins");
  assert.match(listed.says, /3 plugins: one \(1 skill|3 plugins: one \(0 skills, this report\), two \(0 skills\) and far \(kept in another repository\)/);
  assert.ok(out.report.findings.some((f) => f.kind === "slash-command" && /hi/i.test(f.title)) && !out.report.findings.some((f) => f.kind === "slash-command" && /bye/i.test(f.title)));
  assert.ok(out.report.findings.some((f) => f.kind === "could-not-tell" && f.title === "Plugins kept in other repositories"));

  const two = await run(files, "repository: acme/helper\nplugin: two");
  assert.equal(two.report.subject.name, "two");
  assert.equal(two.report.subject.picked_by, "request");
  assert.match(two.reply, /^plugin: two$/m);
  const none = await run(files, "repository: acme/helper\nplugin: nope");
  assert.equal(none.report, undefined);
  assert.match(none.reply, /no plugin named "nope".*one, two and far.*nothing was inspected/s);
  const far = await run(files, "repository: acme/helper\nplugin: far");
  assert.match(far.reply, /kept elsewhere, at https:\/\/github\.com\/acme\/far/);
});

test("[F2.A9] each command, sub-agent, hook, MCP server and key a plugin adds is a fact, and no setting's value is kept", async () => {
  const out = await run(claudePlugin());
  const r = out.report;
  const facts = (kind) => r.facts.filter((f) => f.kind === kind);
  const cmd = facts("slash-command")[0];
  assert.equal(cmd.data.shell, true, "a command that may run shell commands says so");
  assert.deepEqual(cmd.data.tools.sort(), ["Claude Code", "Cursor"]);
  assert.equal(facts("sub-agent")[0].data.name, "reviewer");
  assert.ok(facts("skill").find((f) => f.data.name === "inner").data.not_loaded, "a SKILL.md inside another skill is never loaded");
  assert.ok(!r.findings.some((f) => f.kind === "skill" && /inside a skill/i.test(f.title)));

  const hooks = facts("hook");
  assert.equal(hooks.length, 3, "the session-start hook both tools load is one hook");
  const start = hooks.find((h) => h.data.event === "SessionStart");
  assert.deepEqual(start.data.tools.sort(), ["Claude Code", "Cursor"]);
  assert.equal(start.data.trigger, "When a session starts or resumes");
  assert.deepEqual(start.data.files, ["hooks/start.mjs"]);
  assert.deepEqual(start.data.programs[0].hosts, ["telemetry.acme.test"], "what it imports is read too");
  assert.ok(start.data.programs[0].touches.includes("home-folder"));

  const servers = facts("mcp-server");
  const npx = servers.find((s) => s.data.name === "acme");
  assert.equal(npx.data.transport, "stdio");
  assert.equal(npx.data.package, "@acme/mcp-server");
  assert.equal(npx.data.pinned, false);
  assert.deepEqual(npx.data.env, ["ACME_TOKEN"]);
  assert.deepEqual(npx.data.settings, ["user_config.api_token"]);
  const docs = servers.find((s) => s.data.name === "docs");
  assert.equal(docs.data.host, "mcp.acme.test");
  assert.deepEqual(docs.data.headers, ["Authorization"]);
  assert.ok(!JSON.stringify(r).includes("docs-header-value-1234"), "a header's value is never kept");
  assert.ok(facts("user-config").some((f) => f.data.name === "api_token" && f.data.sensitive && f.data.required));
  assert.ok(facts("capability").some((f) => f.data.what === "credential-store" && f.file === "scripts/read-keys.sh"));
});

test("[F5.A7] the report says what it inspected and where it runs; hooks, fresh fetches and stored keys are risks by rule", async () => {
  const out = await run(claudePlugin());
  const r = out.report;
  assert.deepEqual(schemaProblems(r, reportSchema()), []);
  assert.equal(r.subject.kind, "plugin");
  assert.deepEqual(r.subject.tools, ["Claude Code", "Cursor"]);
  assert.equal(r.subject.author, "Acme");
  const what = r.findings.find((f) => f.kind === "subject");
  assert.match(what.says, /^A plugin for Claude Code and Cursor; version 1\.2\.0, made by Acme\. Once installed, it runs inside the person's own tool, on their machine, with their files and their credentials\.$/);

  const risk = (re) => r.findings.find((f) => f.section === 7 && re.test(f.title));
  const start = risk(/^Runs a JavaScript program when a session starts or resumes$/);
  assert.equal(start.level, "high");
  assert.equal(start.level_by, "rule");
  assert.match(start.says, /^In Claude Code and Cursor, it runs \d+ lines of code across 2 files on the person's machine with their access, without asking\. What it runs calls telemetry\.acme\.test\. It works in the person's home folder\.$/);
  assert.match(start.detail.safe, /managed settings can allow only the hooks a company approves/);
  assert.equal(risk(/^Asks a model before each shell command$/).level, "low");
  assert.equal(risk(/^Sends the session's events out after each file it writes$/).level, "high");
  assert.equal(risk(/^Starts the newest @acme\/mcp-server each time$/).level, "medium");
  const keys = risk(/stored credentials/);
  assert.equal(keys.level, "high");
  assert.match(keys.says, /AWS credentials/);
  // Nothing in a hook's words names a file.
  for (const f of r.findings.filter((x) => x.detail?.hook)) assert.ok(!/\.(?:mjs|json|sh)\b/.test(`${f.title} ${f.says}`), f.title);

  const mcp = r.findings.filter((f) => f.kind === "mcp-server");
  assert.deepEqual(mcp.map((f) => [f.title, f.detail.local, f.detail.supply ?? null]), [["Acme", true, "Your API token"], ["Docs", false, null]]);
  assert.match(mcp[1].says, /^Connects to mcp\.acme\.test, sending a key with each request\./);
  assert.ok(r.findings.some((f) => f.kind === "credential" && f.title === "Acme API token" && f.detail.need === "required"));
  assert.ok(r.findings.some((f) => f.kind === "could-not-tell" && /What the Docs connection can do/.test(f.title)));

  assert.match(out.reply, /^plugin: helper$/m);
  const text = markdownOf(r);
  assert.match(text, /A plugin for Claude Code and Cursor/);
  const copy = workingCopy({ about: { owner: "acme", name: "helper", url: "https://github.com/acme/helper", sha: r.commit.sha, subject: r.subject }, findings: r.findings, stage: "Step 3 of 5: Judging." });
  assert.deepEqual(copy.subject, r.subject, "the working copy says what is inspected while the job runs");
  assert.ok(copy.findings.find((f) => f.kind === "mcp-server").detail.supply === "Your API token");
});

test("[F2.A9] hooks: what starts each in words, its level by rule, and a pinned package", () => {
  assert.equal(eventWords("SessionStart", "startup|clear|compact"), "When a session starts, is cleared or is compacted");
  assert.equal(eventWords("PostToolUse", "Skill"), "After each skill it runs");
  assert.equal(eventWords("PreToolUse", "Write|Edit"), "Before each file it writes or file edit");
  assert.equal(eventWords("beforeShellExecution", ""), "Before each shell command");
  assert.equal(eventWords("UserPromptSubmit", ""), "Each time the person sends a message");
  assert.equal(hookLevel({ type: "command", programs: [{ hosts: [], touches: [] }] }).level, "medium");
  assert.equal(hookLevel({ type: "command", programs: [{ hosts: ["x.test"], touches: [] }] }).level, "high");
  assert.equal(hookLevel({ type: "command", programs: [{ hosts: [], touches: ["credential-store"] }] }).level, "high");
  assert.equal(hookLevel({ type: "command", runner: "npx", pinned: false, programs: [] }).level, "high");
  assert.equal(hookLevel({ type: "prompt" }).level, "low");
  assert.equal(hookLevel({ type: "http" }).level, "high");
  assert.equal(pinned("@acme/mcp@1.4.2"), true);
  assert.equal(pinned("@acme/mcp@latest"), false);
  assert.equal(pinned("@acme/mcp"), false);
  assert.equal(pinned("acme-mcp==2.0.1"), true);
});

test("[F2.A8] Cursor's rules, Codex's hooks and the open standard's folders", async () => {
  const cursor = await run({ LICENSE: MIT, ".cursor-plugin/plugin.json": j({ name: "styler", author: { name: "Acme" } }), "rules/style.mdc": md({ description: "Write in the house style.", alwaysApply: "true" }, "Use short sentences.") });
  const rule = cursor.report.findings.find((f) => f.kind === "rule");
  assert.equal(rule.detail.always, true);
  assert.deepEqual(cursor.report.subject.tools, ["Cursor"]);
  const codex = await run({ LICENSE: MIT, ".codex-plugin/plugin.json": j({ name: "cx" }), "hooks/hooks.json": j({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }) });
  const hook = codex.report.facts.find((f) => f.kind === "hook");
  assert.deepEqual(hook.data.tools, ["Codex"]);
  assert.ok(codex.report.findings.some((f) => f.kind === "could-not-tell" && /What a hook runs is not in the repository/.test(f.title)));
  const open = await run({ LICENSE: MIT, "plugin.json": j({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "tidy", extensions: { "com.acme.client": { x: 1 } } }), "skills/a/SKILL.md": md({ name: "a", description: "Tidies a file." }, "Tidy."), "mcp.json": j({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { s: { type: "streamable-http", url: "https://s.acme.test/mcp" } } }), "com.acme.client/hooks.json": "{}" });
  const m = open.report.facts.find((f) => f.kind === "plugin-manifest");
  assert.deepEqual(m.data.extension_folders, ["com.acme.client"]);
  assert.match(open.report.findings.find((f) => f.kind === "subject").says, /^A plugin for any tool that reads the Agent Plugins format\./);
  assert.ok(open.report.findings.some((f) => f.kind === "mcp-server" && f.detail.host === "s.acme.test"));
  const skills = await run({ LICENSE: MIT, "skills/a/SKILL.md": md({ name: "a", description: "Tidies a file." }, "Tidy."), "skills/b/SKILL.md": md({ name: "b", description: "Sorts a list." }, "Sort.") });
  assert.equal(skills.report.subject.kind, "skills");
  assert.match(skills.report.findings.find((f) => f.kind === "subject").says, /^2 skills on their own, with no plugin manifest/);
});

test("[F4.A11] the model is told where a plugin runs; an agent's prompts carry none of it; a risk only on hooks is held back, and each hook's words land on its risk", async () => {
  assert.deepEqual(subjectLines(null), []);
  const facts = "F0001 [skill] skills/a/SKILL.md:1";
  for (const make of [firstPrompt, secondPrompt]) {
    assert.equal(make(facts, { repo: "acme/helper" }), make(facts, { repo: "acme/helper", subject: null }));
    assert.ok(!/What it is:|"hooks"|employees may install/.test(make(facts, { repo: "acme/helper" })));
  }
  assert.ok(!/plugin/.test(glancePrompt([])));
  const subject = { kind: "plugin", name: "helper", tools: ["Claude Code"], also_for: [] };
  assert.match(firstPrompt(facts, { repo: "acme/helper", subject }), /What it is: a plugin for Claude Code, named helper\.\nOnce installed it runs inside the person's own tool, on their machine, with their files and their credentials/);
  assert.ok(firstPrompt(facts, { repo: "acme/helper", subject }).includes(HOOK_WORDS));
  assert.match(secondPrompt(facts, { repo: "acme/helper", subject }), /write no risk that rests only on hook facts/);
  assert.match(glancePrompt([], subject), /the description of the plugin/);

  const hookId = (prompt) => /\b(F\d{4,}) \[hook\] hooks\/hooks\.json/.exec(prompt)?.[1];
  const m = model([
    (prompt) => ({ text: JSON.stringify({ findings: [], skills: [], hooks: [{ hook: hookId(prompt), does: "Sends a note to Acme each time a session starts." }] }), tokens_in: 1, tokens_out: 1 }),
    (prompt) => ({ text: JSON.stringify({ findings: [{ section: 7, kind: "risk", title: "Start hook phones home", says: "It calls Acme.", based_on: [hookId(prompt)], level: "high", categories: ["ASI05"], detail: { safe: "Turn it off." } }] }), tokens_in: 1, tokens_out: 1 }),
  ]);
  const out = await run(claudePlugin(), undefined, m.ask);
  assert.ok(out.report.held_back.some((h) => h.title === "Start hook phones home" && /scripts' findings for those hooks/.test(h.why)));
  const start = out.report.findings.find((f) => f.detail?.hook?.event === "SessionStart");
  assert.deepEqual(start.detail.hook.does, ["Sends a note to Acme each time a session starts."]);
});
