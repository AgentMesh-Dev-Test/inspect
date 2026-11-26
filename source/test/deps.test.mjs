// F3, the dependency list and OSV.
//
// What is worth pinning: the list is a CycloneDX 1.5 bill of materials with
// npm's lockfile and uv.lock's packages in it by package URL; OSV is asked by
// query, at most 1000 components a query and 10 queries a job, and at most 60
// vulnerabilities are read; a known vulnerability is a finding of section 7
// with its OSV id, aliases, fix, lockfile line, OSV's level and the
// categories LLM03:2025 and ASI04; what could not be asked is said in section
// 8; and OSV failing still delivers the report.
//
// Nothing here touches a network: OSV is a fetch the test hands in.
//   node --test test/deps.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWithOsv, QUERY_SIZE, QUERIES, VULN_READS, fromUvLock, cvss3Score } from "../scripts/deps.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { ENV, OSV, inTemp, world, model, smallAgent } from "./helpers.mjs";

const LOCK = JSON.stringify({ name: "helper", lockfileVersion: 3, packages: { "": { name: "helper", dependencies: { "left-pad": "1.3.0" } }, "node_modules/left-pad": { version: "1.3.0" } } }, null, 2);
const go = (files, opts = {}) => inTemp((at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files, ...opts }).fetchImpl, ask: model().ask }));

test("[F3.A1] the dependency list is a CycloneDX 1.5 bill of materials holding npm's and uv.lock's packages", async () => {
  const out = await go(smallAgent({ "package-lock.json": LOCK, "package.json": '{"name":"helper","dependencies":{"left-pad":"1.3.0"}}' }));
  assert.equal(out.bom.bomFormat, "CycloneDX");
  assert.equal(out.bom.specVersion, "1.5");
  const refs = out.bom.components.map((c) => c["bom-ref"]);
  assert.ok(refs.includes("pkg:npm/left-pad@1.3.0"), refs.join(", "));
  assert.ok(refs.includes("pkg:pypi/httpx@0.27.0"), refs.join(", "));
  assert.ok(!refs.some((r) => /helper@0\.1\.0/.test(r)), "the project's own editable package is not a dependency");
  assert.deepEqual(fromUvLock(smallAgent()["uv.lock"]).map((p) => `${p.name}@${p.version}:${p.line}`), ["httpx@0.27.0:9"]);
});

