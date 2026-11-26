// F4, the judgments.
//
// What is worth pinning: a judgment is a finding only when it cites facts the
// scripts found and their evidence checks against the commit; one that cites
// nothing real, guesses in a precise section, lacks a level or a listed
// category, or gives a verdict is held back with why; the model is given the
// facts whole, every call has an output budget, and a job makes up to three
// calls; section 1 is written last, five at most, each repeating a finding;
// and a model that fails or stops at its budget leaves the scripts' findings
// standing, with each section it would have judged saying why it was not.
//
// Nothing here touches a network or a model: the model is an ask function
// the test hands in.
//   node --test test/judge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFor } from "../scripts/evidence.mjs";
import { checkDrafts, checkGlance, notPlain } from "../scripts/checks.mjs";
import { judge, BUDGETS, CALL_TOKENS, PLAIN_RULE, firstPrompt, secondPrompt, glancePrompt } from "../scripts/judge.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { ENV, inTemp, world, model, modelFailure, smallAgent } from "./helpers.mjs";

const lines = (n, at) => Array.from({ length: n }, (_, i) => at[i + 1] ?? `# line ${i + 1}`).join("\n");
const TOOLS = lines(70, { 40: "def run_shell(cmd): return subprocess.run(cmd, shell=True)", 61: "def read_page(url): return httpx.get(url).text" });
const FILES = { "src/tools.py": TOOLS, "src/memory.py": lines(10, { 3: "saver = InMemorySaver()" }) };
const read = (f) => FILES[f] ?? null;
const ctx = contextFor({ files: Object.keys(FILES), read });
const facts = [
  { id: "F0007", kind: "capability", file: "src/tools.py", line: 40, data: { what: "shell" } },
  { id: "F0012", kind: "tool", file: "src/tools.py", line: 61, data: { match: "read_page" } },
  { id: "F0020", kind: "memory", file: "src/memory.py", line: 3, data: { match: "InMemorySaver" } },
];
const byId = new Map(facts.map((f) => [f.id, f]));
const risk = (over = {}) => ({ section: 7, kind: "risk", title: "A web page can reach the shell", says: "The page reader's text reaches the model that can run the shell tool.", based_on: ["F0007", "F0012"], level: "high", categories: ["LLM01:2025"], ...over });

test("[F4.A1] a judgment citing two facts is delivered with their evidence, lines 40 and 61, its level and its category", () => {
  const { kept, held } = checkDrafts([risk()], { sections: [6, 7, 8], byId, ctx });
  assert.deepEqual(held, []);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].evidence.map((e) => `${e.file}:${e.line}`), ["src/tools.py:40", "src/tools.py:61"]);
  assert.equal(kept[0].level, "high");
  assert.deepEqual(kept[0].categories, [{ list: "owasp-top-10-llm-2025", id: "LLM01:2025", name: "Prompt Injection" }]);
  assert.equal(kept[0].by, "model");
});

test("[F4.A1] the model is given every fact whole, each call has an output budget, and a job makes up to three calls", async () => {
  const m = model();
  const j = await judge({ facts, repo: "acme/helper", ask: m.ask });
  await j.glance([]);
  assert.equal(m.asked.length, 3);
  for (const id of ["F0007", "F0012", "F0020"]) for (const a of m.asked.slice(0, 2)) assert.ok(a.prompt.includes(id), `the prompt carries ${id}`);
  assert.deepEqual(m.asked.map((a) => a.options.maxOutputTokens), [BUDGETS.first, BUDGETS.second, BUDGETS.glance]);
  assert.ok(m.asked.every((a) => a.options.maxOutputTokens > 0));
});

test("[F4.A2] a judgment citing F9999, which the scripts did not find, is held back with the reason", () => {
  const { kept, held } = checkDrafts([risk({ based_on: ["F9999"] })], { sections: [6, 7, 8], byId, ctx });
  assert.equal(kept.length, 0);
  assert.equal(held.length, 1);
  assert.match(held[0].why, /F9999, which the scripts did not find/);
  const none = checkDrafts([risk({ based_on: [] })], { sections: [6, 7, 8], byId, ctx });
  assert.match(none.held[0].why, /cites no fact/);
  const outside = checkDrafts([risk({ based_on: ["F0099"] })], { sections: [6, 7, 8], byId: new Map([["F0099", { id: "F0099", kind: "tool", file: "src/tools.py", line: 999 }]]), ctx });
  assert.match(outside.held[0].why, /evidence checks against the commit/);
});

