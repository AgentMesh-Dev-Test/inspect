// 0.7.2: what the agent needs that a setting alone cannot say. A stop that
// names alternatives makes one of them required, as one group; a system the
// code probes for is a fact the rule can use. Every case is built here; no
// repository's name decides anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { alternativesIn, probeFacts, stopMessage, onStartPath, entryFiles } from "../scripts/needs.mjs";
import { markdownOf, systemCount } from "../scripts/report.mjs";
import { ENV, inTemp, world, model, smallAgent, reportSchema, schemaProblems } from "./helpers.mjs";

const SANDBOX = [
  "import os",
  "import shutil",
  "",
  "",
  "def pick_sandbox():",
  "    if shutil.which(\"docker\"):",
  "        return \"docker\"",
  "    if os.environ.get(\"ACME_CLOUD_KEY\"):",
  "        return \"cloud\"",
  "    raise RuntimeError(",
  "        \"No sandbox is available. Install Docker, or set \"",
  "        \"ACME_CLOUD_KEY for Acme Cloud Sandboxes.\"",
  "    )",
  "",
].join("\n");
const agent = (extra = {}) => smallAgent({
  "pyproject.toml": "[project]\nname = \"helper\"\nlicense = \"Apache-2.0\"\ndependencies = [\n  \"langgraph>=1.0\",\n]\n\n[project.scripts]\nhelper = \"helper.cli:main\"\n",
  "src/helper/sandbox.py": SANDBOX,
  "src/helper/cli.py": "from helper.sandbox import pick_sandbox\n\n\ndef main():\n    pick_sandbox()\n",
  "src/helper/runtime.py": "from helper.sandbox import pick_sandbox\n\n\ndef start():\n    return pick_sandbox()\n",
  "src/helper/tracing.py": "import os\n\nTRACE = os.environ.get(\"ACME_TRACE_KEY\", \"\")\n",
  ...extra,
});
const idOf = (prompt, kind, test = () => true) => [...prompt.matchAll(new RegExp(`(F\\d{4,}) \\[${kind}\\] ([^\\n]*)`, "g"))].find((m) => test(m[2]))?.[1];
// The model writes Docker as not clear, and Acme Cloud as required with words that contradict the group.
const systems = (prompt) => {
  if (!prompt.includes("Section 5")) return { text: JSON.stringify({ findings: [] }) };
  const probe = idOf(prompt, "probe", (t) => /docker/.test(t));
  const cloud = idOf(prompt, "setting", (t) => /ACME_CLOUD_KEY/.test(t));
  const trace = idOf(prompt, "setting", (t) => /ACME_TRACE_KEY/.test(t));
  return { text: JSON.stringify({ findings: [
    { section: 5, kind: "system", title: "Docker for the sandbox", says: "It starts a container per job.", based_on: [probe], detail: { system: "Docker", need: "unclear", supply: "Docker on the machine", without: "No sandbox." } },
    { section: 5, kind: "system", title: "Acme Cloud for sandboxes and tracing", says: "It runs code in Acme Cloud and sends traces there.", based_on: [cloud, ...(trace ? [trace] : [])], detail: { system: "Acme Cloud", need: "required", supply: "Your Acme Cloud key", without: "No traces and no cloud sandboxes; local runs still work.", credentials: ["ACME_CLOUD_KEY", ...(trace ? ["ACME_TRACE_KEY"] : [])] } },
  ] }) };
};
const run = (files) => inTemp(async (at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model([systems]).ask }));

test("[F4.R14] a stop's message names its alternatives, with what is missing in its own words", () => {
  const said = "No sandbox is available: …. Install Docker and build the image, or set LANGSMITH_API_KEY and DESIGN_AGENT_SANDBOX_SNAPSHOT for LangSmith Sandboxes.";
  const alt = alternativesIn(said);
  assert.equal(alt.needs, "sandbox");
  assert.deepEqual(alt.options.map((o) => [o.name, o.settings]), [["Docker", []], ["LangSmith Sandboxes", ["LANGSMITH_API_KEY", "DESIGN_AGENT_SANDBOX_SNAPSHOT"]]]);
  assert.equal(alternativesIn("Docker is not installed or not on PATH; install Docker or choose another sandbox"), null, "an alternative that names no system or setting is no group");
  assert.equal(alternativesIn("Choose a vision model, or set … if that is intended."), null);
  const lines = SANDBOX.split("\n");
  assert.equal(stopMessage(lines, lines.findIndex((l) => /raise/.test(l))), "No sandbox is available. Install Docker, or set ACME_CLOUD_KEY for Acme Cloud Sandboxes.", "the message's strings joined, whatever their prefix");
});

