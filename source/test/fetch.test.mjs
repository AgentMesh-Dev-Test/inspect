// F1, fetching the repository at the commit.
//
// What is worth pinning: which repository and commit a message names, and
// that a branch, a tag or nothing at all is refused before any call; that
// GitHub is read with GET requests only, at most six a job, and that an
// allowance run out is said in words; that the commit's full digest comes from
// GitHub's record and is marked checked only when the archive's own header
// names it; the refusals for a repository or commit that is not there and an
// archive that is too large, each in its words; that the archive never decides
// where a file lands; and that GitHub failing delivers no report.
//
// Nothing here touches a network: GitHub is a fetch the test hands in.
//   node --test test/fetch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readRequest } from "../scripts/request.mjs";
import { githubReader, CALLS, ARCHIVE_BYTES } from "../scripts/github.mjs";
import { untar, MAX_FILES } from "../scripts/untar.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { ENV, API, SHA, inTemp, world, model, smallAgent, archiveOf, response } from "./helpers.mjs";

const run = (text, w, at, m = model()) => inspect({ text, workDir: at, env: ENV, fetchImpl: w.fetchImpl, ask: m.ask });

test("[F1.A1] the repository and commit come from the message's lines, and GitHub is asked with GET requests only, at most 6 calls", async () => {
  await inTemp(async (at) => {
    const w = world({ files: smallAgent() });
    const out = await run("repository: https://github.com/acme/helper\ncommit: 86d8f66", w, at);
    assert.equal(out.code, 0);
    const gh = w.calls.filter((c) => c.url.startsWith(API));
    assert.ok(gh.length > 0 && gh.length <= 6, `GitHub was called ${gh.length} times`);
    assert.ok(gh.every((c) => c.method === "GET"), "every call to GitHub is a GET");
    assert.ok(gh.some((c) => c.url === `${API}/repos/acme/helper`));
    assert.ok(gh.some((c) => c.url === `${API}/repos/acme/helper/commits/86d8f66`));
    assert.equal(CALLS, 6);
  });
});

test("[F1.A1] a seventh call to GitHub in one job is refused in words", async () => {
  const w = world({ files: {} });
  const gh = githubReader({ owner: "acme", name: "helper", env: ENV, fetchImpl: w.fetchImpl });
  for (let i = 0; i < 6; i += 1) await gh.repository();
  await assert.rejects(gh.repository(), /at most 6 calls to GitHub in one job/);
});

test("[F1.A1] GitHub's allowance for anonymous reads running out is said in words", async () => {
  const fetchImpl = async () => response(403, { json: { message: "rate limited" }, headers: { "x-ratelimit-remaining": 0 } });
  const gh = githubReader({ owner: "acme", name: "helper", env: ENV, fetchImpl });
  await assert.rejects(gh.repository(), /allowance for anonymous reads from here has run out/);
});

test("[F1.A2] a commit address names both the repository and the commit", () => {
  const r = readRequest("Please look at https://github.com/acme/helper/commit/86d8f667796890eb6d3612dbd1b9e941782fe03f");
  assert.equal(r.ok, true);
  assert.equal(`${r.owner}/${r.name}`, "acme/helper");
  assert.equal(r.commit, "86d8f667796890eb6d3612dbd1b9e941782fe03f");
  const t = readRequest("https://github.com/acme/helper/tree/86d8f66");
  assert.equal(t.commit, "86d8f66");
  const bare = readRequest("repository: acme/helper\ncommit: 86D8F66");
  assert.equal(`${bare.owner}/${bare.name}@${bare.commit}`, "acme/helper@86d8f66");
});

test("[F1.A3] the report's commit is the full digest from GitHub's record, checked when the archive's header names it", async () => {
  await inTemp(async (at) => {
    const out = await run("repository: acme/helper\ncommit: 86d8f66", world({ files: smallAgent() }), at);
    assert.equal(out.report.commit.sha, SHA);
    assert.equal(out.report.commit.checked, true);
  });
  await inTemp(async (at) => {
    const out = await run("repository: acme/helper\ncommit: 86d8f66", world({ files: smallAgent(), archiveCommit: "0".repeat(40) }), at);
    assert.equal(out.report.commit.sha, SHA);
    assert.equal(out.report.commit.checked, false, "an archive naming another commit is not marked checked");
  });
});

test("[F1.A4] no public repository: There is no public repository at acme/nothing-here on GitHub, so nothing was inspected.", async () => {
  await inTemp(async (at) => {
    const w = world({ status: { "/repos/acme/nothing-here": 404 } });
    const out = await run("repository: acme/nothing-here\ncommit: 86d8f66", w, at);
    assert.equal(out.reply, "There is no public repository at acme/nothing-here on GitHub, so nothing was inspected.");
    assert.equal(out.report, undefined);
  });
});