test("[F4.A3] a judgment of section 4 that says the agent probably keeps memory is held back because it infers", () => {
  const { kept, held } = checkDrafts([{ section: 4, kind: "memory", title: "Memory", says: "It probably keeps memory between jobs.", based_on: ["F0020"] }], { sections: [3, 4, 5], byId, ctx });
  assert.equal(kept.length, 0);
  assert.match(held[0].why, /infers \("probably"\)/);
  const judged = checkDrafts([{ section: 5, kind: "system", title: "Slack", says: "It should not post to Slack.", based_on: ["F0012"] }], { sections: [3, 4, 5], byId, ctx });
  assert.match(judged.held[0].why, /judges/);
});

test("[F4.A4] a risk with the category Bad Vibes is held back, and one with no level is too", () => {
  const bad = checkDrafts([risk({ categories: ["Bad Vibes"] })], { sections: [6, 7, 8], byId, ctx });
  assert.equal(bad.kept.length, 0);
  assert.match(bad.held[0].why, /no published list/);
  const noLevel = checkDrafts([risk({ level: "spicy" })], { sections: [6, 7, 8], byId, ctx });
  assert.match(noLevel.held[0].why, /none, low, medium, high, critical/);
  const agentic = checkDrafts([risk({ categories: ["ASI10"] })], { sections: [6, 7, 8], byId, ctx });
  assert.equal(agentic.kept[0].categories[0].name, "Rogue Agents");
});

test("[F4.A5] a judgment that says it is safe to bring this agent in is held back", () => {
  const { kept, held } = checkDrafts([{ section: 7, kind: "least-access", title: "Verdict", says: "It is safe to bring this agent in.", based_on: ["F0007"] }], { sections: [6, 7, 8], byId, ctx });
  assert.equal(kept.length, 0);
  assert.match(held[0].why, /verdict/);
});

test("[F4.A5] a judgment with code, a file, a command, an advisory id or the word facts in its words is held back; the model is told so", () => {
  const breaks = [
    ["The list of tools in `interrupt_on` is empty.", "backquotes"],
    ["It reads the key in src/tools.py.", "a file name"],
    ["The approval list interrupt_on is empty.", "a name with an underscore"],
    ["Skill scripts run npm install while working.", "a command line"],
    ["It fetches pull requests through gh.", "a command line"],
    ["The loader falls back to @latest.", "a version tag"],
    ["It depends on a package with GHSA-jpvv-r467-5p4w.", "an advisory id"],
    ["It repeats S7-010 in other words.", "a finding code"],
  ];
  for (const [says, what] of breaks) {
    const { kept, held } = checkDrafts([risk({ says })], { sections: [6, 7, 8], byId, ctx });
    assert.equal(kept.length, 0, `held back: ${says}`);
    assert.match(held[0].why, new RegExp(`^it puts ${what.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")} in its words`));
  }
  const plain = checkDrafts([risk({ title: "Outside content can reach shell actions", says: "Slack posts and fetched pages reach a model that can run commands in a sandbox without a person's OK." })], { sections: [6, 7, 8], byId, ctx });
  assert.equal(plain.kept.length, 1, "plain words are kept");
  assert.equal(notPlain("It posts to Slack, e.g. a summary of each run."), null, "ordinary words are plain");
  assert.equal(notPlain("Skill scripts fetch packages from npm while working."), null, "a registry said in passing is plain");
  for (const { why } of checkDrafts([risk({ says: "It reads src/tools.py." })], { sections: [6, 7, 8], byId, ctx }).held) assert.ok(!/src\/tools|"/.test(why), "why quotes none of the words it holds back");
  // Inspect's own word is said as a person would, and the judgment is kept (0.2.7).
  const said = checkDrafts([risk({ title: "The facts show an empty approval list", says: "The facts do not show which calls need an OK." })], { sections: [6, 7, 8], byId, ctx });
  assert.equal(said.kept.length, 1);
  assert.equal(said.kept[0].title, "The code shows an empty approval list");
  assert.equal(said.kept[0].says, "The code does not show which calls need an OK.");
  assert.match(PLAIN_RULE, /say the code shows/);
  assert.match(PLAIN_RULE, /for a manager, in plain words/);
  assert.match(firstPrompt("", { repo: "x" }) + secondPrompt("", { repo: "x" }), /./);
  assert.match(glancePrompt([]), /for a manager, in plain words/);
});

test("[F4.A6] section 1 comes last and holds five findings when the model picks seven, each naming the finding it repeats and carrying its evidence", () => {
  const findings = Array.from({ length: 7 }, (_, i) => ({ id: `S7-00${i + 1}`, section: 7, kind: "risk", title: `Risk ${i + 1}`, says: "x", based_on: ["F0007"], evidence: [{ file: "src/tools.py", line: 40 }], level: "medium" }));
  const drafts = findings.map((f) => ({ repeats: f.id, says: `${f.title} matters.` }));
  const { kept, held } = checkGlance(drafts, findings);
  assert.equal(kept.length, 5);
  assert.deepEqual(kept.map((k) => k.repeats), ["S7-001", "S7-002", "S7-003", "S7-004", "S7-005"]);
  assert.ok(kept.every((k) => k.section === 1 && k.evidence?.length === 1));
  assert.equal(held.length, 2);
});

test("[F4.A6] in a report, section 1 is asked for after the other sections are checked", async () => {
  await inTemp(async (at) => {
    let seen = null;
    const m = model([undefined, undefined, (prompt) => { seen = prompt; return { text: JSON.stringify({ glance: [{ repeats: "S2-004", says: "It is licensed Apache-2.0." }] }) }; }]);
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files: smallAgent() }).fetchImpl, ask: m.ask });
    assert.match(seen, /S2-004/);
    const g = out.report.findings.filter((f) => f.section === 1);
    assert.equal(g.length, 1);
    assert.equal(g[0].repeats, "S2-004");
    assert.equal(out.report.findings[0].section, 1, "section 1 leads the report");
  });
});