test("[F4.R14] a probe: a program looked up on the PATH, or a stop that says it is not installed; a sentence with \"which\" in it is none", () => {
  const files = {
    "a.py": "import shutil\nif not shutil.which(\"ffmpeg\"):\n    raise SystemExit(\"ffmpeg is not installed\")\n",
    "b.sh": "#!/bin/bash\n# which tool does this use?\nif ! command -v git >/dev/null; then exit 1; fi\n",
    "c.py": "HELP = \"which needs no keys.\"\n",
  };
  const got = probeFacts(Object.keys(files), (f) => files[f]).map((p) => [p.file, p.data.system, p.data.how, p.data.stops]);
  assert.deepEqual(got, [["a.py", "FFmpeg", "on-path", true], ["a.py", "FFmpeg", "said", true], ["b.sh", "Git", "on-path", true]]);
});

test("[F4.R14] on the shared path only when its function is imported and called from an entry file and another file of its own", () => {
  const files = agent();
  const own = Object.keys(files).filter((f) => f.startsWith("src/"));
  const read = (f) => files[f] ?? null;
  const facts = [{ kind: "entry", file: "pyproject.toml", text: "helper = \"helper.cli:main\"" }];
  const entries = entryFiles({ files: Object.keys(files), read, facts });
  assert.ok(entries.has("src/helper/cli.py"));
  assert.equal(onStartPath({ file: "src/helper/sandbox.py", fn: "pick_sandbox" }, { ownFiles: own, read, entries }), true);
  const one = { ...files, "src/helper/runtime.py": "def start():\n    return None\n" };
  assert.equal(onStartPath({ file: "src/helper/sandbox.py", fn: "pick_sandbox" }, { ownFiles: own, read: (f) => one[f] ?? null, entries }), false, "one command's own step");
  const word = { ...files, "src/helper/runtime.py": "def start():\n    return 'pick_sandbox'\n" };
  assert.equal(onStartPath({ file: "src/helper/sandbox.py", fn: "pick_sandbox" }, { ownFiles: own, read: (f) => word[f] ?? null, entries }), false, "a word two files share is not a call");
});

test("[F4.A13] one of these is required: a Sandbox group by rule, Docker said only in it, Acme Cloud kept with its other use and never contradicting it", async () => {
  const out = await run(agent());
  assert.deepEqual(schemaProblems(out.report, reportSchema()), []);
  const five = out.report.findings.filter((f) => f.section === 5 && f.kind === "system");
  const group = five.find((f) => f.by === "script");
  assert.equal(group.title, "Sandbox");
  assert.equal(group.detail.need, "required");
  assert.equal(group.detail.need_by, "rule");
  assert.deepEqual(group.detail.one_of.map((c) => [c.name, c.supply]), [["Docker", "Install Docker"], ["Acme Cloud Sandboxes", "Your Acme Cloud key"]]);
  assert.deepEqual(group.evidence, [{ file: "src/helper/sandbox.py", line: 10 }]);
  const docker = five.find((f) => f.detail.system === "Docker");
  assert.equal(docker.detail.need, "one-of", "said only in the group");
  assert.equal(docker.detail.member_of, "Sandbox");
  const cloud = five.find((f) => f.detail.system === "Acme Cloud");
  assert.equal(cloud.detail.need, "optional", "the model's required is not the rule's: it is one of the choices, and its tracing is optional");
  assert.equal(cloud.detail.member_of, "Sandbox");
  assert.equal(cloud.detail.without, "the sandbox must come from Docker", "never that local runs still work");
  assert.deepEqual(systemCount(out.report.findings, out.report.facts), { required: 1, all: 2 });
  const md = markdownOf(out.report);
  assert.match(md, /Systems required: 1 of 2\./);
  assert.match(md, /One of them is required: Docker \(you supply: Install Docker\), or Acme Cloud Sandboxes \(you supply: Your Acme Cloud key; settings ACME\\_CLOUD\\_KEY\)\./);
  assert.ok(!/local runs still work/.test(md));
});

test("[F4.A13] the same stop called from one place only makes no group, and the systems keep their own needs", async () => {
  const out = await run(agent({ "src/helper/runtime.py": "def start():\n    return None\n" }));
  const five = out.report.findings.filter((f) => f.section === 5 && f.kind === "system");
  assert.equal(five.filter((f) => f.by === "script").length, 0);
  assert.ok(five.every((f) => !f.detail.member_of));
});

