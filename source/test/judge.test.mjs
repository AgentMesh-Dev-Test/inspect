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
import { checkDrafts, checkGlance } from "../scripts/checks.mjs";
import { judge, BUDGETS, CALL_TOKENS } from "../scripts/judge.mjs";
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