test("[F4.A7] the model stopping at its budget leaves the scripts' findings, and sections 6 and 7 say the judgment was not made", async () => {
  await inTemp(async (at) => {
    const m = model([undefined, modelFailure("the model's answer stopped at its output budget of 24000 tokens, so it is not read as whole")]);
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files: smallAgent() }).fetchImpl, ask: m.ask });
    assert.ok(out.report, "the report is delivered");
    assert.ok(out.report.findings.some((f) => f.by === "script" && f.section === 2));
    for (const s of [6, 7]) {
      const nj = out.report.findings.find((f) => f.section === s && f.kind === "not-judged");
      assert.ok(nj, `section ${s} says it was not judged`);
      assert.match(nj.says, /was not made/);
      assert.match(nj.says, /output budget/);
    }
  });
});

test("[F4.A7] a call whose facts are more than one call can take is not made, and its sections say so", async () => {
  const big = Array.from({ length: 4000 }, (_, i) => ({ id: `F${String(i + 1).padStart(4, "0")}`, kind: "capability", file: "src/tools.py", line: 40, text: "x".repeat(400) }));
  const m = model();
  const j = await judge({ facts: big, repo: "acme/helper", ask: m.ask });
  assert.ok(j.second.failed, "the call was not made");
  assert.match(j.second.failed, new RegExp(`more than the ${CALL_TOKENS.toLocaleString("en-US")} one call can take`));
});