test("[F4.R14] a probed system the code stops without on the shared path is required by rule", async () => {
  const files = smallAgent({
    "pyproject.toml": "[project]\nname = \"helper\"\nlicense = \"Apache-2.0\"\ndependencies = [\n  \"langgraph>=1.0\",\n]\n\n[project.scripts]\nhelper = \"helper.cli:main\"\n",
    "src/helper/media.py": "import shutil\n\n\ndef need_ffmpeg():\n    if shutil.which(\"ffmpeg\") is None:\n        raise RuntimeError(\"ffmpeg is not installed\")\n",
    "src/helper/cli.py": "from helper.media import need_ffmpeg\n\n\ndef main():\n    need_ffmpeg()\n",
    "src/helper/runtime.py": "from helper.media import need_ffmpeg\n\n\ndef start():\n    need_ffmpeg()\n",
  });
  const ask = (prompt) => {
    if (!prompt.includes("Section 5")) return { text: JSON.stringify({ findings: [] }) };
    return { text: JSON.stringify({ findings: [{ section: 5, kind: "system", title: "FFmpeg for video", says: "It cuts video with FFmpeg.", based_on: [idOf(prompt, "probe", (t) => /ffmpeg/.test(t))], detail: { system: "FFmpeg", need: "optional", supply: "FFmpeg on the machine" } }] }) };
  };
  const out = await inTemp(async (at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model([ask]).ask }));
  const ff = out.report.findings.find((f) => f.section === 5 && f.detail?.system === "FFmpeg");
  assert.equal(ff.detail.need, "required");
  assert.equal(ff.detail.need_by, "rule");
  assert.equal(ff.detail.need_why, "the code stops when it is not there");
});

test("[F4.R14] the model provider by rule: own code that calls a model needs one of the providers it names; one named is required on its own", async () => {
  const withModels = (models) => agent({
    "src/helper/models.py": `from langchain.chat_models import init_chat_model\n\nMODELS = [\n${models.map((m) => `    "${m}",`).join("\n")}\n]\n\n\ndef lead():\n    return init_chat_model(MODELS[0])\n`,
  });
  const ask = (prompt) => {
    if (!prompt.includes("Section 5")) return { text: JSON.stringify({ findings: [] }) };
    const m = idOf(prompt, "model", (t) => /anthropic/.test(t));
    return { text: JSON.stringify({ findings: [
      { section: 5, kind: "system", title: "Anthropic models for the lead", says: "The lead calls Claude.", based_on: [m], detail: { system: "Anthropic", need: "unclear", supply: "Your Anthropic key" } },
      { section: 5, kind: "system", title: "OpenAI for generated images", says: "Images come from OpenAI.", based_on: [idOf(prompt, "setting", (t) => /ACME_TRACE_KEY/.test(t))], detail: { system: "OpenAI images", need: "optional", supply: "Your OpenAI key" } },
    ] }) };
  };
  const inspectWith = (files) => inTemp(async (at) => inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files }).fetchImpl, ask: model([ask]).ask }));
  const two = await inspectWith(withModels(["anthropic:claude-sonnet-5-5", "openai:gpt-6-sol"]));
  const five = two.report.findings.filter((f) => f.section === 5 && f.kind === "system");
  const mp = five.find((f) => f.by === "script" && f.title === "Model provider");
  assert.equal(mp.detail.need, "required");
  assert.deepEqual(mp.detail.one_of.map((c) => [c.name, c.supply]), [["Anthropic", "Your Anthropic key"], ["OpenAI", "Your OpenAI key"]]);
  assert.equal(five.find((f) => f.title === "Anthropic models for the lead").detail.need, "one-of", "said only in the group");
  assert.equal(five.find((f) => f.title === "OpenAI for generated images").detail.member_of, undefined, "an image service of the same maker is no model provider");
  const one = await inspectWith(withModels(["anthropic:claude-sonnet-5-5"]));
  const five1 = one.report.findings.filter((f) => f.section === 5 && f.kind === "system");
  assert.ok(!five1.some((f) => f.title === "Model provider"));
  const a = five1.find((f) => f.title === "Anthropic models for the lead");
  assert.deepEqual([a.detail.need, a.detail.need_by, a.detail.need_why], ["required", "rule", "its own code calls a model, and this is the only provider it names"]);
});
