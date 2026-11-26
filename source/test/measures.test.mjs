// F5.R10, what the report says of how much is there and what the person must
// do (0.3.0): each skill's size and tests, the agent's own code, how each
// setting is read and what the setup docs say of it, each test file's kind,
// the repository's own capitals, the description of the agent, a title said
// once, and the Markdown with no date a reader's time zone may move.
//   node --test test/measures.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { casedFrom, docWord, howRead, needsLiveKeys, testKind } from "../scripts/collect.mjs";
import { bodyOf, codeLines, frontMatter } from "../scripts/agent-facts.mjs";
import { checkDescription, nearSame, plainDetail } from "../scripts/checks.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { markdownOf } from "../scripts/report.mjs";
import { ENV, inTemp, world, model, smallAgent } from "./helpers.mjs";

test("[F5.R10] how a setting is read: with a default, behind a guard that skips a feature, or failing without it", () => {
  const lines = [
    'x = os.environ.get("A_KEY", "d")',
    'k = os.environ["B_KEY"]',
    'if not os.getenv("C_KEY"):',
    "    return None",
    'key = os.getenv("D_KEY")',
    "if not key:",
    '    raise RuntimeError("no key")',
    'const e = process.env.E_KEY ?? "x"',
    'token = os.getenv("F_KEY")',
  ];
  assert.deepEqual(["A_KEY", "B_KEY", "C_KEY", "D_KEY", "E_KEY", "F_KEY"].map((n, i) => howRead(n, lines, [0, 1, 2, 4, 7, 8][i])), ["default", "fails", "guard", "fails", "default", "plain"]);
  assert.equal(docWord("Set ELEVENLABS_API_KEY (optional) to enable voice."), "optional");
  assert.equal(docWord("SLACK_BOT_TOKEN is required."), "required");
  assert.equal(docWord("GEMINI_API_KEY: the Gemini key."), "mentioned");
});

test("[F5.R10] a test file's kind by its folders, whether it needs live keys, a file's lines of code, a skill's instructions and its folded description", () => {
  assert.deepEqual(["tests/unit/a_test.py", "tests/contract/test_x.py", "tests/e2e/flow.spec.ts", "tests/test_misc.py"].map(testKind), ["unit", "contract", "end-to-end", "other"]);
  assert.equal(needsLiveKeys('@pytest.mark.skipif(not os.getenv("SLACK_BOT_TOKEN"), reason="live")'), true);
  assert.equal(needsLiveKeys("def test_adds(): assert 1 + 1 == 2"), false);
  assert.equal(codeLines("# a comment\n\nx = 1\n  // another\ny()"), 2);
  assert.equal(bodyOf("---\nname: x\n---\n# Title\nText"), "# Title\nText");
  assert.equal(frontMatter("---\nname: stills\ndescription: >\n  Makes still images\n  on brand.\n---\nBody").description, "Makes still images on brand.");
});

test("[F5.R10] the repository's own capitals, from its prose and never from a slug or a path; a long word in capitals is shouting", () => {
  const cased = casedFrom(["README.md"], () => "Use HyperFrames for the PR flow. The PR goes out. See hyperframes-cli and skills/pr-to-video. ElevenLabs reads it. GENERAL notes. GENERAL rules.");
  assert.deepEqual(["hyperframes", "pr", "elevenlabs", "general", "notes"].map(cased), ["HyperFrames", "PR", "ElevenLabs", "general", "notes"]);
});

