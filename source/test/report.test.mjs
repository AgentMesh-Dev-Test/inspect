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
import { createEmitter, liveUpdates, pieceData, PIECE_CHARS, UPDATES_FILE, WORKING_COPY } from "../scripts/emit.mjs";
import { markdownOf, workingCopy, WORKING_COPY_CHARS } from "../scripts/report.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { ENV, SHA, descriptor, inTemp, world, model, smallAgent, reportSchema, schemaProblems } from "./helpers.mjs";

const glanceOf = (ids) => (prompt) => ({ text: JSON.stringify({ glance: ids.filter((id) => prompt.includes(id)).map((id) => ({ repeats: id, says: `This one matters most, number ${id.slice(3)}.` })) }) });
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

const ABOUT = { owner: "acme", name: "helper", url: "https://github.com/acme/helper", sha: SHA, checked: true, date: "2026-11-23T21:25:23Z", version: "0.2.0", started_at: "2026-11-25T15:00:00.000Z" };

test("[F5.R4] the one emitter posts each finding to the job folder's updates.jsonl as a piece named by its id, each stage as a status line, and then the working copy", async () => {
  await inTemp(async (job) => {
    const live = liveUpdates(job, { later: () => {} });
    live.start(ABOUT);
    live.status("Reading GitHub's records.");
    live.finding({ id: "S2-004", section: 2, kind: "license", title: "The license", says: "Licensed Apache-2.0.", by: "script", based_on: ["F0001"], evidence: [{ file: "LICENSE", line: 1 }] });
    live.flush();
    const lines = readFileSync(join(job, UPDATES_FILE), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines[0], { progress: "Reading GitHub's records." });
    assert.equal(lines[1].piece, "S2-004");
    assert.equal(lines[1].last, true);
    assert.equal(lines[1].data.title, "The license");
    for (const l of lines.filter((x) => x.piece)) assert.match(l.piece, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "a name the adapter takes for a piece");
    assert.equal(lines[2].piece, WORKING_COPY);
    assert.equal(lines[2].data.partial.stage, "Reading GitHub's records.");
    assert.deepEqual(lines[2].data.findings.map((f) => f.id), ["S2-004"]);
    assert.equal(lines.length, 3);
  });
});

test("[F5.R4] the updates of one turn of the event loop are one write, so the scripts' findings reach the bucket in one upload", async () => {
  const writes = [];
  const live = liveUpdates("job", { append: (file, text) => writes.push(text) });
  live.start(ABOUT);
  for (let i = 1; i <= 120; i++) live.finding({ id: `S3-${String(i).padStart(3, "0")}`, section: 3, kind: "skill", title: `skill ${i}`, says: "A skill.", by: "script", based_on: ["F0001"], evidence: [{ file: `skills/s${i}/SKILL.md`, line: 2 }] });
  live.status("Asking the model for the judgments of sections 3, 4 and 5.");
  await new Promise((r) => setImmediate(r));
  assert.equal(writes.length, 1, "one append for the whole batch");
  const lines = writes[0].split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 122, "120 pieces, the status line and the working copy");
  assert.equal(lines.at(-1).data.partial.findings_so_far, 120);
  live.flush();
  assert.equal(writes.length, 1, "nothing changed, so nothing more is written");
});

test("[F5.R4] the working copy fits the report's schema and one piece, keeps every finding with a level, and says what it leaves out", () => {
  const small = workingCopy({ about: ABOUT, findings: [{ id: "S7-001", section: 7, kind: "risk", title: "A risk", says: "It is risky.", by: "model", based_on: ["F0002"], level: "high", level_by: "model", evidence: [{ file: "a.py", line: 3, text: "x" }, { file: "b.py", line: 4 }] }], stage: "Asking the model." });
  assert.deepEqual(schemaProblems(small, reportSchema()), []);
  assert.equal(small.partial.says_left_out, false);
  assert.deepEqual(small.findings[0].evidence, [{ file: "a.py", line: 3 }]);
  assert.equal(small.findings[0].more_evidence, 1);
  const many = [];
  for (let i = 1; i <= 3000; i++) many.push({ id: `S3-${String(i).padStart(4, "0")}`, section: 3, kind: "skill", title: `a skill with a name of some length ${i}`, says: "A skill that does a thing, described in a sentence of ordinary length for a skill.", by: "script", based_on: ["F0001"], evidence: [{ file: `skills/skill-number-${i}/SKILL.md`, line: 2 }] });
  for (let i = 1; i <= 30; i++) many.push({ id: `S7-${String(i).padStart(3, "0")}`, section: 7, kind: "risk", title: `risk ${i}`, says: "Risky.", by: "model", based_on: ["F0002"], level: "medium", level_by: "model", evidence: [{ file: "c.py", line: i }] });
  const big = workingCopy({ about: ABOUT, findings: many, stage: "Writing section 1." });
  assert.ok(JSON.stringify(big).length <= WORKING_COPY_CHARS);
  assert.equal(big.partial.says_left_out, true);
  assert.ok(big.partial.omitted > 0);
  assert.equal(big.findings.filter((f) => f.level).length, 30, "every finding with a level is kept");
  assert.equal(big.partial.findings_so_far, 3030);
  assert.equal(big.counts.by_level.medium, 30);
  assert.deepEqual(schemaProblems(big, reportSchema()), []);
  const delivered = { ...big, partial: undefined };
  delete delivered.partial;
  assert.ok(schemaProblems(delivered, reportSchema()).length > 0, "a report without partial is held to the full finding");
});

