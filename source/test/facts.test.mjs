// F2, reading the facts by rule.
//
// What is worth pinning: the settings and credentials a program reads are
// facts by name with their file and line, never a value; what a program
// reaches and starts is a fact; the agent's own parts (skills, models chosen
// by a setting, tools, the places it stops for a person, memory, install
// scripts) are facts of their own kinds; the lift-out rule, case by case; a
// committed credential is a place and a kind, never its characters; a long
// line gives its length rather than a cut of its text; and an archive with
// nothing to read still gets sections 2 and 8.
//
// Nothing here touches a network: GitHub and OSV are a fetch the test hands in.
//   node --test test/facts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFacts, TEXT_CHARS } from "../scripts/collect.mjs";
import { agentFacts } from "../scripts/agent-facts.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { ENV, inTemp, world, model, smallAgent } from "./helpers.mjs";

/** The facts of a codebase given as files, with no GitHub record. */
function factsOf(files) {
  const read = (f) => (f in files ? String(files[f]) : null);
  const bytesOf = (f) => (f in files ? Buffer.from(String(files[f])) : null);
  return collectFacts({ files: Object.keys(files).sort(), read, bytesOf, owner: "acme", name: "helper", sha: "0".repeat(40) }).facts;
}

test("[F2.A1] a credential the code reads is a fact by its name at its file and line, and no fact holds a value", () => {
  const lines = Array.from({ length: 11 }, (_, i) => `# line ${i + 1}`);
  lines.push('key = os.environ["ANTHROPIC_API_KEY"]');
  const facts = factsOf({ "src/app.py": `${lines.join("\n")}\n` });
  const f = facts.find((x) => x.kind === "setting" && x.data?.name === "ANTHROPIC_API_KEY");
  assert.ok(f, "the credential is a fact");
  assert.equal(f.file, "src/app.py");
  assert.equal(f.line, 12);
  assert.equal(f.data.credential, true);
  assert.ok(facts.every((x) => !("value" in (x.data ?? {}))), "no fact holds a variable's value");
  assert.match(f.id, /^F[0-9]{4,}$/);
});

test("[F2.A2] an address a program calls and a command it starts are facts with their file and line", () => {
  const facts = factsOf({ "bot/post.mjs": 'import { execFileSync } from "node:child_process";\nawait fetch("https://slack.com/api/chat.postMessage", { method: "POST" });\nexecFileSync("git", ["status"]);\n' });
  const addr = facts.find((x) => x.kind === "address" && x.data?.host === "slack.com");
  assert.ok(addr, "the address slack.com is a fact");
  assert.equal(addr.file, "bot/post.mjs");
  assert.equal(addr.line, 2);
  const cmd = facts.find((x) => x.kind === "command" && /git/.test(x.data?.command ?? ""));
  assert.ok(cmd, "the command git is a fact");
  assert.equal(cmd.line, 3);
});

test("[F2.A3] a skill, a model chosen by a setting, a tool, a stop for a person, a checkpointer and a postinstall script are facts of their own kinds", () => {
  const facts = factsOf({
    "skills/stills/SKILL.md": "---\nname: stills\ndescription: Makes still images on brand.\n---\n# Stills\n",
    "src/graph.py": [
      "import os",
      "from langgraph.checkpoint.memory import InMemorySaver",
      'model = init_chat_model(os.environ.get("AGENT_MODEL", "anthropic:claude-sonnet-5-5"))',
      "@tool",
      "def post_to_slack(text):",
      "    return text",
      'agent = create_deep_agent(tools=[post_to_slack], interrupt_on={"post_to_slack": True}, checkpointer=InMemorySaver())',
    ].join("\n"),
    "package.json": '{\n  "name": "helper",\n  "scripts": {\n    "postinstall": "node setup.js"\n  }\n}\n',
  });
  const one = (kind, pred = () => true) => facts.find((x) => x.kind === kind && pred(x));
  const skill = one("skill");
  assert.deepEqual([skill.file, skill.line, skill.data.name, skill.data.description], ["skills/stills/SKILL.md", 2, "stills", "Makes still images on brand."]);
  const m = one("model", (x) => x.data.match === "anthropic:claude-sonnet-5-5");
  assert.equal(m.line, 3);
  assert.equal(m.data.chosen_by, "setting");
  assert.deepEqual(m.data.settings, ["AGENT_MODEL"]);
  const t = one("tool", (x) => x.data.name === "post_to_slack");
  assert.equal(t.line, 4);
  assert.ok(one("human-step", (x) => x.data.match === "interrupt_on" && x.line === 7));
  assert.ok(one("memory", (x) => /InMemorySaver|checkpointer/.test(x.data.match)));
  const inst = one("install-script");
  assert.deepEqual([inst.file, inst.line, inst.data.script], ["package.json", 4, "postinstall"]);
});