test("[F3.A2] a known vulnerability is a finding of section 7 with its id, alias, fix, lockfile line, OSV's level and LLM03:2025 and ASI04", async () => {
  const osv = {
    affects: { "PyPI:httpx@0.27.0": ["GHSA-aaaa-bbbb-cccc"] },
    records: { "GHSA-aaaa-bbbb-cccc": { id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2026-0001"], summary: "a made-up hole", database_specific: { severity: "HIGH" }, affected: [{ package: { ecosystem: "PyPI", name: "httpx" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "0.27.2" }] }] }] } },
  };
  const out = await go(smallAgent(), { osv });
  const f = out.report.findings.find((x) => x.section === 7 && x.detail?.advisories?.some((a) => a.id === "GHSA-aaaa-bbbb-cccc"));
  assert.ok(f, "the vulnerability is a finding of section 7");
  // 0.2.6: the title says it in words, and the advisory's id is in its detail, never in its title or words.
  assert.equal(f.title, "httpx 0.27.0 has a known security flaw");
  assert.equal(f.says, "A made-up hole. Fixed in 0.27.2.");
  assert.deepEqual(f.detail.advisories, [{ id: "GHSA-aaaa-bbbb-cccc", aliases: ["CVE-2026-0001"], summary: "a made-up hole", level: "high", fixed: "0.27.2" }]);
  assert.ok(!/GHSA|CVE/.test(`${f.title} ${f.says}`));
  assert.deepEqual(f.evidence.map((e) => `${e.file}:${e.line}`), ["uv.lock:9"]);
  assert.equal(f.level, "high");
  assert.equal(f.level_by, "source");
  const ids = f.categories.map((c) => c.id);
  assert.ok(ids.includes("LLM03:2025") && ids.includes("ASI04"));
});

test("[F3.A2] a package's advisories are one finding, at the highest of their levels, each advisory with its summary, fix and id", async () => {
  const rec = (id, severity, summary, fixed) => ({ id, aliases: [], summary, database_specific: { severity }, affected: [{ package: { ecosystem: "PyPI", name: "httpx" }, ranges: [{ events: [{ introduced: "0" }, ...(fixed ? [{ fixed }] : [])] }] }] });
  const osv = {
    affects: { "PyPI:httpx@0.27.0": ["GHSA-1111-1111-1111", "GHSA-2222-2222-2222"] },
    records: { "GHSA-1111-1111-1111": rec("GHSA-1111-1111-1111", "MODERATE", "httpx: open redirect in the client", "0.27.1"), "GHSA-2222-2222-2222": rec("GHSA-2222-2222-2222", "HIGH", "header injection", null) },
  };
  const out = await go(smallAgent(), { osv });
  const list = out.report.findings.filter((x) => x.section === 7 && x.detail?.advisories);
  assert.equal(list.length, 1, "one finding for the package");
  const f = list[0];
  assert.equal(f.title, "httpx 0.27.0 has known security flaws");
  assert.equal(f.level, "high", "the highest of its advisories");
  assert.deepEqual(f.detail.advisories.map((a) => [a.id, a.level, a.fixed]), [["GHSA-1111-1111-1111", "medium", "0.27.1"], ["GHSA-2222-2222-2222", "high", null]]);
  assert.equal(f.says, "Open redirect in the client. Fixed in 0.27.1. Header injection.");
  assert.deepEqual(f.categories.filter((c) => c.list === "osv").map((c) => c.id), ["GHSA-1111-1111-1111", "GHSA-2222-2222-2222"]);
});

test("[F3.A2] OSV is asked by query, at most 1000 components a query and 10 queries a job, and at most 60 vulnerabilities are read", async () => {
  assert.deepEqual([QUERY_SIZE, QUERIES, VULN_READS], [1000, 10, 60]);
  const comps = Array.from({ length: 1001 }, (_, i) => ({ name: `p${i}`, version: "1.0.0", purl: `pkg:npm/p${i}@1.0.0` }));
  const ids = Array.from({ length: 61 }, (_, i) => `GHSA-0000-0000-${String(i).padStart(4, "0")}`);
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method, size: body?.queries?.length });
    if (url.endsWith("/v1/querybatch")) return { status: 200, json: async () => ({ results: body.queries.map((q) => ({ vulns: q.package.name === "p0" ? ids.map((id) => ({ id })) : [] })) }) };
    return { status: 200, json: async () => ({ id: decodeURIComponent(url.split("/").pop()) }) };
  };
  const r = await checkWithOsv(comps, { env: ENV, fetchImpl });
  const queries = calls.filter((c) => c.url === `${OSV}/v1/querybatch`);
  assert.deepEqual(queries.map((q) => [q.method, q.size]), [["POST", 1000], ["POST", 1]]);
  assert.equal(calls.filter((c) => c.url.includes("/v1/vulns/")).length, 60);
  assert.equal(r.unread.length, 1);
  assert.ok(calls.every((c) => c.method === "POST" ? c.url.endsWith("/v1/querybatch") : c.method === "GET"), "OSV is only queried and read");
});

test("[F3.A2] a level comes from OSV's record: its severity word, or a CVSS 3 vector's base score", () => {
  assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N"), 2.6);
  assert.equal(cvss3Score("not a vector"), null);
});

test("[F3.A3] a package.json with no lockfile asking for express ^4.0.0 is said in section 8 as not checked, only a range", async () => {
  const files = smallAgent({ "package.json": '{"name":"helper","dependencies":{"express":"^4.0.0"}}' });
  const out = await go(files);
  const f = out.report.findings.find((x) => x.section === 8 && x.title === "Dependencies not checked for known security flaws");
  assert.ok(f, "section 8 says what was not checked");
  assert.match(f.says, /only a range of versions is given/);
  assert.ok(f.detail.components.some((c) => /express/.test(c.purl)));
});

test("[F3.A4] OSV answering 500 still delivers the report, and section 8 says the dependencies were not checked and OSV answered 500", async () => {
  const out = await go(smallAgent(), { osvStatus: 500 });
  assert.ok(out.report, "the report is delivered");
  const f = out.report.findings.find((x) => x.section === 8 && /not checked for known security flaws/.test(x.title) && /500/.test(x.says));
  assert.ok(f, "section 8 says OSV answered 500");
});