test("[F5.R8] inspection.md is the report as Markdown: its headings, each level in words, each place a link to its line, and nothing from the repository that could start a link or an image", async () => {
  const out = await run("repository: acme/helper\ncommit: 86d8f66", { answers: [undefined, undefined, glanceOf(["S2-004"])] });
  const text = markdownOf(out.report);
  assert.match(text, /^# Inspection of acme\/helper$/m);
  assert.match(text, /^## At a glance$/m);
  // 0.2.6: plain headings, no finding codes, category names in words, the short commit only.
  for (const t of ["What was inspected", "What it does", "How it works", "What it connects to", "What it can do on its own", "Risks, and what it needs to run safely", "Tests, and what Inspect couldn't tell"]) assert.match(text, new RegExp(`^## ${t.replace(/[,.]/g, "\\$&")}$`, "m"));
  assert.ok(!/^## \d/m.test(text), "no section numbers");
  for (const re of [/\bS\d-\d{3}\b/, /LLM0/, /ASI0/, /\b[0-9a-f]{40}\b/, /inspection\.json/, /\bthe facts\b/i, /without running any of it/]) assert.ok(!re.test(text), `the Markdown holds nothing like ${re}`);
  assert.match(text, /\[`LICENSE:1`\]\(https:\/\/github\.com\/acme\/helper\/blob\/86d8f66\/LICENSE#L1\)/);
  assert.match(text, /^Commit 86d8f66, committed /m);
  const risky = markdownOf({ ...out.report, findings: [{ id: "S7-001", section: 7, kind: "risk", title: "httpx 0.27.0 has a known security flaw", says: "A made-up hole. Fixed in 0.27.2.", by: "script", based_on: ["F0001"], level: "high", level_by: "source", categories: [{ list: "owasp-top-10-llm-2025", id: "LLM03:2025", name: "Supply Chain" }, { list: "owasp-top-10-agentic", id: "ASI04", name: "Agentic Supply Chain Vulnerabilities" }, { list: "osv", id: "GHSA-aaaa-bbbb-cccc", name: "GHSA-aaaa-bbbb-cccc" }], evidence: [{ file: "uv.lock", line: 9 }], detail: { advisories: [{ id: "GHSA-aaaa-bbbb-cccc", fixed: "0.27.2" }] } }] });
  assert.match(risky, /\*\*httpx 0\.27\.0 has a known security flaw\.\*\* A made-up hole\. Fixed in 0\.27\.2\. Advisories: GHSA-aaaa-bbbb-cccc \(fixed in 0\.27\.2\)\. Category: Supply chain; Agentic supply chain vulnerabilities\./);
  assert.ok(!/LLM0|ASI0|S7-001/.test(risky));
  const evil = { ...out.report, findings: [{ id: "S7-001", section: 7, kind: "risk", title: "![x](https://evil.test/p.png) <img src=x>", says: "[click](https://evil.test) `code`", by: "model", based_on: ["F0001"], level: "high", level_by: "model", evidence: [{ file: "a(b).py", line: 2 }] }] };
  const e = markdownOf(evil);
  assert.match(e, /\*\*High risk\.\*\*/);
  assert.ok(!/(^|[^\\])!\[x/.test(e) && !/(^|[^\\])<img/.test(e) && !/(^|[^\\])\[click/.test(e), e);
  assert.match(e, /Risks by level: 0 critical, 1 high,/, "counted from the findings");
  assert.match(e, /a%28b%29\.py#L2\)/);
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
    const live = liveUpdates(job, { later: () => {} });
    live.start(ABOUT);
    live.finding({ id: "S5-001", section: 5, kind: "credential", title: "A key", says: `It reads ${token}.`, by: "script", based_on: [] });
    live.flush();
    const written = readFileSync(join(job, UPDATES_FILE), "utf8");
    assert.ok(written.includes("S5-001") && !written.includes(token), "neither the piece nor the working copy repeats it");
  });
});

test("[F5.A4] the reply opens with its header, gives section 1's findings one to a line, then the counts, and both pieces are attached", async () => {
  const out = await run("repository: acme/helper\ncommit: 86d8f66", { answers: [undefined, undefined, glanceOf(["S2-004", "S2-005", "S2-006"])] });
  const lines = out.reply.split("\n");
  assert.deepEqual(lines.slice(0, 4).map((l) => l.split(":")[0]), ["repository", "commit", "findings", "held_back"]);
  const at = lines.indexOf("## At a glance");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 4), ["- This one matters most, number 004. (S2-004)", "- This one matters most, number 005. (S2-005)", "- This one matters most, number 006. (S2-006)"]);
  assert.ok(lines.includes("## Sections"));
  assert.ok(lines.some((l) => /^7\. Risks, and what it needs to run safely: \d+ findings?$/.test(l)));
  assert.match(out.reply, /\d+ judgments? held back/);
  await inTemp(async (job) => {
    writeOutputs(job, out);
    assert.ok(existsSync(join(job, "out", "inspection.json")) && existsSync(join(job, "out", "inspection.md")) && existsSync(join(job, "out", "sbom.cdx.json")));
    const pieces = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(pieces.map((p) => p.name), ["inspection", "inspection-md", "sbom"]);
    // The adapter's collector (jobCollect) drops an entry that names no piece
    // and no step, or whose path leaves the job folder: until 0.2.1 every
    // entry lacked its step, and the sender got the answer with no files.
    for (const p of pieces) {
      assert.equal(typeof p.name, "string");
      assert.equal(p.step, descriptor().offerings[0].id, `${p.name} names the offering as its step`);
      assert.match(p.path, /^out\/[^/]+$/, `${p.name} is in out/`);
      assert.ok(p.about, `${p.name} says what it is`);
    }
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
