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
import { ENV, API, SHA, inTemp, world, model, smallAgent, archiveOf, response, repoRecord } from "./helpers.mjs";

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
    assert.match(out.reply, /leave the commit out to inspect the newest one/);
    assert.equal(w.calls.length, 0);
  });
});

test("[F1.A7] a message naming no repository is refused, naming the repository as missing, and GitHub is not called", async () => {
  await inTemp(async (at) => {
    for (const text of ["please inspect something", "commit: 86d8f66"]) {
      const w = world();
      const out = await run(text, w, at);
      assert.equal(out.reply, "Inspect needs the repository (https://github.com/<owner>/<name>), and the message does not name it, so nothing was inspected.");
      assert.equal(out.report, undefined);
      assert.equal(w.calls.length, 0);
    }
  });
});

test("[F1.A11] no commit named: Inspect reads the newest commit on the default branch from GitHub's records, with GET requests only and four calls, and the report records its full digest", async () => {
  for (const text of ["repository: https://github.com/acme/helper", "Inspect https://github.com/acme/helper please", "repository: acme/helper\ncommit:\nnotes: none", "Inspect a repository.\n\nrepository: acme/helper"]) {
    await inTemp(async (at) => {
      assert.equal(readRequest(text).commit, null, `${JSON.stringify(text)} names no commit`);
      const w = world({ files: smallAgent(), repo: repoRecord({ default_branch: "trunk" }) });
      const out = await run(text, w, at);
      assert.equal(out.code, 0, out.reply);
      const gh = w.calls.filter((c) => c.url.startsWith(API));
      assert.ok(gh.every((c) => c.method === "GET"));
      assert.deepEqual(gh.map((c) => new URL(c.url).pathname), ["/repos/acme/helper", "/repos/acme/helper/commits/trunk", "/repos/acme/helper/commits", `/repos/acme/helper/tarball/${SHA}`], "the repository's record names the branch; its newest commit's record gives the digest the archive is read at");
      assert.equal(out.report.commit.sha, SHA, "the full digest");
      assert.equal(out.report.commit.checked, true);
      const c = out.report.findings.find((f) => f.kind === "commit");
      assert.equal(c.detail.newest_on, "trunk");
      assert.match(c.says, /the newest on trunk when it was inspected/);
    });
  }
  await inTemp(async (at) => {
    const out = await run("repository: acme/helper\ncommit: 86d8f66", world({ files: smallAgent() }), at);
    assert.equal(out.report.findings.find((f) => f.kind === "commit").detail.newest_on, undefined, "a commit named is that commit, never the newest");
  });
});

test("[F1.A11] a default branch with no commit is refused in words, and nothing is inspected", async () => {
  await inTemp(async (at) => {
    const w = world({ files: smallAgent(), status: { "/commits/main": 409 } });
    const out = await run("repository: acme/helper", w, at);
    assert.equal(out.reply, "acme/helper has no commit on its default branch, main, so nothing was inspected.");
    assert.equal(out.report, undefined);
    assert.ok(!w.calls.some((c) => c.url.includes("/tarball/")));
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

test("[F5.R4] the repository and the commit go to the running job as soon as GitHub's records name them, before the archive is read, so the page shows the job working from its first seconds", async () => {
  await inTemp(async (at) => {
    const w = world({ files: smallAgent() });
    const starts = [];
    const out = await inspect({ text: "repository: acme/helper", workDir: at, env: ENV, fetchImpl: w.fetchImpl, ask: model().ask, onStart: (a) => starts.push({ ...a, calls: w.calls.map((c) => new URL(c.url).pathname) }) });
    assert.equal(out.code, 0);
    assert.equal(starts.length, 2, "once early, once with the archive checked");
    assert.deepEqual(starts[0].calls, ["/repos/acme/helper", "/repos/acme/helper/commits/main"], "before the archive is asked for");
    assert.equal(starts[0].sha, SHA);
    assert.equal(starts[0].checked, false, "not yet checked against the archive");
    assert.equal(starts[1].checked, true);
  });
});
