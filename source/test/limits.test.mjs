// The day's caps on inspections (0.4.5): a bound on what Inspect asks of the
// model, at the door.
//
// What is worth pinning: one asker may start PER_ASKER inspections in a UTC
// day and everyone PER_DAY; over either, the request is refused before
// anything is read or asked, in words that say when to try again; a new day
// starts the count again; a count that cannot be kept refuses, since a cap
// that cannot count is no cap; who asked is kept only as a digest; and the
// command refuses at the door, posting nothing to the running job.
//
// Nothing here touches a network or a model.
//   node --test test/limits.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { admit, askerOf, PER_ASKER, PER_DAY, COUNTS_FILE } from "../scripts/limits.mjs";
import { ROOT, inTemp } from "./helpers.mjs";

const NOON = new Date("2026-11-26T12:00:00Z");

test("one asker may start PER_ASKER inspections a day and everyone PER_DAY; over either is refused at the door with when to try again", async () => {
  assert.deepEqual([PER_ASKER, PER_DAY], [20, 200]);
  await inTemp(async (records) => {
    for (let i = 1; i <= 3; i += 1) assert.deepEqual(admit({ recordsDir: records, asker: "a1", now: NOON, perAsker: 3, perDay: 5 }), { ok: true, total: i, mine: i });
    const over = admit({ recordsDir: records, asker: "a1", now: NOON, perAsker: 3, perDay: 5 });
    assert.equal(over.ok, false);
    assert.equal(over.refusal, "You have asked for the 3 inspections one asker may have in a day, so Inspect did not start this one. Try again in 12 hours.");
    assert.equal(admit({ recordsDir: records, asker: "b2", now: NOON, perAsker: 3, perDay: 5 }).ok, true);
    assert.equal(admit({ recordsDir: records, asker: "c3", now: NOON, perAsker: 3, perDay: 5 }).ok, true);
    const full = admit({ recordsDir: records, asker: "d4", now: NOON, perAsker: 3, perDay: 5 });
    assert.equal(full.refusal, "Inspect has made the 5 inspections it makes in a day, so it did not start this one. Try again in 12 hours.");
    const tomorrow = admit({ recordsDir: records, asker: "a1", now: new Date("2026-11-27T00:30:00Z"), perAsker: 3, perDay: 5 });
    assert.deepEqual(tomorrow, { ok: true, total: 1, mine: 1 }, "a new day starts the count again");
    const kept = JSON.parse(readFileSync(join(records, COUNTS_FILE), "utf8"));
    assert.deepEqual(kept, { day: "2026-11-27", total: 1, by: { a1: 1 } }, "one day at most is kept");
  });
});

test("a count that cannot be kept refuses, since a cap that cannot count is no cap", async () => {
  await inTemp(async (at) => {
    writeFileSync(join(at, COUNTS_FILE), "{ not json");
    const r = admit({ recordsDir: at, asker: "a1", now: NOON });
    assert.equal(r.ok, false);
    assert.match(r.refusal, /^Inspect cannot read today's count of its inspections here/);
  });
});

test("who asked is kept as a digest of the account, else of the sending agent, never as its name", async () => {
  await inTemp(async (job) => {
    writeFileSync(join(job, "message.json"), JSON.stringify({ from: "UAGENTKEY", acct: "01a2acct-0000" }));
    const a = askerOf(job);
    assert.match(a, /^[0-9a-f]{16}$/);
    writeFileSync(join(job, "message.json"), JSON.stringify({ from: "UAGENTKEY" }));
    assert.notEqual(askerOf(job), a, "the agent's digest when no account is named");
    assert.equal(askerOf(join(job, "nowhere")), null);
  });
});

test("the command refuses over the cap before anything is read, and posts nothing to the running job", async () => {
  await inTemp(async (at) => {
    const job = join(at, "job1"); const records = join(at, "records");
    mkdirSync(job); mkdirSync(records);
    writeFileSync(join(job, "message.txt"), "repository: acme/helper");
    writeFileSync(join(job, "message.json"), JSON.stringify({ from: "UAGENTKEY" }));
    writeFileSync(join(records, COUNTS_FILE), JSON.stringify({ day: new Date().toISOString().slice(0, 10), total: PER_DAY, by: {} }));
    const out = execFileSync(process.execPath, [join(ROOT, "scripts", "inspect-a-repository.mjs"), "--job", job, "--records", records], { encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_API: "http://127.0.0.1:9" } });
    assert.match(JSON.parse(out).reply, /^Inspect has made the 200 inspections it makes in a day, so it did not start this one\. Try again in \d+ hours?\.$/);
    assert.equal(existsSync(join(job, "updates.jsonl")), false, "nothing posted");
  });
});