test("[F5.R10] each skill carries its size, its tests and its instructions; the agent's own code its size; a test row its kind; the Markdown no date of the inspection", async () => {
  const files = {
    ...smallAgent(),
    "skills/brand-lint/SKILL.md": "---\nname: brand-lint\ndescription: Check a draft against the brand pack.\n---\n# Brand lint\n\nRun the check.\n",
    "skills/brand-lint/scripts/lint.mjs": "// lint\nimport fs from 'node:fs';\nexport function lint(t) {\n  return t.length;\n}\n",
    "tests/unit/test_brand_lint.py": "# brand-lint\ndef test_one():\n    assert True\n\ndef test_two():\n    assert True\n",
  };
  const out = await inTemp((at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model().ask }));
  const skill = out.report.findings.find((f) => f.kind === "skill" && f.detail?.name === "brand-lint");
  assert.equal(skill.title, "Check a draft against the brand pack");
  assert.deepEqual(skill.detail.size, { scripts: 1, lines: 4, instructions_chars: "# Brand lint\n\nRun the check.".length, tests: { files: 1, cases: 2 } });
  assert.equal(skill.detail.instructions, "# Brand lint\n\nRun the check.");
  assert.equal(skill.detail.instructions_cut, false);
  assert.match(skill.detail.instructions_address, /^https:\/\/github\.com\/acme\/helper\/blob\/[0-9a-f]{40}\/skills\/brand-lint\/SKILL\.md$/);
  const code = out.report.findings.find((f) => f.kind === "code" && f.by === "script");
  assert.ok(code.detail.lines > 0 && code.detail.files > 0);
  assert.doesNotMatch(code.says, /\//, "no path in its words");
  const tests = out.report.findings.find((f) => f.kind === "test" && f.by === "script");
  assert.ok(tests.detail.kinds.unit >= 2);
  assert.doesNotMatch(tests.says, /test command/i);
  const fact = out.report.facts.find((f) => f.kind === "test-file" && f.file === "tests/unit/test_brand_lint.py");
  assert.deepEqual([fact.data.kind, fact.data.live], ["unit", false]);
  const md = markdownOf(out.report);
  assert.doesNotMatch(md, /Inspected \d{4}/, "no date of the inspection: a reader's time zone may move it");
  assert.match(md, /^Commit [0-9a-f]{7}, committed \d{4}-\d{2}-\d{2}\.$/m);
});

test("[F5.R10] a title that says or asks what another of its section says is held back; the fields of a judgment a person reads are plain; the description opens section 1", () => {
  assert.equal(nearSame("Which tools need approval when deployed", "Which tools should wait for a person?"), true);
  assert.equal(nearSame("Real spend and Slack permissions", "What do the usage events contain, and is there a spend cap?"), false);
  assert.equal(nearSame("Live and render tests are opt-in", "Broad automated tests, many offline"), false);
  assert.deepEqual(plainDetail("system", { need: "Required", supply: "Your ElevenLabs key", without: "Voice is off; see `tts.mjs`.", sends: "the facts show text" }), { need: "required", supply: "Your ElevenLabs key", sends: "the code shows text" });
  assert.equal(plainDetail("system", { need: "maybe" }).need, "unclear");
  const findings = [{ id: "S3-001", section: 3, kind: "job", by: "model", based_on: ["F0001"], evidence: [{ file: "a.py", line: 1 }] }];
  const ok = checkDescription("Content Studio is a design agent in Slack. It makes images for a design team.", findings);
  assert.equal(ok.kept.kind, "description");
  assert.equal(ok.kept.section, 1);
  assert.deepEqual(ok.kept.based_on, ["F0001"]);
  assert.match(checkDescription("It reads `config.py` at start.", findings).held[0].why, /^it puts /);
  assert.match(checkDescription("It is safe to bring in.", findings).held[0].why, /verdict/);
  assert.deepEqual(checkDescription("", findings), { kept: null, held: [] });
});

test("[F5.R10] the model is asked for the description, each system's need and what the person supplies, each risk's fix, the skills that do each job, and to say each thing once", async () => {
  const { firstPrompt, secondPrompt, glancePrompt, SAY_ONCE, MODEL_KINDS } = await import("../scripts/judge.mjs");
  const first = firstPrompt("", { repo: "x" }); const second = secondPrompt("", { repo: "x" }); const glance = glancePrompt([]);
  assert.match(first, /need: "required" \| "optional" \| "unclear"/);
  assert.match(first, /supply: /);
  assert.match(first, /skill facts of the skills that do it/);
  assert.match(first, /kind code/);
  assert.match(second, /detail \{safe: /);
  assert.ok(first.includes(SAY_ONCE) && second.includes(SAY_ONCE));
  assert.match(glance, /"description": /);
  assert.deepEqual(MODEL_KINDS[7], ["risk"], "a risk and its fix are one finding");
});

test("[F5.R10] a gap and the question to ask the publisher about it are one finding, so neither repeats the other", async () => {
  const { secondPrompt, MODEL_KINDS } = await import("../scripts/judge.mjs");
  assert.match(secondPrompt("", { repo: "x" }), /ending with the question to ask the publisher/);
  assert.doesNotMatch(secondPrompt("", { repo: "x" }), /kind question/);
  assert.deepEqual(MODEL_KINDS[8], ["test", "test-gap", "could-not-tell"]);
});
