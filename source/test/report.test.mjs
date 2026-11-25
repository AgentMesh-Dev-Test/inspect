// F5, the report.
//
// What is worth pinning: the report fits its own published schema
// (inspection-report-v1, read from the package's descriptor), its findings
// run in section order and each cites evidence or, where its fact is in no
// file, a source; section 2 is written by the scripts; every finding passes
// the one emitter with its report id; the reply's header, its At a glance and
// its counts, with both pieces attached; and the two asks Inspect never acts
// on, running the code and giving a verdict, are said and the report still
// delivered.
//
// Nothing here touches a network or a model: GitHub, OSV and the model are
// functions the test hands in.
//   node --test test/report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect, writeOutputs } from "../scripts/inspect-a-repository.mjs";
import { createEmitter } from "../scripts/emit.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { ENV, inTemp, world, model, smallAgent, reportSchema, schemaProblems } from "./helpers.mjs";

const glanceOf = (ids) => (prompt) => ({ text: JSON.stringify({ glance: ids.filter((id) => prompt.includes(id)).map((id) => ({ repeats: id, says: `Finding ${id} matters.` })) }) });
const run = (text, { files = smallAgent(), answers = [], onFinding, ...w } = {}) => inTemp(async (at) => ({ at, ...(await inspect({ text, workDir: at, env: ENV, fetchImpl: world({ files, ...w }).fetchImpl, ask: model(answers).ask, onFinding })) }));

test("[F5.A1] the report fits the inspection-report-v1 schema, runs from section 1 to 8, and each finding has evidence or, in no file, a source", async () => {
  const out = await run("repository: acme/helper\ncommit: 86d8f66", { answers: [undefined, undefined, glanceOf(["S2-004"])], links: { ".claude/skills": "../skills" } });
  assert.equal(out.report.format, "inspection-report-v1");
  assert.deepEqual(schemaProblems(out.report, reportSchema()), []);
  const sections = out.report.findings.map((f) => f.section);
  assert.deepEqual(sections, [...sections].sort((a, b) => a - b));
  for (const f of out.report.findings) assert.ok((f.evidence?.length ?? 0) > 0 || (f.source?.length ?? 0) > 0, `${f.id} cites something`);
  const fileless = out.report.findings.filter((f) => !f.evidence?.length);
  assert.ok(fileless.every((f) => f.source.every((s) => ["code-host", "vulnerability-database", "text-reasoning"].includes(s.system))));
  for (const f of out.report.findings.filter((x) => x.section !== 2 && x.evidence?.length)) for (const e of f.evidence) assert.ok(e.file && e.line >= 1);
});

test("[F5.A2] section 2 holds the publisher, Apache-2.0 citing LICENSE line 1, Python, langgraph and the last push, each by the scripts", async () => {
  const out = await run("repository: acme/helper\ncommit: 86d8f66");
  const s2 = out.report.findings.filter((f) => f.section === 2);
  assert.ok(s2.length >= 6);
  assert.ok(s2.every((f) => f.by === "script"));
  const kind = (k) => s2.find((f) => f.kind === k);
  assert.match(kind("publisher").says, /acme, a GitHub organization/);
  const lic = kind("license");
  assert.match(lic.says, /Apache-2\.0/);
  assert.ok(lic.evidence.some((e) => e.file === "LICENSE" && e.line === 1));
  assert.deepEqual(lic.categories, [{ list: "spdx-license-list", id: "Apache-2.0", name: "Apache-2.0" }]);
  const built = kind("built-on");
  assert.match(built.says, /Python/);
  assert.match(built.says, /LangGraph/);
  assert.ok(built.evidence.some((e) => e.file === "pyproject.toml"));
  assert.match(kind("activity").says, /Last pushed 2026-11-23/);
  assert.match(kind("activity").says, /72 commits in the 90 days/);
  assert.ok(kind("repository").source.length && kind("commit").source.length);
});

test("[F5.A3] every finding passes the one emitter once, with the id it has in the report, in the order found", async () => {
  const heard = [];
  const out = await run("repository: acme/helper\ncommit: 86d8f66", { onFinding: (f) => heard.push(f), answers: [undefined, undefined, glanceOf(["S2-004"])] });
  assert.equal(heard.length, out.report.findings.length);
  assert.deepEqual([...heard.map((f) => f.id)].sort(), out.report.findings.map((f) => f.id).sort());
  assert.equal(heard.at(-1).section, 1, "section 1 is found last");
  const e = createEmitter();
  const a = e.emitFinding({ section: 7, title: "a" }); const b = e.emitFinding({ section: 2, title: "b" }); const c = e.emitFinding({ section: 7, title: "c" });
  assert.deepEqual([a.id, b.id, c.id], ["S7-001", "S2-001", "S7-002"]);
  assert.deepEqual(e.findings().map((f) => f.id), ["S2-001", "S7-001", "S7-002"]);
});

test("[F5.A4] the reply opens with its header, gives section 1's findings one to a line, then the counts, and both pieces are attached", async () => {
  const out = await run("repository: acme/helper\ncommit: 86d8f66", { answers: [undefined, undefined, glanceOf(["S2-004", "S2-005", "S2-006"])] });
  const lines = out.reply.split("\n");
  assert.deepEqual(lines.slice(0, 4).map((l) => l.split(":")[0]), ["repository", "commit", "findings", "held_back"]);
  const at = lines.indexOf("## At a glance");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 4), ["- Finding S2-004 matters. (S2-004)", "- Finding S2-005 matters. (S2-005)", "- Finding S2-006 matters. (S2-006)"]);
  assert.ok(lines.includes("## Sections"));
  assert.ok(lines.some((l) => /^7\. Risks, and what it needs to run safely: \d+ findings?$/.test(l)));
  assert.match(out.reply, /\d+ judgments? held back/);
  await inTemp(async (job) => {
    writeOutputs(job, out);
    assert.ok(existsSync(join(job, "out", "inspection.json")) && existsSync(join(job, "out", "sbom.cdx.json")));
    const pieces = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(pieces.map((p) => p.name), ["inspection", "sbom"]);
    assert.deepEqual(checkDelivered(job), []);
  });
});

test("[F5.A5] asked to install it and run its tests, Inspect says it only reads the code and runs nothing", async () => {
  const w = world({ files: smallAgent() });
  await inTemp(async (at) => {
    const out = await inspect({ text: "Install acme/helper at 86d8f66 and run its tests.\nrepository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: w.fetchImpl, ask: model().ask });
    assert.match(out.reply, /Inspect only reads the code/);
    assert.ok(out.report, "the inspection is still done");
    assert.ok(w.calls.every((c) => c.method === "GET" || c.url.endsWith("/v1/querybatch")), "nothing but reads went out");
  });
});

test("[F5.A6] asked whether to bring it in, the reply says Inspect gives no verdict and judges no fit, and the report is attached", async () => {
  const out = await run("Should we bring acme/helper at 86d8f66 into the department?\nrepository: acme/helper\ncommit: 86d8f66");
  assert.match(out.reply, /Inspect gives no verdict and judges no fit/);
  assert.ok(out.report);
  await inTemp(async (job) => { writeOutputs(job, out); assert.ok(existsSync(join(job, "out", "inspection.json"))); });
});
