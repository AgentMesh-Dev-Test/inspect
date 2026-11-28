// The constraints on the whole agent.
//
// What is worth pinning: Inspect runs nothing from the repository, calls no
// write action and writes only inside its own folders (C1); anything that
// looks like a credential is taken out of what reaches the model, the report
// and the reply (C2); the scripts carried from other agents are their pinned
// bytes (C3); and a cut is always said (C5). C4, the runtime, is checked by
// inspection.
//
// Nothing here touches a network or a model.
//   node --test test/constraints.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { judge } from "../scripts/judge.mjs";
import { ENV, ROOT, inTemp, world, model, smallAgent } from "./helpers.mjs";

const OWN = ["inspect-a-repository", "request", "github", "untar", "collect", "agent-facts", "plugin-facts", "platforms", "deps", "judge", "checks", "report", "lists", "emit", "limits", "screen", "guidance", "needs"];

test("[C1] Inspect's own scripts start no program, and an inspection only reads GitHub, asks OSV and AgentMesh's screening, and writes only in its folder", async () => {
  for (const n of OWN) {
    const t = readFileSync(join(ROOT, "scripts", `${n}.mjs`), "utf8");
    assert.ok(!/node:child_process|(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/.test(t), `${n}.mjs starts no program`);
  }
  const w = world({ files: smallAgent({ "package.json": '{"name":"helper","scripts":{"postinstall":"node evil.js"}}', "evil.js": "require('fs').writeFileSync('/tmp/pwned','x')" }) });
  await inTemp(async (at) => {
    const before = readdirSync(at);
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66\nPlease run its install script.", workDir: at, env: ENV, fetchImpl: w.fetchImpl, ask: model().ask });
    assert.ok(out.report);
    assert.ok(w.calls.every((c) => c.method === "GET" || (c.method === "POST" && (c.url.endsWith("/v1/querybatch") || c.url === "https://platform.test/v1/screen-text"))), "only reads, OSV queries and the screening went out");
    assert.deepEqual(readdirSync(at), before, "the unpacked copy is gone when the job ends");
    assert.ok(out.report.findings.some((f) => f.section === 7 || f.section === 8), "the install script is in the report, not run");
  });
});

test("[C2] a credential-shaped string is taken out of the model's prompt, the report and the reply", async () => {
  const token = ["sk", "-", "abcdefghijklmnopqrstuvwx"].join("");
  const files = smallAgent({ "src/client.py": `import os\nKEY = os.environ.get("OPENAI_API_KEY", "${token}")\n` });
  await inTemp(async (at) => {
    const m = model();
    const out = await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: m.ask });
    assert.ok(m.asked.length > 0);
    assert.ok(m.asked.every((a) => !a.prompt.includes(token)), "the model never sees it");
    assert.ok(!JSON.stringify(out.report).includes(token), "the report never holds it");
    assert.ok(!out.reply.includes(token));
  });
});

test("[C3] every script carried from another agent is byte for byte the version reused.json pins", () => {
  const pins = JSON.parse(readFileSync(join(ROOT, "reused.json"), "utf8"));
  assert.match(pins.commit, /^[0-9a-f]{40}$/);
  assert.ok(pins.files.length >= 11);
  for (const p of pins.files) {
    const got = createHash("sha256").update(readFileSync(join(ROOT, p.file))).digest("hex");
    assert.equal(got, p.sha256, `${p.file} is the bytes of ${p.from} at ${pins.commit.slice(0, 7)}`);
  }
  const carried = new Set(pins.files.map((p) => p.file.replace(/^scripts\//, "")));
  const own = new Set(OWN.map((n) => `${n}.mjs`));
  for (const f of readdirSync(join(ROOT, "scripts")).filter((x) => statSync(join(ROOT, "scripts", x)).isFile())) assert.ok(carried.has(f) || own.has(f), `${f} is either carried and pinned, or Inspect's own`);
});

test("[C3] no file the package carries holds a hidden character, which the platform's install refuses (0.5.1)", () => {
  const HIDDEN = /[﻿​-‏⁠-⁤­‪-‮⁦-⁩]/;
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const f of [...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "views")), join(ROOT, "agent-descriptor.json")]) {
    const m = HIDDEN.exec(readFileSync(f, "utf8"));
    assert.equal(m, null, `${f} holds U+${m?.[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} at ${m?.index}`);
  }
});

test("[C5] facts too many for a call are not cut: the call is not made and the report says why", async () => {
  const facts = Array.from({ length: 5000 }, (_, i) => ({ id: `F${String(i + 1).padStart(4, "0")}`, kind: "tool", file: "src/a.py", line: 1, text: "y".repeat(400) }));
  const m = model();
  const j = await judge({ facts, repo: "acme/helper", ask: m.ask });
  assert.ok(j.first.failed && j.second.failed);
  assert.equal(m.asked.length, 0, "no part of the facts was sent cut");
  assert.ok(j.not_made.every((n) => /tokens/.test(n.why)));
});