test("[F1.A5] a commit not in the repository: deadbee is not a commit of acme/helper, so nothing was inspected.", async () => {
  await inTemp(async (at) => {
    const w = world({ status: { "/commits/deadbee": 422 } });
    const out = await run("repository: acme/helper\ncommit: deadbee", w, at);
    assert.equal(out.reply, "deadbee is not a commit of acme/helper, so nothing was inspected.");
    assert.equal(out.report, undefined);
  });
});

test("[F1.A6] a branch name in place of a commit is refused, and GitHub is not called", async () => {
  await inTemp(async (at) => {
    const w = world();
    const out = await run("repository: acme/helper\ncommit: main", w, at);
    assert.match(out.reply, /Inspect reads one commit/);
    assert.match(out.reply, /A branch or a tag can move/);
    assert.equal(w.calls.length, 0);
  });
});

test("[F1.A7] a message naming neither is refused naming both as missing, and GitHub is not called", async () => {
  await inTemp(async (at) => {
    const w = world();
    const out = await run("please inspect something", w, at);
    assert.match(out.reply, /the repository/);
    assert.match(out.reply, /the commit/);
    assert.match(out.reply, /nothing was inspected/);
    assert.equal(w.calls.length, 0);
  });
});

test("[F1.A8] an archive of 61 MB is over the limit of 50 MB, and no report is delivered", async () => {
  await inTemp(async (at) => {
    const w = world({ files: smallAgent(), archiveLength: 61 * 1024 * 1024 });
    const out = await run("repository: acme/helper\ncommit: 86d8f66", w, at);
    assert.match(out.reply, /61 MB/);
    assert.match(out.reply, /50 MB/);
    assert.equal(out.report, undefined);
    assert.equal(ARCHIVE_BYTES, 50 * 1024 * 1024);
  });
});

test("[F1.A8] an archive holding more files than the limit of 20000 is refused", async () => {
  assert.equal(MAX_FILES, 20000);
  await inTemp(async (at) => {
    const r = untar(archiveOf({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }), join(at, "x"), { maxFiles: 2 });
    assert.equal(r.ok, false);
    assert.match(r.said, /more than 2 files/);
  });
});

test("[F1.A9] no file is written outside the job's folder, no link is written, and each link is a fact with where it points", async () => {
  await inTemp(async (at) => {
    const dir = join(at, "codebase");
    const gz = archiveOf({ "skills/a/SKILL.md": "---\nname: a\n---\n" }, { links: { ".claude/skills": "../skills" }, raw: [{ name: "acme-helper-86d8f66/../../escaped.txt", content: "out" }] });
    const r = untar(gz, dir);
    assert.equal(r.ok, true);
    assert.equal(existsSync(join(at, "escaped.txt")), false);
    assert.equal(existsSync(join(dir, "..", "escaped.txt")), false);
    assert.equal(existsSync(join(dir, ".claude", "skills")), false, "the link was not written");
    const walkAll = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return lstatSync(p).isDirectory() ? walkAll(p) : [p]; });
    assert.ok(walkAll(dir).every((p) => !lstatSync(p).isSymbolicLink()));
    assert.deepEqual(r.links, [{ path: ".claude/skills", points_to: "../skills", kind: "symbolic link" }]);
    assert.ok(r.refused.some((x) => /escaped\.txt/.test(x.path)));
    assert.equal(r.commit, SHA);
  });
  await inTemp(async (at) => {
    const out = await run("repository: acme/helper\ncommit: 86d8f66", world({ files: smallAgent(), links: { ".claude/skills": "../skills" } }), at);
    const link = out.report.facts.find((f) => f.kind === "link");
    assert.deepEqual({ path: link.data.path, points_to: link.data.points_to }, { path: ".claude/skills", points_to: "../skills" });
  });
});

test("[F1.A10] GitHub answering 503 to the archive delivers no report and names the call and the answer", async () => {
  await inTemp(async (at) => {
    const out = await run("repository: acme/helper\ncommit: 86d8f66", world({ files: smallAgent(), status: { "/tarball/": 503 } }), at);
    assert.equal(out.report, undefined);
    assert.match(out.reply, /503/);
    assert.match(out.reply, /archive/);
    assert.match(out.reply, /GET \/repos\/acme\/helper\/tarball\//);
    assert.equal(out.code, 1);
  });
});
