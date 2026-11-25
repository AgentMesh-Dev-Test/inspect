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
import { createEmitter, liveUpdates, pieceData, PIECE_CHARS, UPDATES_FILE } from "../scripts/emit.mjs";
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

test("[F5.R4] the one emitter posts each finding to the job folder's updates.jsonl as a piece named by its id, and each stage as a status line", async () => {
  await inTemp(async (job) => {
    const live = liveUpdates(job);
    live.status("Reading GitHub's records.");
    live.finding({ id: "S2-004", section: 2, kind: "license", title: "The license", says: "Licensed Apache-2.0.", by: "script", based_on: ["F0001"], evidence: [{ file: "LICENSE", line: 1 }] });
    const lines = readFileSync(join(job, UPDATES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines[0], { progress: "Reading GitHub's records." });
    assert.equal(lines[1].piece, "S2-004");
    assert.equal(lines[1].last, true);
    assert.equal(lines[1].data.title, "The license");
    assert.match(lines[1].piece, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "a name the adapter takes for a piece");
  });
});

test("[F5.R4] a finding larger than one piece goes as its title and words, with a note saying the rest is in inspection.json", () => {
  const big = { id: "S3-001", section: 3, kind: "skill", title: "Its skills", says: "Many.", by: "script", based_on: [], evidence: Array.from({ length: 3000 }, (_, i) => ({ file: `skills/s${i}/SKILL.md`, line: 2, text: "name: a skill with a long line of words" })) };
  const d = pieceData(big);
  assert.ok(JSON.stringify(d).length <= PIECE_CHARS);
  assert.equal(d.title, "Its skills");
  assert.match(d.note, /inspection\.json under S3-001/);
  assert.equal(d.evidence, undefined);
});

test("[F5.R4] in an inspection the stages are said in order, and sections 3 to 5 are posted before the model is asked about 6 to 8", async () => {
  const events = [];
  const answers = [
    { findings: [{ section: 4, kind: "how-it-runs", title: "A graph", says: "It runs as a graph.", based_on: ["F0001"] }] },
    (prompt) => { events.push(["second call", null]); return { text: JSON.stringify({ findings: [] }) }; },
  ];
  await inTemp((at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files: smallAgent() }).fetchImpl, ask: model(answers).ask,
    onFinding: (f) => events.push(["finding", f]), onStatus: (s) => events.push(["status", s]) }));
  const statuses = events.filter(([k]) => k === "status").map(([, s]) => s);
  for (const [i, word] of ["Reading GitHub", "Unpacked", "Read ", "OSV", "sections 3, 4 and 5", "sections 6, 7 and 8", "section 1", "Done"].entries()) assert.ok(statuses[i]?.includes(word), `status ${i + 1} says ${word}: ${statuses[i]}`);
  const second = events.findIndex(([k]) => k === "second call");
  const sectionFour = events.findIndex(([k, f]) => k === "finding" && f.section === 4 && f.by === "model");
  assert.ok(sectionFour >= 0 && sectionFour < second, "the model's finding of section 4 was posted before the second call was made");
});

test("[C2] a live piece takes out anything that looks like a credential, as the report does", async () => {
  await inTemp(async (job) => {
    const token = ["sk", "-", "abcdefghijklmnopqrstuvwx"].join("");
    liveUpdates(job).finding({ id: "S5-001", section: 5, kind: "credential", title: "A key", says: `It reads ${token}.`, by: "script", based_on: [] });
    assert.ok(!readFileSync(join(job, UPDATES_FILE), "utf8").includes(token));
  });
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