test("[F2.A3] a skill's instructions that wait for the person's approval, and a question offering an approval, are steps where a person steps in", () => {
  const facts = factsOf({
    "skills/explainer/SKILL.md": "---\nname: explainer\n---\n# Explainer\n\n1. Draft the plan.\n2. Render only after the user approves the plan.\n",
    "src/pipeline.py": 'async def finish(ctx):\n    answer = await ctx.ask("Render the final?", [APPROVE, CHANGES])\n    return answer\n',
  });
  const steps = facts.filter((x) => x.kind === "human-step");
  const fromSkill = steps.find((x) => x.file === "skills/explainer/SKILL.md");
  assert.ok(fromSkill, "the skill's approval is a step");
  assert.equal(fromSkill.line, 7);
  assert.equal(fromSkill.data.in, "instructions");
  const fromCode = steps.find((x) => x.file === "src/pipeline.py");
  assert.ok(fromCode, "the question offering an approval is a step");
  assert.equal(fromCode.line, 2);
});

test("[F2.A4] which parts can be lifted out: its own folder and the language's modules, no credential, no package at run time", () => {
  const files = {
    "tools/lint.mjs": '#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nimport { dir } from "./helpers.mjs";\nconsole.log(readFileSync(dir));\n',
    "tools/helpers.mjs": 'export const dir = process.env.LINT_DIR || "/tmp/lint";\n',
    "skills/render/SKILL.md": "---\nname: render\n---\n",
    "skills/render/scripts/render.mjs": 'import { shared } from "../../../src/shared.mjs";\nshared();\n',
    "src/shared.mjs": "export const shared = () => 1;\n",
    "tools/report.mjs": '#!/usr/bin/env node\nconst key = process.env.REPORT_API_KEY;\nconsole.log(Boolean(key));\n',
    "tools/load.mjs": '#!/usr/bin/env node\nconst name = process.argv[2];\nconst mod = await import(name);\nconsole.log(mod);\n',
  };
  const read = (f) => (f in files ? files[f] : null);
  const entries = ["tools/lint.mjs", "tools/report.mjs", "tools/load.mjs"].map((file) => ({ file, evidence: [{ file, line: 1 }] }));
  const { facts } = agentFacts(Object.keys(files).sort(), read, { entries });
  const part = (path) => facts.find((x) => x.kind === "part" && (x.file === path || x.data.folder === path));
  const lint = part("tools/lint.mjs");
  assert.equal(lint.data.lift_out, "yes");
  assert.deepEqual(lint.data.files, ["tools/helpers.mjs", "tools/lint.mjs"]);
  assert.deepEqual(lint.data.settings.map((s) => s.name), ["LINT_DIR"]);
  const render = part("skills/render");
  assert.equal(render.data.lift_out, "no");
  assert.ok(render.data.keeps.some((k) => k.spec === "../../../src/shared.mjs"));
  const report = part("tools/report.mjs");
  assert.equal(report.data.lift_out, "no");
  assert.ok(report.data.keeps.some((k) => k.spec === "REPORT_API_KEY"));
  const load = part("tools/load.mjs");
  assert.equal(load.data.lift_out, "no");
  assert.ok(load.data.keeps.some((k) => /run time/.test(k.why) && k.line === 3));
});

test("[F2.A5] a committed key is a place and a kind, and its characters are in neither the facts nor the report", async () => {
  // Made here, so this file carries no key of its own.
  const key = ["AK", "IA", "Q".repeat(16)].join("");
  const files = smallAgent({ "config/dev.env": `REGION=us\nNAME=helper\nAWS_ACCESS_KEY_ID=${key}\n` });
  const facts = factsOf(files);
  const f = facts.find((x) => x.kind === "credential-shape");
  assert.deepEqual([f.file, f.line, f.data.what], ["config/dev.env", 3, "an AWS access key"]);
  assert.equal(f.text, undefined, "the line keeps no text");
  assert.ok(!JSON.stringify(facts).includes(key));
  await inTemp(async (at) => {
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model().ask });
    assert.ok(!JSON.stringify(out.report).includes(key), "the report does not repeat the key");
    assert.ok(!out.reply.includes(key));
    assert.ok(out.report.findings.some((x) => x.section === 7 && /config\/dev\.env/.test(x.title)));
  });
});

test("[F2.A6] a line longer than 400 characters gives its length, 900, and no part of its text", () => {
  assert.equal(TEXT_CHARS, 400);
  const long = `x = "${"a".repeat(892)}" # ANTHROPIC_API_KEY`;
  const line = `${long.slice(0, 860)}os.environ["SOME_TOKEN"]`.padEnd(900, " ");
  assert.equal(line.length, 900);
  const facts = factsOf({ "src/long.py": `${line}\n` });
  const f = facts.find((x) => x.file === "src/long.py" && x.kind === "setting");
  assert.equal(f.long_line, 900);
  assert.equal(f.text, undefined);
});

test("[F2.A7] an archive whose only file is a picture still gets sections 2 and 8, and 8 says there was no code to read", async () => {
  await inTemp(async (at) => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const m = model();
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files: { "logo.png": png } }).fetchImpl, ask: m.ask });
    const sections = new Set(out.report.findings.map((f) => f.section));
    assert.ok(sections.has(2) && sections.has(8));
    assert.ok(out.report.findings.some((f) => f.section === 8 && /no code to read/.test(`${f.title} ${f.says}`)));
    assert.equal(m.asked.length, 0, "no model is asked about a codebase with nothing to read");
  });
});