// 0.4.0: whether a person must supply a system is decided by rule from the
// setting facts, so two runs of the same commit agree however the model
// answers; the model's answer stands only where the facts leave it unclear.
test("[F4.A8] Required or Optional comes from the setting facts by rule, the same whatever the model says; the model's answer stands only where the facts don't settle it", async () => {
  const { settingNeed } = await import("../scripts/collect.mjs");
  const APP = lines(30, { 4: 'token = os.environ["SLACK_BOT_TOKEN"]', 9: 'if not os.getenv("LANGSMITH_API_KEY"):', 10: "    return", 14: 'model = os.getenv("ANTHROPIC_API_KEY")', 20: 'region = os.getenv("AWS_REGION", "us-east-1")' });
  const TTS = lines(10, { 3: "const key = process.env.ELEVENLABS_API_KEY;", 4: 'if (!key) throw new Error("no key");' });
  const README = lines(10, { 5: "Set ANTHROPIC_API_KEY to your Anthropic key." });
  const files = { "src/app.py": APP, "skills/voice/scripts/tts.mjs": TTS, "README.md": README, "skills/voice/SKILL.md": lines(5, {}) };
  const sctx = contextFor({ files: Object.keys(files), read: (f) => files[f] ?? null });
  const sfacts = [
    { id: "F0101", kind: "setting", file: "src/app.py", line: 4, data: { name: "SLACK_BOT_TOKEN", credential: true, how: "fails" } },
    { id: "F0102", kind: "setting", file: "src/app.py", line: 9, data: { name: "LANGSMITH_API_KEY", credential: true, how: "guard" } },
    { id: "F0103", kind: "setting", file: "src/app.py", line: 14, data: { name: "ANTHROPIC_API_KEY", credential: true, how: "plain" } },
    { id: "F0104", kind: "setting", file: "skills/voice/scripts/tts.mjs", line: 3, data: { name: "ELEVENLABS_API_KEY", credential: true, how: "fails" } },
    { id: "F0105", kind: "setup-doc", file: "README.md", line: 5, data: { name: "ANTHROPIC_API_KEY", says: "mentioned" } },
    { id: "F0106", kind: "skill", file: "skills/voice/SKILL.md", line: 1, data: { name: "voice", folder: "skills/voice" } },
    { id: "F0107", kind: "setting", file: "src/app.py", line: 20, data: { name: "AWS_REGION", credential: false, how: "default" } },
    { id: "F0108", kind: "address", file: "skills/voice/scripts/tts.mjs", line: 4, data: { host: "api.paper.design", called: true } },
  ];
  const sById = new Map(sfacts.map((f) => [f.id, f]));
  const system = (name, based_on, need, credentials = []) => ({ section: 5, kind: "system", title: `${name}: what it is used for`, says: `It reaches ${name}.`, based_on, detail: { system: name, need, supply: `Your ${name} key`, credentials } });
  const needsOf = (modelSays) => {
    const drafts = [
      system("Slack", ["F0101"], modelSays.slack),
      system("LangSmith", ["F0102"], modelSays.langsmith),
      system("ElevenLabs", ["F0106"], modelSays.eleven, ["ELEVENLABS_API_KEY"]),
      system("Anthropic", ["F0103", "F0105"], modelSays.anthropic),
      system("AWS", ["F0107"], modelSays.aws),
      system("Paper", ["F0106", "F0108"], modelSays.paper),
    ];
    const { kept, held } = checkDrafts(drafts, { sections: [3, 4, 5], byId: sById, ctx: sctx });
    assert.deepEqual(held, []);
    return Object.fromEntries(kept.map((f) => [f.detail.system, [f.detail.need, f.detail.need_by]]));
  };
  const one = needsOf({ slack: "optional", langsmith: "required", eleven: "required", anthropic: "required", aws: "required", paper: "required" });
  const two = needsOf({ slack: "unclear", langsmith: "unclear", eleven: "optional", anthropic: "optional", aws: "optional", paper: "unclear" });
  const settled = ["Slack", "LangSmith", "ElevenLabs", "AWS", "Paper"];
  for (const s of settled) assert.deepEqual(one[s], two[s], `${s} is the same in both runs`);
  assert.deepEqual(one.Slack, ["required", "rule"], "the code stops without its token");
  assert.deepEqual(one.LangSmith, ["optional", "rule"], "the code leaves out tracing without its key");
  assert.deepEqual(one.ElevenLabs, ["optional", "rule"], "only the skill that uses it reads its key, so the agent runs without it");
  assert.deepEqual(one.AWS, ["optional", "rule"], "the code has a default");
  assert.deepEqual(one.Paper, ["optional", "rule"], "it reads no setting, and only a skill reaches it");
  assert.deepEqual([one.Anthropic, two.Anthropic], [["required", "model"], ["optional", "model"]], "read plainly with no word from the docs: the facts leave it unclear, so the model's answer stands");
  const required = (n) => Object.values(n).filter(([need]) => need === "required").length;
  assert.equal(required(Object.fromEntries(settled.map((s) => [s, one[s]]))), required(Object.fromEntries(settled.map((s) => [s, two[s]]))));
  // One setting, by rule: the docs and the example settings file settle a plain read.
  const plain = (extra) => settingNeed("X_KEY", [{ id: "F1", kind: "setting", file: "src/a.py", line: 1, data: { name: "X_KEY", how: "plain" } }, ...extra]);
  assert.equal(plain([{ kind: "setup-doc", data: { name: "X_KEY", says: "required" } }]).need, "required");
  assert.equal(plain([{ kind: "setup-doc", data: { name: "X_KEY", says: "optional" } }]).need, "optional");
  assert.equal(plain([{ kind: "example-setting", data: { name: "X_KEY", commented: true } }]).need, "optional");
  assert.equal(plain([{ kind: "example-setting", data: { name: "X_KEY", commented: false } }]).need, "unclear");
  assert.equal(settingNeed("X_KEY", [{ kind: "setting", file: "tests/test_a.py", data: { name: "X_KEY", how: "fails", in_test: true } }]), null, "a setting only its tests read is never needed to run it");
});

test("[F4.A8] a credential no system names carries its need by the same rule, so the view draws it the same in every run", async () => {
  await inTemp(async (at) => {
    const files = smallAgent({ "src/keys.py": 'import os\nkey = os.environ["GEMINI_API_KEY"]\nopt = os.getenv("POSTHOG_API_KEY")\nif not opt:\n    pass\n' });
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model().ask });
    const cred = (env) => out.report.findings.find((f) => f.kind === "credential" && f.detail?.env === env);
    assert.deepEqual([cred("GEMINI_API_KEY").detail.need, cred("GEMINI_API_KEY").detail.need_by], ["required", "rule"]);
    assert.equal(cred("POSTHOG_API_KEY").detail.need, "optional");
  });
});
