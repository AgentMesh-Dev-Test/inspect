// F5.R9, how the report's view draws (0.3.0): one row of five tabs with
// nothing above it. Overview describes the whole agent (its description, how
// much is there, what was inspected, two lines about Inspect at the foot);
// What it does has jobs with the skills that do them and the skills with
// their size; What it reaches one row per outside system, required or
// optional and what the person supplies; Risks the risks by level as the
// filter, the summary for security and every risk with how to make it safe;
// Tests and gaps each test row with its size. A skill's instructions open in
// a viewer. Nothing on the page names a file, a line or an advisory id.
//
// What is worth pinning, from the view's own script run against a stand-in
// page: the tabs in the ARIA tabs pattern, with their keys; each tab's rows
// and what an open row shows; the viewer at both widths and its Markdown
// drawn as text; the line under the tabs while the job runs; a tab that
// stays where the person put it when new data arrives; the type sizes; and
// the words and references that must never be drawn. How it lays out at a
// width is checked in a headless browser (test/view-host.html; the build
// record says how).
//
// Nothing here starts a browser or touches a network: the stand-in page is a
// few elements in this file, and the view's script runs in a vm context.
//   node --test test/view-draw.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { buildReport, workingCopy } from "../scripts/report.mjs";
import { ROOT, SHA, descriptor, claudePlugin, ENV, inTemp, model, world } from "./helpers.mjs";
import { inspect } from "../scripts/inspect-a-repository.mjs";
import { loadDatabase, platformUses, readingOf } from "../scripts/platforms.mjs";

const html = readFileSync(join(ROOT, "views", "report.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const KIND = "application/vnd.agentmesh.inspection-report+json";
const WORDS = ["Critical", "High", "Medium", "Low", "No risk", "Not rated"];
// 0.6.0: Could it move? after Systems it uses.
const TAB_NAMES = ["Overview", "What it does", "Systems it uses", "Could it move?", "Risks", "Tests and gaps"];
// Words that explain a count, a section or how the report was made, a
// status, a section code or a category code: never drawn.
const NEVER = [
  /repeated from sections/i, /findings: /, /\bS\d-\d{3}\b/, /\bS\d\b/, /LLM0/, /ASI0/, /Showing \d+ of/, /Show all/,
  /written last/i, /leaves out/i, /read this code without running/i, /For your security team/i, /that decision is yours/i,
  /Inspection report/i, /Draft/, /Accepted/, /Published/, /waiting for your review/i, /Nothing here yet/i, /arrive with the report/i,
  /\b[0-9a-f]{40}\b/, /sections? \d/i, /Drawn by/i, /Delivered/,
];

// ── The stand-in page: just enough of the DOM for the view to draw into ──
let doc = null;
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === "string" ? new Text(k) : k; n.parentNode = this; this.childNodes.push(n); } }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes = []; if (v !== "") this.append(new Text(String(v))); }
  get firstChild() { return this.childNodes[0] ?? null; }
}
class Text extends Node { constructor(data) { super(); this.data = data; } get textContent() { return this.data; } }
class Element extends Node {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.listeners = {}; this.dataset = {};
    const props = new Map();
    this.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) };
    const self = this;
    this.classList = {
      add: (c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(" "); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains: (c) => self.className.split(/\s+/).includes(c),
    };
  }
  get className() { return this.attrs.get("class") ?? ""; }
  set className(v) { this.attrs.set("class", String(v)); }
  get id() { return this.attrs.get("id") ?? ""; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this, currentTarget: this }); }
  /** A key pressed while focus is in this element, as the browser hands it to listeners on the way up. */
  press(key) {
    let prevented = false;
    const e = { key, target: this, preventDefault: () => { prevented = true; } };
    for (let n = this; n; n = n.parentNode) for (const fn of n.listeners?.keydown ?? []) fn({ ...e, currentTarget: n });
    return prevented;
  }
  focus() { doc.activeElement = this; }
  scrollIntoView() { this.scrolled = (this.scrolled ?? 0) + 1; }
  getBoundingClientRect() { return { height: 900, width: 690 }; }
  closest() { return null; }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  matches(sel) {
    return sel.split(",").some((one) => {
      const m = one.trim().match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i);
      if (!m) throw new Error(`the stand-in page does not read the selector ${one}`);
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (!m[2].split(".").filter(Boolean).every((c) => this.classList.contains(c))) return false;
      return [...m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) => (v === undefined ? this.getAttribute(k) !== null : this.getAttribute(k) === v));
    });
  }
  /** Descendants matching a chain of simple selectors, as "a b". */
  querySelectorAll(sel) {
    const steps = sel.trim().split(/\s+/);
    let at = [this];
    for (const s of steps) at = [...new Set(at.flatMap((n) => descendants(n).filter((d) => d.matches(s))))];
    return at;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const descendants = (n) => n.children.flatMap((c) => [c, ...descendants(c)]);

// A level's shape is drawn as markup into an <svg>; the stand-in keeps the
// markup, so a test can say which shape it is.
class Template extends Element {
  constructor() { super("template"); this.content = { firstChild: null }; }
  set innerHTML(v) { const svg = new Element("svg"); svg.markup = String(v).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, ""); this.content.firstChild = svg; }
}

function page() {
  const sent = [];
  const listeners = [];
  const root = new Element("html");
  const body = new Element("body");
  const app = new Element("main"); app.setAttribute("id", "app");
  const layerEl = new Element("div"); layerEl.setAttribute("id", "layer");
  const toastEl = new Element("div"); toastEl.setAttribute("id", "toast");
  root.append(body); body.append(app, layerEl, toastEl);
  let say = () => {};
  // The host's side, as Next's bridge answers: a resize request gets the
  // height back, a moment later; a file offered is saved.
  const parent = { postMessage: (m) => {
    sent.push(m);
    if (m.method === "view/resize" && m.id !== undefined) queueMicrotask(() => say({ id: m.id, result: { height: m.params.height } }));
    if (m.method === "view/save-file" && m.id !== undefined) queueMicrotask(() => say({ id: m.id, result: { saved: true } }));
    if (m.method === "view/copy-text" && m.id !== undefined) queueMicrotask(() => say({ id: m.id, result: { copied: true } }));
  } };
  const keys = [];
  const document = {
    documentElement: root, body, activeElement: null,
    addEventListener: (type, fn) => { if (type === "keydown") keys.push(fn); },
    press: (key) => { for (const fn of keys) fn({ key, preventDefault() {} }); },
    createElement: (t) => (t === "template" ? new Template() : new Element(t)),
    createTextNode: (s) => new Text(s),
    getElementById: (id) => [root, ...descendants(root)].find((n) => n.id === id) ?? null,
  };
  doc = document;
  const window = {
    parent, scrollY: 0, scrollTo() {},
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
  };
  // The view waits up to 20 seconds for an answer it is never given here;
  // those waits must not hold the test open.
  const later = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  const context = vm.createContext({ window, document, Node, setTimeout: later, clearTimeout, requestAnimationFrame: (fn) => fn(), TextDecoder, atob, URL, Intl, console });
  vm.runInContext(script, context);
  say = (m) => { for (const fn of listeners) fn({ source: parent, data: { jsonrpc: "2.0", ...m } }); };
  return { app, layer: layerEl, sent, say, document };
}

/** The view, drawn with one report, as a host sends it (DESCRIPTOR-UI Section 9.4), with Inspect's Descriptor. */
function drawn(report, { job_state = "completed", lifecycle = "draft", desc = descriptor(), width = 690 } = {}) {
  const p = page();
  p.say({ id: "h-1", method: "view/initialize", params: { version: "descriptor-view-v1", color_scheme: "light", locale: "en-US", width } });
  p.data = (r, o = {}) => p.say({ method: "view/data", params: { name: "inspection", media_type: KIND, text: JSON.stringify(r), lifecycle: o.lifecycle === undefined ? null : o.lifecycle, job_state: o.job_state ?? "working", descriptor: desc } });
  p.say({ method: "view/data", params: { name: "inspection", media_type: KIND, text: JSON.stringify(report), lifecycle, job_state, descriptor: desc } });
  assert.ok(!p.sent.some((m) => m.method === "view/report-failure"), `the view drew: ${JSON.stringify(p.sent.find((m) => m.method === "view/report-failure"))}`);
  return p;
}
const tabsOf = (app) => app.querySelectorAll('button[role="tab"]');
const tabNamed = (app, name) => tabsOf(app).find((t) => t.querySelector(".tab-name").textContent === name);
const shownPanel = (app) => { const open = app.querySelectorAll('div[role="tabpanel"]').filter((p) => p.getAttribute("hidden") === null); assert.equal(open.length, 1, "one panel shows"); return open[0]; };
const selected = (app) => tabsOf(app).filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.querySelector(".tab-name").textContent);
const resizes = (sent) => sent.filter((m) => m.method === "view/resize").length;
const ticks = async (n = 5) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
const rowOf = (app, id) => app.querySelectorAll("li.row").find((r) => r.id === `f-${id}`);
/** Everything a person reads on the page: its words, and the names given to assistive technology. */
const readable = (n) => [n.textContent, ...descendants(n).map((e) => e.getAttribute?.("aria-label") ?? "").filter(Boolean)].join("\n");

// ── A report shaped like the design-agent one, small ──
const ev = (file, line) => [{ file, line, text: "x" }];
const cat = (id, name = id, list) => ({ id, name, ...(list ? { list } : {}) });
const LONG = "Shell execution through Docker, with the host's socket mounted into the sandbox the model's commands run in";
function findings() {
  const out = [
    { id: "S2-001", section: 2, kind: "repository", title: "The repository", says: "langchain-ai/design-agent on GitHub.", by: "script", evidence: ev("README.md", 1), detail: { owner: "langchain-ai", name: "design-agent" } },
    { id: "S2-002", section: 2, kind: "commit", title: "The commit", says: `Commit ${SHA}.`, by: "script", evidence: ev("README.md", 1), detail: { sha: SHA, date: "2026-11-24T10:00:00Z", checked: true } },
    { id: "S2-003", section: 2, kind: "publisher", title: "The publisher", says: "Published by langchain-ai, a GitHub organization.", by: "script", evidence: ev("README.md", 1), detail: { login: "langchain-ai", type: "Organization" } },
    { id: "S2-004", section: 2, kind: "license", title: "The license", says: "Licensed Apache-2.0, as its LICENSE says.", by: "script", evidence: ev("LICENSE", 1), categories: [cat("Apache-2.0", "Apache-2.0", "spdx-license-list")], detail: { spdx: "Apache-2.0" } },
    { id: "S2-005", section: 2, kind: "built-on", title: "What it is built on", says: "Written in Python (120 files), TypeScript (40 files).", by: "script", evidence: ev("pyproject.toml", 1), detail: { languages: [{ language: "Python", files: 120 }, { language: "TypeScript", files: 40 }], frameworks: ["LangChain", "LangGraph"] } },
    { id: "S2-006", section: 2, kind: "activity", title: "How actively it is kept up", says: "Last pushed 24 Nov 2026; 37 commits in the 90 days before the inspection.", by: "script", evidence: ev("README.md", 1), detail: { pushed_at: "2026-11-24T09:00:00Z", archived: false, commits_last_90_days: 37 } },
    { id: "S3-001", section: 3, kind: "skill", title: "brand-lint", says: "A skill.", by: "script", evidence: ev("skills/brand-lint/SKILL.md", 1) },
    { id: "S4-001", section: 4, kind: "model", title: "Claude through LangChain", says: "The model.", by: "model", evidence: ev("src/design_agent/models.py", 12) },
    { id: "S5-001", section: 5, kind: "system", title: "Slack", says: "It posts to Slack.", by: "model", evidence: ev("surfaces/slack/bolt_app.py", 64) },
    { id: "S6-011", section: 6, kind: "autonomy", title: "Which tools run without an OK", says: "Every tool runs without one.", by: "model", evidence: ev("src/design_agent/assembly.py", 362) },
    { id: "S7-001", section: 7, kind: "risk", title: "@hono/node-server 2.1.5: GHSA-jpvv-r467-5p4w", says: "A known vulnerability.", by: "script", level: "medium", level_by: "source", categories: [cat("LLM03:2025", "Supply Chain", "owasp-top-10-llm-2025"), cat("ASI04", "Agentic Supply Chain Vulnerabilities", "owasp-top-10-agentic"), cat("pkg:npm/%40hono/node-server@2.1.5", "@hono/node-server 2.1.5", "cyclonedx-1.5"), cat("GHSA-jpvv-r467-5p4w", "GHSA-jpvv-r467-5p4w", "osv")], evidence: ev("sandbox/render/package-lock.json", 449) },
    { id: "S7-012", section: 7, kind: "risk", title: LONG, says: "It can run commands.", by: "model", level: "high", level_by: "model", categories: [cat("ASI05", "Unexpected Code Execution", "owasp-top-10-agentic"), cat("LLM06:2025", "Excessive Agency", "owasp-top-10-llm-2025")], evidence: [...ev("src/design_agent/runtime/sandbox/docker.py", 138), ...ev("src/design_agent/runtime/sandbox/docker.py", 140)] },
    { id: "S7-021", section: 7, kind: "risk", title: "Gemini key sent in a URL", says: "The key is in the query.", by: "model", level: "low", level_by: "model", categories: [cat("LLM02:2025", "Sensitive Information Disclosure", "owasp-top-10-llm-2025")], evidence: ev("skills/motion-graphics/grounding/locate.mjs", 192) },
    { id: "S7-023", section: 7, kind: "risk", title: "Sandbox build fetches are pinned", says: "Pinned.", by: "model", level: "none", level_by: "model", categories: [cat("LLM03:2025", "Supply Chain", "owasp-top-10-llm-2025")], evidence: ev("sandbox/Dockerfile", 4) },
    { id: "S7-027", section: 7, kind: "least-access", title: "Least access to run it", says: "What it needs.", by: "model", evidence: ev("src/design_agent/runtime/sandbox/docker.py", 138) },
    { id: "S8-001", section: 8, kind: "could-not-tell", title: "Spending caps", says: "Not in the code.", by: "model", evidence: ev("tests/unit/harness/test_meter.py", 40) },
  ];
  // Section 1, as checkGlance writes it: a copy of the finding it repeats,
  // with that finding's level when it has one. The autonomy finding has none.
  const glance = (target, extra = {}) => ({ section: 1, kind: "glance", title: target.title, says: `Again: ${target.says}`, by: "model", repeats: target.id, evidence: target.evidence, ...(target.level ? { level: target.level, level_by: target.level_by } : {}), ...extra });
  const byId = Object.fromEntries(out.map((f) => [f.id, f]));
  const g = [glance(byId["S7-012"]), glance(byId["S6-011"]), glance(byId["S7-023"])];
  // One whose own copy lost its level (an older report): the view takes the level of the finding it repeats.
  const bare = glance(byId["S7-021"]); delete bare.level; delete bare.level_by;
  g.push(bare);
  return [...g.map((f, i) => ({ id: `S1-00${i + 1}`, ...f })), ...out];
}
const ABOUT = { owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, started_at: "2026-11-25T18:25:40Z", version: "0.2.4" };
const report = (list = findings(), held = [], facts = []) => buildReport({ owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, date: "2026-11-24T10:00:00Z", version: "0.2.4", now: "2026-11-25T18:29:10Z", findings: list, held, facts, bom: { components: [] }, osv: { asked: 0 }, usage: {} });
const copyOf = (list, stage = "Asking the model.") => workingCopy({ about: ABOUT, findings: list, stage });

const levelOf = (badge) => ({ word: badge.querySelector(".word")?.textContent ?? "", shape: badge.querySelector("svg")?.markup ?? "" });
const SHAPE_OF = Object.fromEntries([...script.matchAll(/\n    (critical|high|medium|low|none|unrated): '([^']+)'/g)].map((m) => [m[1], m[2]]));

// ── 0.3.0: a report shaped like the design-agent one, with what the new tabs draw ──
const SKILL_TEXT = [
  "# Brand lint", "<!-- Sourced from the brand skill: an editor's note, never drawn (0.5.6) -->", "", "Checks a draft against the brand pack.", "", "## Steps", "",
  "- Read the [brand pack](https://example.com/brand) first", "- Run the check on the draft", "",
  "```bash", "node lint.mjs <file>", "```", "", "<b>bold?</b> ![logo](https://example.com/logo.png) and **strong** words",
].join("\n");
const ADDRESS = `https://github.com/langchain-ai/design-agent/blob/${SHA}/skills/stills/SKILL.md`;
function rich() {
  const facts = [
    { id: "F0001", kind: "skill", file: "skills/brand-lint/SKILL.md", line: 1, data: { name: "brand-lint", folder: "skills/brand-lint" } },
    { id: "F0002", kind: "skill", file: "skills/stills/SKILL.md", line: 1, data: { name: "stills", folder: "skills/stills" } },
    { id: "F0003", kind: "setting", file: "skills/stills/scripts/gen.mjs", line: 4, data: { name: "GEMINI_API_KEY", credential: true, how: "fails" } },
    { id: "F0004", kind: "setting", file: "src/app.py", line: 9, data: { name: "SLACK_BOT_TOKEN", credential: true, how: "fails" } },
    { id: "F0005", kind: "test-file", file: "tests/unit/test_lint.py", line: 3, data: { cases: 12, kind: "unit", live: false } },
    { id: "F0006", kind: "test-file", file: "tests/live/test_slack.py", line: 3, data: { cases: 2, kind: "live", live: true } },
    { id: "F0007", kind: "own-code", file: "src/app.py", line: 1, data: { files: 40, lines: 4100 } },
    { id: "F0008", kind: "setting", file: "skills/brand-lint/scripts/lint.mjs", line: 2, data: { name: "ELEVENLABS_API_KEY", credential: true, how: "guard" } },
  ];
  const base = findings().filter((f) => !["S3-001", "S5-001"].includes(f.id));
  const skill = (id, title, detail) => ({ id, section: 3, kind: "skill", title, says: `${title}.`, by: "script", based_on: [], evidence: ev(`${detail.path}/SKILL.md`, 1), detail: { lift_out: "no", ...detail } });
  const list = [
    { id: "S1-010", section: 1, kind: "description", title: "What it is", says: "Content Studio is a design agent that lives in Slack. It makes on-brand images and short videos for a design team.", by: "model", based_on: ["F0001"], evidence: ev("src/app.py", 1) },
    ...base,
    { id: "S3-020", section: 3, kind: "skill", title: "Skills", says: "2 skills of the agent's own, and 1 skill kept for coding assistants.", by: "script", based_on: ["F0001"], evidence: ev("skills/brand-lint/SKILL.md", 1), detail: { own: 2, for_coding_assistants: 1 } },
    skill("S3-011", "Make still images", { name: "stills", path: "skills/stills", description: "Make still images on brand.", instructions_only: true, size: { scripts: 0, lines: 0, instructions_chars: 900, tests: { files: 0, cases: 0 } }, instructions: "Make stills.", instructions_cut: true, instructions_address: ADDRESS }),
    skill("S3-010", "Check a draft against the brand pack", { name: "brand-lint", path: "skills/brand-lint", description: "Check a draft against the brand pack.", does: "It flags colours, fonts and logos that break the brand pack.", plain: true, lift_out: "yes", size: { scripts: 2, lines: 640, instructions_chars: 400, tests: { files: 1, cases: 12 } }, instructions: SKILL_TEXT, instructions_cut: false, instructions_address: null }),
    skill("S3-012", "Release check", { name: "release-check", path: ".claude/skills/release-check", for_coding_assistants: true, instructions_only: true, size: { scripts: 0, lines: 0, instructions_chars: 200, tests: { files: 0, cases: 0 } }, instructions: "Check a release." }),
    { id: "S3-030", section: 3, kind: "job", title: "Makes on-brand still images", says: "It turns a request in Slack into images that follow the brand pack.", by: "model", based_on: ["F0002", "F0001"], evidence: ev("skills/stills/SKILL.md", 1) },
    { id: "S3-040", section: 3, kind: "code", title: "Its own code", says: "40 files and 4,100 lines of code outside its skills and its tests.", by: "script", based_on: ["F0007"], evidence: ev("src/app.py", 1), detail: { files: 40, lines: 4100 } },
    { id: "S3-041", section: 3, kind: "code", title: "Slack app, tools and a sandbox runner", says: "Its own code runs the Slack app, the tools and a sandbox.", by: "model", based_on: ["F0007"], evidence: ev("src/app.py", 1) },
    { id: "S3-050", section: 3, kind: "part", title: "Brand lint", says: "skills/brand-lint/scripts/lint.mjs runs as a command.", by: "script", based_on: ["F0001"], evidence: ev("skills/brand-lint/scripts/lint.mjs", 1) },
    { id: "S5-010", section: 5, kind: "system", title: "Slack: reads requests and posts replies", says: "It reads the threads it is mentioned in.", by: "model", based_on: ["F0004"], evidence: ev("src/app.py", 9), detail: { system: "Slack", need: "required", supply: "A Slack app and its two tokens", without: "The agent won't start.", sends: "Replies and files, in the thread.", credentials: ["SLACK_BOT_TOKEN"] } },
    { id: "S5-011", section: 5, kind: "system", title: "ElevenLabs: voiceover", says: "It sends scripts to ElevenLabs.", by: "model", based_on: ["F0008"], evidence: ev("skills/brand-lint/scripts/lint.mjs", 2), detail: { system: "ElevenLabs", need: "optional", supply: "Your ElevenLabs key", without: "Videos have no voiceover.", sends: "The words to be spoken." } },
    { id: "S5-020", section: 5, kind: "credential", title: "Gemini API key", says: "It reads the credential GEMINI_API_KEY from its environment.", by: "script", based_on: ["F0003"], evidence: ev("skills/stills/scripts/gen.mjs", 4), detail: { env: "GEMINI_API_KEY", read_by_code: true, how: "fails" } },
    { id: "S5-021", section: 5, kind: "credential", title: "Slack bot token", says: "It reads the credential SLACK_BOT_TOKEN.", by: "script", based_on: ["F0004"], evidence: ev("src/app.py", 9), detail: { env: "SLACK_BOT_TOKEN", read_by_code: true, how: "fails" } },
    { id: "S7-030", section: 7, kind: "risk", title: "Outside content can steer powerful actions", says: "Text from pull requests reaches a model that can run commands.", by: "model", level: "high", level_by: "model", categories: [cat("LLM01:2025", "Prompt Injection", "owasp-top-10-llm-2025")], evidence: ev("src/tools.py", 3), detail: { safe: "Put shell commands behind a person's OK." } },
    { id: "S7-031", section: 7, kind: "risk", title: "hono 4.13.13 has known security flaws", says: "Two flaws.", by: "script", level: "medium", level_by: "source", categories: [cat("LLM03:2025", "Supply Chain", "owasp-top-10-llm-2025"), cat("GHSA-3gg2-335m-rxc6", "GHSA-3gg2-335m-rxc6", "osv")], evidence: ev("sandbox/render/package-lock.json", 1365), detail: { name: "hono", version: "4.13.13", advisories: [{ id: "GHSA-3gg2-335m-rxc6", summary: "css helper does not escape a closing tag", fixed: "4.13.16" }, { id: "GHSA-46wx-v44x-9hh2", summary: "`csrf()` does not check pings", fixed: "4.13.16" }], safe: "Update hono to 4.13.16 or later." } },
    { id: "S8-010", section: 8, kind: "test", title: "Unit tests cover the lint", says: "The lint has unit tests.", by: "model", based_on: ["F0005"], evidence: ev("tests/unit/test_lint.py", 3) },
    { id: "S8-011", section: 8, kind: "test", title: "Tests", says: "14 tests in 2 files.", by: "script", based_on: ["F0005", "F0006"], evidence: ev("tests/unit/test_lint.py", 3), detail: { files: 2, cases: 14, live: 2 } },
  ];
  return { list, facts };
}
const richReport = (held = []) => { const { list, facts } = rich(); return report(list, held, facts); };

test("[F5.R9] the view is one row of six tabs with nothing above it, in the ARIA tabs pattern, with no count on any tab; Risks names its highest level as a word and a shape; it starts on Overview", () => {
  const r = richReport();
  const { app } = drawn(r);
  assert.equal(app.children[0].className, "tabs-wrap", "the tabs come first: no head, no title, no status line above them");
  assert.equal(app.querySelectorAll('div[role="tablist"]').length, 1, "one row of tabs");
  assert.equal(app.querySelector("h1"), null, "no title of its own");
  const tabs = tabsOf(app);
  assert.deepEqual(tabs.map((t) => t.querySelector(".tab-name").textContent), TAB_NAMES, "no About tab: Inspect's own words are at the foot of the Overview");
  assert.deepEqual(selected(app), ["Overview"]);
  for (const [i, t] of tabs.entries()) {
    const on = i === 0;
    assert.equal(t.getAttribute("tabindex"), on ? "0" : "-1");
    const panel = app.querySelectorAll('div[role="tabpanel"]').find((p) => p.id === t.getAttribute("aria-controls"));
    assert.equal(panel.getAttribute("aria-labelledby"), t.id);
    assert.equal(panel.getAttribute("hidden") === null, on);
    assert.ok(!/\d/.test(t.textContent), `${TAB_NAMES[i]} carries no count`);
    if (TAB_NAMES[i] !== "Risks") assert.equal(t.getAttribute("aria-label"), TAB_NAMES[i]);
  }
  const risks = tabNamed(app, "Risks");
  assert.equal(levelOf(risks.querySelector(".lv")).word, "High");
  assert.equal(levelOf(risks.querySelector(".lv")).shape, SHAPE_OF.high);
  assert.match(risks.getAttribute("aria-label"), /, the highest High$/);
});

test("[F5.R9] Overview describes the whole agent: the description first, then how much is there as tiles each with an icon, counting only its own skills, then what was inspected with the commit; nothing at its foot; no risk on it", async () => {
  const { app, sent } = drawn(richReport());
  const panel = shownPanel(app);
  assert.equal(panel.children[0].className, "lead", "the description is the anchor, first");
  assert.match(panel.children[0].textContent, /^Content Studio is a design agent/);
  const tiles = panel.querySelector("ul.size-tiles").querySelectorAll("li");
  assert.deepEqual(tiles.map((t) => [t.querySelector(".v").textContent, t.querySelector(".k").textContent]), [["2", "Skills"], ["2", "Scripts in its skills, 640 lines"], ["4,100", "Lines of its own code"], ["14", "Tests, 12 run offline"], ["2 of 3", "Systems required"]], "only the agent's own skills: the one kept for coding assistants is not counted");
  assert.ok(tiles.every((t) => t.querySelector("svg")?.markup), "each tile has an icon");
  assert.ok(script.includes('aria-hidden="true" focusable="false">${inner}</svg>'), "every icon is for the eye only; its words say it");
  assert.ok(!/coding assistants/.test(readable(panel)), "no count line about coding assistants");
  const pairs = (dl) => Object.fromEntries(dl.children.reduce((a, n, i, all) => (n.tagName === "DT" ? [...a, [n.textContent, all[i + 1].textContent]] : a), []));
  const shown = pairs(panel.querySelector("dl.facts"));
  assert.equal(shown.Commit, "86d8f66, Nov 24, 2026");
  assert.equal(shown.License, "Apache-2.0");
  assert.equal(shown.Repository, undefined, "the header names the repository and links it; the Overview keeps the commit");
  assert.equal(panel.querySelector(".about-foot"), null, "no lines about Inspect at the foot");
  assert.ok(!/About Inspect|What it doesn't do/.test(readable(panel)));
  assert.equal(panel.children.at(-1).tagName, "DL", "what was inspected is the last thing on it");
  const { list, facts } = rich();
  const newest = list.map((f) => (f.id === "S2-002" ? { ...f, detail: { ...f.detail, newest_on: "main" } } : f));
  const again = drawn(report(newest, [], facts));
  assert.equal(pairs(shownPanel(again.app).querySelector("dl.facts")).Commit, "86d8f66, Nov 24, 2026, the newest on main", "a commit read because none was named says it was the newest");
  assert.equal(panel.querySelector(".tiles"), null, "no risk tiles on the Overview");
  assert.equal(panel.querySelectorAll("li.row").length, 0, "no risk rows");
  assert.ok(!/Save a summary/.test(panel.textContent), "the summary for security is on Risks");
});

test("[F5.R9] Risks: the risks by level are the filter, the summary for security is here, every risk highest first from any section; opened, a row says what it means, how to make it safe and its category, and nothing else", async () => {
  const { app, sent } = drawn(richReport());
  tabNamed(app, "Risks").click();
  const panel = shownPanel(app);
  const tiles = panel.querySelectorAll("button.tile");
  assert.deepEqual(tiles.map((t) => t.textContent), ["0Critical risks", "2High risks", "2Medium risks", "1Low risk", "1No risk", "1Not rated"], "the tiles add up to the rows shown");
  const rows = () => shownPanel(app).querySelector("ul.rows.rated").querySelectorAll("li.row");
  assert.equal(rows().length, 7);
  assert.deepEqual(rows().map((r) => r.querySelector(".lv .word").textContent), ["High", "High", "Medium", "Medium", "Low", "No risk", "Not rated"], "highest first");
  assert.ok(rows().some((r) => r.id === "f-S6-011"), "a judgment section 1 points to is a risk, Not rated");
  tiles.find((t) => /High/.test(t.textContent)).click();
  assert.equal(rows().length, 2, "a tile shows its level alone");
  assert.equal(shownPanel(app).querySelectorAll("button.tile").find((t) => /High/.test(t.textContent)).getAttribute("aria-pressed"), "true");
  shownPanel(app).querySelectorAll("button.tile").find((t) => /High/.test(t.textContent)).click();
  assert.equal(rows().length, 7, "pressed again, every risk");
  assert.equal(shownPanel(app).querySelectorAll("button.tile").find((t) => /Critical/.test(t.textContent)).getAttribute("disabled"), "", "a level with none can't be chosen");
  rowOf(app, "S7-031").querySelector(".toggle").click();
  const open = rowOf(app, "S7-031").querySelector(".detail");
  assert.deepEqual(open.querySelectorAll(".advisories li").map((li) => li.textContent), ["Css helper does not escape a closing tag. Fixed in 4.13.16.", "csrf() does not check pings. Fixed in 4.13.16."], "each flaw's summary and fix, no advisory id");
  const dts = open.querySelectorAll("dt").map((x) => x.textContent);
  assert.deepEqual(dts, ["To make it safe", "Category"]);
  assert.ok(!/GHSA|package-lock|:\d|In the code|Copy/.test(readable(open)), "no id, no file, no line, no Copy");
  shownPanel(app).querySelector('button[data-k="save"]').click();
  await ticks();
  const saved = sent.filter((m) => m.method === "view/save-file").at(-1);
  assert.match(saved.params.name, /^security-summary-langchain-ai-design-agent-86d8f66\.txt$/);
});

test("[F5.R9] What it does: jobs naming the skills that do them, the skills the most substantial first with a size in words and a bar, its own code in a few words with its size, and no list of scripts", () => {
  const { app } = drawn(richReport(), { width: 1100 });
  tabNamed(app, "What it does").click();
  const panel = shownPanel(app);
  assert.deepEqual(panel.querySelectorAll("h3").map((h) => h.textContent), ["Jobs", "Skills", "Its own code"]);
  assert.equal(rowOf(app, "S3-012"), undefined, "the coding assistants' skills are counted on the Overview, never listed");
  assert.deepEqual(panel.querySelectorAll("h2").map((h) => h.textContent), ["How it works"], "no heading repeats the tab's name");
  const lists = panel.querySelectorAll("ul.rows");
  const skillList = lists.find((u) => u.querySelectorAll("li.row").some((r) => r.id === "f-S3-010"));
  assert.deepEqual(skillList.querySelectorAll("li.row").map((r) => r.id), ["f-S3-010", "f-S3-011"], "the substantial skill first");
  assert.deepEqual(skillList.querySelectorAll(".measure .words").map((w) => w.textContent), ["2 scripts · 640 lines · tested", "Instructions only"]);
  assert.ok(skillList.querySelector(".bar").getAttribute("aria-hidden") === "true", "the bar repeats the words, for the eye only");
  assert.equal(rowOf(app, "S3-050"), undefined, "scripts are never a list of their own");
  assert.equal(rowOf(app, "S3-020"), undefined, "the count of skills is no row");
  const own = rowOf(app, "S3-041");
  assert.equal(own.querySelector(".name").textContent, "Slack app, tools and a sandbox runner");
  assert.equal(own.querySelector(".measure .words").textContent, "4,100 lines");
  assert.equal(rowOf(app, "S3-040"), undefined, "its size and its words are one row");
  rowOf(app, "S3-030").querySelector(".toggle").click();
  const job = rowOf(app, "S3-030").querySelector(".detail");
  assert.deepEqual(job.querySelectorAll("dt").map((x) => x.textContent), ["Skills that do it"]);
  assert.deepEqual(job.querySelectorAll("button.ref").map((b) => b.textContent), ["Make still images", "Check a draft against the brand pack"]);
  rowOf(app, "S3-010").querySelector(".toggle").click();
  const opened = rowOf(app, "S3-010").querySelector(".detail");
  assert.equal(opened.querySelector("p").textContent, "It flags colours, fonts and logos that break the brand pack.", "what it does for the team, in plain words, never its title again");
  assert.ok(!readable(opened).includes("Check a draft against the brand pack."), "its own description stays in the viewer");
  assert.deepEqual(opened.querySelectorAll("dt").map((x) => x.textContent), ["Uses", "Tests", "On its own"]);
  assert.deepEqual(opened.querySelectorAll("dd").map((x) => x.textContent), ["ElevenLabs", "12 tests in 1 test file", "Can be lifted out on its own"]);
  assert.ok(opened.querySelector('button[data-k="read:S3-010"]'), "Read the skill");
  assert.ok(!/skills\/|\.mjs|\.md|:\d/.test(readable(panel)), "no file on the tab");
});

test("[F5.R9] Read the skill opens a dialog over the page, placed in the frame where the person is, with a veil, Close and Escape; focus moves in and back; the page behind can't be reached; the skill's Markdown is drawn as text, with no markup, image or link", async () => {
  for (const width of [1100, 368]) {
    const p = drawn(richReport(), { width });
    tabNamed(p.app, "What it does").click();
    rowOf(p.app, "S3-010").querySelector(".toggle").click();
    p.app.querySelector('button[data-k="read:S3-010"]').click();
    await ticks();
    const dlg = p.layer.querySelector("section.dialog");
    assert.ok(dlg, `a dialog opens at ${width}`);
    assert.equal(dlg.getAttribute("role"), "dialog");
    assert.equal(dlg.getAttribute("aria-modal"), "true");
    assert.equal(dlg.getAttribute("aria-labelledby"), "viewer-title");
    assert.ok(p.layer.querySelector("div.veil"), "a veil over the page behind");
    assert.equal(p.app.getAttribute("inert"), "", "the page behind can't be reached");
    assert.ok(rowOf(p.app, "S3-010"), "the list stays where it was, behind the dialog, never replaced by it");
    assert.equal(shownPanel(p.app).querySelector(".with-viewer"), null, "no side column");
    assert.match(dlg.getAttribute("style"), /^top:\d+px;max-height:\d+px$/, "placed in the frame, with a height of its own");
    assert.equal(dlg.querySelector("h2").textContent, "Check a draft against the brand pack");
    assert.equal(dlg.querySelector("p.own").textContent, "Check a draft against the brand pack.", "the skill's own words are in the dialog");
    assert.equal(doc.activeElement, dlg.querySelector('button[data-k="viewer-close"]'), "focus moves to Close");
    assert.equal(dlg.querySelector(".dlg-body").getAttribute("tabindex"), "0", "the instructions scroll with the keys too");
    const md = dlg.querySelector(".md");
    assert.deepEqual(md.children.map((n) => n.tagName), ["H3", "P", "H4", "UL", "PRE", "P"]);
    assert.deepEqual(md.querySelectorAll("li").map((li) => li.textContent), ["Read the brand pack first", "Run the check on the draft"], "a link keeps its words only");
    assert.equal(md.querySelector("pre").textContent, "node lint.mjs <file>");
    assert.equal(md.children.at(-1).textContent, "<b>bold?</b>  and strong words", "markup is drawn as text, images are left out, emphasis marks go");
    assert.equal(md.querySelectorAll("img").length + md.querySelectorAll("a").length, 0);
    p.data(richReport(), { job_state: "completed", lifecycle: "accepted" });
    assert.equal(p.layer.querySelector("section.dialog"), dlg, "new data leaves the open dialog as it is, scrolled where the person put it");
    if (width === 1100) dlg.querySelector('button[data-k="viewer-close"]').click();
    else p.document.press("Escape");
    assert.equal(p.layer.querySelector("section.dialog"), null, width === 1100 ? "Close closes it" : "Escape closes it");
    assert.equal(p.layer.querySelector("div.veil"), null);
    assert.equal(p.app.getAttribute("inert"), null, "the page is back");
    assert.equal(doc.activeElement?.getAttribute("data-k"), "read:S3-010", "focus goes back to Read the skill");
  }
  const n = drawn(richReport(), { width: 368 });
  tabNamed(n.app, "What it does").click();
  rowOf(n.app, "S3-011").querySelector(".toggle").click();
  n.app.querySelector('button[data-k="read:S3-011"]').click();
  await ticks();
  assert.match(n.layer.querySelector(".cut").textContent, /The rest is longer than the report carries\. Copy the link to the whole text/);
  n.layer.querySelector('button[data-k="viewer-copy"]').click();
  await ticks();
  assert.equal(n.sent.filter((m) => m.method === "view/copy-text").at(-1).params.text, ADDRESS);
  n.layer.querySelector("div.veil").click();
  assert.equal(n.layer.querySelector("section.dialog"), null, "a click on the veil closes it");
});

test("[F5.R9] Systems it uses: one card per outside system with its icon, its name, what it is for, what the person supplies and required or optional as a word and a shape, required first; a credential no system names is a system of its own; opened, what uses it, what happens without it and what goes to it", async () => {
  const p = drawn(richReport(), { width: 1100 });
  const { app } = p;
  tabNamed(app, "Systems it uses").click();
  const panel = shownPanel(app);
  const sys = panel.querySelectorAll("li.row.system");
  assert.deepEqual(sys.map((r) => r.id), ["f-S5-010", "f-S5-020", "f-S5-011"], "required first, in the report's order");
  assert.deepEqual(sys.map((r) => r.querySelector(".name").textContent), ["Slack", "Gemini", "ElevenLabs"]);
  assert.deepEqual(sys.map((r) => r.querySelector(".under")?.textContent ?? ""), ["Reads requests and posts replies", "", "Voiceover"], "what it is for, from its title");
  assert.deepEqual(sys.map((r) => r.querySelector(".supply").textContent), ["You supply: A Slack app and its two tokens", "You supply: Your Gemini API key", "You supply: Your ElevenLabs key"]);
  assert.deepEqual(sys.map((r) => r.querySelector(".need .word").textContent), ["Required", "Required", "Optional"]);
  assert.ok(sys.every((r) => r.querySelector(".need svg")?.markup), "each need has a shape");
  assert.equal(sys[0].querySelector(".sys-icon").textContent, "S", "a system with no mark of its own is its first letter");
  assert.ok(sys[1].querySelector(".sys-icon svg")?.markup.startsWith('<path d="M'), "Gemini is drawn with its mark");
  assert.ok(sys[2].querySelector(".sys-icon svg")?.markup.startsWith('<path d="M'), "ElevenLabs is drawn with its mark");
  assert.ok(sys.every((r) => r.querySelector(".sys-icon").getAttribute("aria-hidden") === "true"), "the icon is for the eye; the name says it");
  assert.equal(rowOf(app, "S5-021"), undefined, "a credential a system names is in that system's card");
  rowOf(app, "S5-020").querySelector(".toggle").click();
  assert.equal(rowOf(app, "S5-020").querySelector(".detail p").textContent, "The code stops without it.", "in words, never the setting as the code writes it");
  assert.ok(!panel.querySelectorAll("h3").some((h) => h.textContent === "Credentials"), "no list of credentials");
  assert.ok(!panel.querySelectorAll("h2").some((h) => /What it connects to|Systems it uses/.test(h.textContent)), "no heading that means the same as the tab");
  rowOf(app, "S5-011").querySelector(".toggle").click();
  const open = rowOf(app, "S5-011").querySelector(".detail");
  assert.deepEqual(open.querySelectorAll("dt").map((x) => x.textContent), ["Used by", "Without it", "What goes to it"]);
  assert.equal(open.querySelector("button.ref").textContent, "Check a draft against the brand pack", "the skill that uses it opens in the dialog");
  open.querySelector("button.ref").click();
  await ticks();
  assert.ok(p.layer.querySelector("section.dialog"));
  const { list, facts } = rich();
  const unclear = drawn(report(list.map((f) => (f.id === "S5-011" ? { ...f, detail: { ...f.detail, need: "unclear" } } : f)), [], facts), { width: 1100 });
  tabNamed(unclear.app, "Systems it uses").click();
  assert.equal(rowOf(unclear.app, "S5-011").querySelector(".need .word").textContent, "Not clear from the code", "what the code doesn't settle is said so");
});

test("[F5.R9] Tests and gaps is a document: a heading for each group, every item's title and words shown with nothing to open, each test with how many tests, of what kind and whether they run offline; two items that say the same thing are one; nothing held back is drawn", () => {
  const { list, facts } = rich();
  const more = [
    { id: "S8-020", section: 8, kind: "could-not-tell", title: "Which tools need approval when deployed", says: "The code leaves the approval list empty. Ask the publisher which tools should wait for an OK.", by: "model", evidence: ev("src/design_agent/assembly.py", 362) },
    { id: "S8-021", section: 8, kind: "question", title: "Which tools should wait for a person?", says: "Ask which tools wait for a person by default.", by: "model", evidence: ev("src/design_agent/assembly.py", 362) },
    { id: "S8-022", section: 8, kind: "test-gap", title: "No test covers the Slack replies", says: "The Slack path has only live tests.", by: "model", evidence: ev("tests/live/test_slack.py", 3) },
  ];
  const { app } = drawn(report([...list, ...more], [{ section: 7, title: "One judgment", why: "it cites a fact the scripts did not find" }], facts));
  tabNamed(app, "Tests and gaps").click();
  const panel = shownPanel(app);
  const docEl = panel.querySelector("article.doc");
  assert.ok(docEl, "one document");
  assert.deepEqual(docEl.querySelectorAll("h3").map((h) => h.textContent), ["What Inspect couldn't tell", "Gaps in the tests", "Tests"]);
  assert.equal(panel.querySelectorAll("button").length, 0, "nothing to open or close");
  const item = (id) => docEl.querySelectorAll("div.doc-item").find((x) => x.id === `f-${id}`);
  assert.deepEqual(item("S8-001").querySelectorAll("h4").map((h) => h.textContent), ["Spending caps"]);
  assert.equal(item("S8-001").querySelector("p").textContent, "Not in the code.", "every item's words are shown");
  assert.equal(item("S8-010").querySelector("p.meta").textContent, "12 tests · unit · offline");
  assert.equal(item("S8-011"), undefined, "the count of all tests is no item");
  assert.equal(item("S8-021"), undefined, "a question that asks what a gap says is one item with it");
  assert.match(item("S8-020").textContent, /Ask which tools wait for a person by default\./, "its words are kept with the item it repeats");
  assert.equal(docEl.querySelectorAll("h4").filter((h) => /Which tools/.test(h.textContent)).length, 1);
  assert.ok(!/Held back|One judgment/.test(readable(panel)), "judgments held back stay in the report, off the page");
  assert.match(style, /\.doc \{ max-width: 68ch; \}/, "a width that reads well");
});

test("[F5.R9] while the job runs, one status under the tabs says Inspect is working and which step it is on; every field and list still to come shows a loading placeholder, never a blank; the status is gone once the report is done", () => {
  const first = page();
  first.say({ id: "h-1", method: "view/initialize", params: { version: "descriptor-view-v1", color_scheme: "light", locale: "en-US", width: 690 } });
  assert.equal(first.app.querySelector("div.status").querySelector("p.now").textContent, "Inspecting · Step 1 of 5: Starting", "before any report, it says it has started");
  assert.ok(shownPanel(first.app).querySelector(".sk"), "and shows what is coming, never an empty page");
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts, "Asking the model for the judgments of sections 3, 4 and 5: what it does, how it works and the systems it uses."), { job_state: "working", lifecycle: null });
  const { app } = p;
  const status = () => app.querySelector("div.status");
  assert.equal(app.children[1], status(), "the status sits straight under the tabs");
  assert.equal(app.querySelectorAll("div.status").length, 1, "said once");
  assert.equal(status().getAttribute("role"), "status");
  assert.equal(status().querySelector("p.now").textContent, "Inspecting · Step 3 of 5: Judging what it does and the systems it uses");
  assert.ok(status().querySelector("span.spin"), "a ring that turns while it works");
  assert.deepEqual(status().querySelector("ol.steps").querySelectorAll("li").map((li) => li.className), ["done", "done", "at", "", ""], "a bar for each step: done ones filled, the one it is on marked");
  const sk = (name) => { tabNamed(app, name).click(); return shownPanel(app); };
  const over = sk("Overview");
  assert.ok(over.querySelector(".sk-lead"), "the description still to come is a placeholder");
  const tiles = over.querySelector("ul.size-tiles").querySelectorAll("li");
  assert.ok(tiles.some((t) => t.querySelector(".v").querySelector(".sk")), "a count still to come is a placeholder, never a blank or a zero");
  assert.ok(tiles.every((t) => t.querySelector(".v").querySelector(".sk") || /d/.test(t.querySelector(".v").textContent)), "every tile is a number or a placeholder");
  const does = sk("What it does");
  assert.deepEqual(does.querySelectorAll("h3").map((h) => h.textContent).slice(0, 1), ["Jobs"]);
  assert.ok(does.querySelector("ul.sk-rows"), "the jobs still to come are placeholders");
  const systems = sk("Systems it uses");
  assert.ok(systems.querySelector("ul.sk-rows.cards"), "the systems still to come are placeholder cards");
  assert.equal(systems.querySelectorAll("li.row.system").length, 0, "no system is drawn before the model has judged them");
  const risks = sk("Risks");
  assert.ok(risks.querySelectorAll("button.tile").every((t) => t.getAttribute("disabled") === "" && t.querySelector(".sk")), "no count of risks before they are judged, only placeholders");
  assert.ok(risks.querySelector("ul.sk-rows"));
  assert.equal(tabNamed(app, "Risks").querySelector(".lv"), null, "no highest level before the risks are judged");
  const tests = sk("Tests and gaps");
  assert.ok(tests.querySelector(".sk-doc"), "the document still to come is a placeholder");
  assert.ok(!/Nothing yet|None found/.test(readable(app)), "no blank and no empty-looking field");
  tabNamed(app, "What it does").click();
  const rows = () => shownPanel(app).querySelectorAll("li.row").length;
  const climbs = [rows()];
  p.data(copyOf(findings().filter((f) => f.by === "script" || [3, 4, 5].includes(f.section)), "Asking the model for the judgments of sections 6, 7 and 8: what it can do on its own, its risks, and its tests."));
  climbs.push(rows());
  assert.equal(status().querySelector("p.now").textContent, "Inspecting · Step 4 of 5: Judging its risks and its tests");
  assert.equal(shownPanel(app).querySelector("ul.sk-rows"), null, "what it does has arrived whole");
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Writing section 1, at a glance, from the checked findings."));
  climbs.push(rows());
  assert.equal(status().querySelector("p.now").textContent, "Inspecting · Step 5 of 5: Writing the overview");
  // 0.4.3: a status line that says its step is drawn in its own words.
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Step 5 of 5: Writing the overview."));
  assert.equal(status().querySelector("p.now").textContent, "Inspecting · Step 5 of 5: Writing the overview");
  p.data(copyOf([], "Step 1 of 5: Reading the repository."));
  assert.equal(status().querySelector("p.now").textContent, "Inspecting · Step 1 of 5: Reading the repository");
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Step 5 of 5: Writing the overview."));
  assert.deepEqual(climbs, [1, 2, 2], "the tab fills in under the person");
  for (const t of tabsOf(app)) assert.ok(!/\d/.test(t.textContent), "no count while running either");
  p.data(report(), { job_state: "completed", lifecycle: "draft" });
  assert.equal(status(), null, "the status is gone once the report is done");
  for (const name of TAB_NAMES) assert.equal(sk(name).querySelector(".sk"), null, `${name} has no placeholder left`);
  p.data(copyOf(scripts), { job_state: "failed", lifecycle: null });
  assert.equal(status().textContent, "Stopped before the report was finished.");
  assert.equal(status().querySelector(".spin"), null);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{\s*\.spin, \.steps li\.at, \.sk \{ animation: none; \}/, "nothing moves for a person who asks for less motion");
});

test("[F5.R9] the tab the person is on stays put when new data arrives, and keeps its focus; an open row stays open", () => {
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts), { job_state: "working", lifecycle: null });
  const { app } = p;
  tabNamed(app, "Tests and gaps").click();
  p.data(copyOf(findings().filter((f) => f.section !== 1)));
  assert.deepEqual(selected(app), ["Tests and gaps"], "a working copy with more findings moves no tab");
  assert.equal(doc.activeElement, tabNamed(app, "Tests and gaps"));
  p.data(report(), { job_state: "completed", lifecycle: "draft" });
  assert.deepEqual(selected(app), ["Tests and gaps"]);
  tabNamed(app, "Risks").click();
  const toggle = rowOf(app, "S7-021").querySelector(".toggle");
  toggle.click(); toggle.focus();
  p.data(report(), { job_state: "completed", lifecycle: "accepted" });
  const again = rowOf(app, "S7-021");
  assert.ok(again.querySelector(".detail"));
  assert.equal(doc.activeElement, again.querySelector(".toggle"));
});

test("[F5.R9] arrow keys, Home and End move between the five tabs and open them; each change asks the frame to fit; text is 16px or more and nothing under 14px; a visible focus ring; the strip scrolls inside itself", () => {
  const { app, sent } = drawn(richReport());
  tabNamed(app, "Overview").focus();
  const go = (key) => { const before = resizes(sent); const moved = doc.activeElement.press(key); return { moved, asked: resizes(sent) - before, on: selected(app)[0] }; };
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "What it does" });
  assert.deepEqual(go("End"), { moved: true, asked: 1, on: "Tests and gaps" });
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "Overview" }, "past the last, the first");
  assert.deepEqual(go("ArrowLeft"), { moved: true, asked: 1, on: "Tests and gaps" });
  assert.deepEqual(go("Home"), { moved: true, asked: 1, on: "Overview" });
  const rule = (sel) => style.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()*+?^$|\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(":root"), /--size: max\(16px, var\(--ca-font-size, 16px\)\)/, "the body is 16px or more, whatever the host hands");
  for (const m of style.matchAll(/font-size:\s*([\d.]+)em/g)) assert.ok(Number(m[1]) >= 0.875, `no text under 14px: ${m[0]}`);
  for (const m of style.matchAll(/font-size:\s*([\d.]+)px/g)) assert.ok(Number(m[1]) >= 14, `no text under 14px: ${m[0]}`);
  assert.match(rule(".tab:focus-visible"), /outline: 2px solid var\(--accent\)/);
  assert.match(rule(".tabs"), /overflow-x: auto/);
  const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  for (const r of rules.filter((x) => /\.toggle|\.tt\b|\.row\b/.test(x.sel))) assert.ok(!/text-overflow\s*:\s*ellipsis|overflow\s*:\s*hidden/.test(r.body), `${r.sel} cuts nothing`);
});

test("[F5.R9] nothing on any tab or opened row names a file, a line, a path or an advisory id, explains a count or says how the report was made, running or done", () => {
  const held = [{ section: 7, title: "One judgment", why: "It cited a fact the scripts did not find." }];
  const scripts = findings().filter((f) => f.by === "script");
  const DEAD = [/\b[\w-]+\.(?:py|mjs|js|ts|md|json|toml|lock)\b/, /\w\/\w+\//, /:\d+\b/, /GHSA-/, /CVE-/, /In the code/, /Name in the code/, /^Copy$/m, /\bthe facts\b/i];
  const cases = [
    drawn(richReport(held), { width: 1100 }),
    drawn(report(findings(), held)),
    drawn(copyOf(scripts, "Unpacked 412 files of langchain-ai/design-agent at 86d8f6677968; reading the facts by rule."), { job_state: "working", lifecycle: null }),
  ];
  for (const { app } of cases) {
    for (const name of TAB_NAMES) {
      tabNamed(app, name).click();
      for (const r of app.querySelectorAll("li.row")) r.querySelector(".toggle").click();
      const words = readable(app);
      for (const re of [...NEVER, ...DEAD]) assert.ok(!re.test(words), `${name} draws nothing like ${re}: ${words.match(re)?.[0]}`);
    }
  }
});

test("[F5.R9] a system with nothing to set up says so as its need, with a shape of its own, and is never counted as required", () => {
  const { list, facts } = rich();
  const hosts = { id: "S5-012", section: 5, kind: "system", title: "Setup download hosts: installs and sandbox builds", says: "The install script downloads tools.", by: "model", based_on: [], evidence: ev("install.sh", 4), detail: { system: "Setup download hosts", need: "none", need_by: "rule", supply: "Nothing to set up" } };
  const { app } = drawn(report([...list, hosts], [], facts), { width: 1100 });
  const tile = shownPanel(app).querySelector("ul.size-tiles").querySelectorAll("li").find((t) => t.querySelector(".k").textContent === "Systems required");
  assert.equal(tile.querySelector(".v").textContent, "2 of 4", "counted among the systems, never as required");
  tabNamed(app, "Systems it uses").click();
  const row = rowOf(app, "S5-012");
  assert.equal(row.querySelector(".need .word").textContent, "Nothing to set up");
  assert.ok(row.querySelector(".need svg").markup.includes("stroke-dasharray"), "a dashed ring, its own shape");
  assert.equal(row.querySelector(".supply"), null, "the need says it; no second line says it again");
  assert.equal(shownPanel(app).querySelectorAll("li.row.system").at(-1), row, "after the systems that ask something of the person");
});

test("[F5.R9] a system whose supply the model could not name shows only that the code does not settle it, never a line saying it is not shown", () => {
  const { list, facts } = rich();
  const groq = { id: "S5-013", section: 5, kind: "system", title: "Groq: audio transcription address", says: "A transcription address is named.", by: "model", based_on: [], evidence: ev("src/audio.py", 4), detail: { system: "Groq", need: "unclear", need_by: "model", supply: "Not shown" } };
  const { app } = drawn(report([...list, groq], [], facts), { width: 1100 });
  tabNamed(app, "Systems it uses").click();
  const row = rowOf(app, "S5-013");
  assert.equal(row.querySelector(".need .word").textContent, "Not clear from the code");
  assert.equal(row.querySelector(".supply"), null);
});

test("[F5.R9] at the first step, before any of the scripts' facts, the Overview's five tiles are all placeholders, never one tile alone", () => {
  const p = drawn(copyOf([], "Step 1 of 5: Reading the repository."), { job_state: "working", lifecycle: null });
  const tiles = shownPanel(p.app).querySelector("ul.size-tiles").querySelectorAll("li");
  assert.equal(tiles.length, 5);
  assert.ok(tiles.every((t) => t.querySelector(".sk")), "each a placeholder");
  assert.ok(!/Systems required/.test(readable(shownPanel(p.app))), "no tile's words before its number");
});

// ── 0.5.0: a plugin's report ──
const pluginReport = () => inTemp(async (at) => (await inspect({ text: "repository: acme/helper\ncommit: 86d8f66", workDir: at, env: ENV, fetchImpl: world({ files: claudePlugin() }).fetchImpl, ask: model().ask })).report);

test("[F5.A7] a plugin's Overview says what it is and where it runs, and counts what it adds to the person's tools; an agent's says none of it", async () => {
  const r = await pluginReport();
  const p = drawn(r);
  const panel = shownPanel(p.app);
  assert.equal(panel.querySelector("p.kind-line").textContent, "Plugin for Claude Code and Cursor, made by Acme");
  const tiles = panel.querySelector("ul.size-tiles").querySelectorAll("li").map((t) => `${t.querySelector(".v").textContent} ${t.querySelector(".k").textContent}`);
  for (const want of ["1 Skill", "1 Command", "1 Sub-agent", "3 Hooks that run on their own", "2 MCP servers"]) assert.ok(tiles.includes(want), `${want} in ${tiles.join(" | ")}`);
  assert.ok(!tiles.some((t) => /Systems required/.test(t)), "a plugin's MCP servers are counted; nothing is required to install it");
  const agent = drawn(report());
  assert.equal(shownPanel(agent.app).querySelector("p.kind-line"), null);
});

test("[F5.A7] What it does lists a plugin's commands and sub-agents, measured; Systems its MCP servers, where each runs and what the person supplies; Risks its hooks first", async () => {
  const r = await pluginReport();
  const p = drawn(r);
  tabNamed(p.app, "What it does").click();
  let panel = shownPanel(p.app);
  const heads = panel.querySelectorAll("h3").map((h) => h.textContent);
  assert.ok(heads.includes("Commands") && heads.includes("Sub-agents"), heads.join(", "));
  const cmd = panel.querySelectorAll("li.row").find((row) => /Deploy the project to Acme/.test(row.textContent));
  assert.match(cmd.querySelector(".measure").textContent, /lines · can run shell commands/);
  cmd.querySelector(".toggle").click();
  const opened = shownPanel(p.app).querySelectorAll("li.row").find((row) => /Deploy the project to Acme/.test(row.textContent));
  assert.ok(opened.querySelectorAll("button").some((b) => b.textContent === "Read the command"));

  tabNamed(p.app, "Systems it uses").click();
  panel = shownPanel(p.app);
  assert.equal(panel.querySelectorAll("h3")[0].textContent, "MCP servers");
  const cards = panel.querySelectorAll("li.row").map((row) => row.textContent);
  assert.ok(cards.some((c) => /Acme/.test(c) && /Runs on the machine/.test(c) && /Your API token/.test(c)), cards.join(" | "));
  assert.ok(cards.some((c) => /Docs/.test(c) && /Connects to mcp\.acme\.test/.test(c) && /Connects out/.test(c)));

  tabNamed(p.app, "Risks").click();
  panel = shownPanel(p.app);
  assert.equal(panel.querySelectorAll("h3")[0].textContent, "Hooks");
  const hookRows = panel.querySelectorAll("ul.rows")[0].querySelectorAll("li.row").map((row) => row.textContent);
  assert.equal(hookRows.length, 3);
  assert.ok(hookRows.some((t) => /High/.test(t) && /Runs a JavaScript program when a session starts or resumes/.test(t)));
  assert.equal(panel.querySelectorAll("h3")[1].textContent, "Other risks");
  // Nothing on any tab names a file, a setting's value or a section code.
  for (const name of TAB_NAMES) {
    tabNamed(p.app, name).click();
    const words = readable(shownPanel(p.app));
    // 0.6.0: Could it move? quotes the database's words, which name formats
    // such as plugin.json; it never names a file of the repository.
    const files = name === "Could it move?" ? [/hooks\//, /\.mcp\.json/, /read-keys/] : [/\.json\b/];
    for (const re of [...NEVER, /\.mjs\b/, ...files, /\.sh\b/, /CLAUDE_PLUGIN_ROOT/, /docs-header-value/]) assert.doesNotMatch(words, re, `${name}: ${re}`);
  }
});

test("[F5.A7] the model's judgment of a service an MCP server reaches opens on that server's card, never a card of its own; the line saying what a plugin is gives way to the description (0.5.3)", async () => {
  const r = await pluginReport();
  const mcpFinding = r.findings.find((f) => f.kind === "mcp-server" && f.title === "Docs");
  const sys = { id: "S5-090", section: 5, kind: "system", title: "Acme docs service", says: "It can read and write the team's documents.", by: "model", based_on: [...mcpFinding.based_on], evidence: mcpFinding.evidence, detail: { system: "Acme docs", need: "optional", supply: "Your Acme account" } };
  const desc = { id: "S1-090", section: 1, kind: "description", title: "What it is", says: "Helper is Acme's plugin for Claude Code and Cursor.", by: "model", based_on: ["F0001"], evidence: mcpFinding.evidence };
  const p = drawn({ ...r, findings: [desc, ...r.findings, sys] });
  assert.equal(shownPanel(p.app).querySelector("p.kind-line"), null, "the description says what it is; the line does not say it again");
  tabNamed(p.app, "Systems it uses").click();
  const cards = shownPanel(p.app).querySelectorAll("li.row");
  assert.ok(!cards.some((c) => /Acme docs service/.test(c.textContent)), "no second card");
  rowOf(p.app, mcpFinding.id).querySelector(".toggle").click();
  assert.match(rowOf(p.app, mcpFinding.id).textContent, /What it reaches.*It can read and write the team's documents\./s);
});

test("[F5.A8] a hook's row says what else its code does, once; that finding has no row of its own (0.5.7)", async () => {
  const r = await pluginReport();
  const start = r.findings.find((f) => f.detail?.hook?.event === "SessionStart");
  start.detail.hook.also = [{ title: "Usage reports sent to Acme", says: "It sends the skills used and an install id.", level: "low", safe: "Turn usage reports off." }];
  const p = drawn(r);
  tabNamed(p.app, "Risks").click();
  const rows = shownPanel(p.app).querySelectorAll("li.row");
  assert.equal(rows.filter((row) => /Usage reports sent to Acme/.test(row.textContent)).length, 0, "closed, no row carries it");
  rowOf(p.app, start.id).querySelector(".toggle").click();
  const opened = rowOf(p.app, start.id).textContent;
  assert.match(opened, /Also in its code.*Usage reports sent to Acme\. It sends the skills used and an install id\./s);
  assert.match(opened, /To make it safe.*Turn usage reports off\./s);
});

test("[F5.A8] for a plugin, Risks lists risks only: a system the Overview's few findings point to is not listed again there (0.5.8)", async () => {
  const r = await pluginReport();
  const sys = { id: "S5-091", section: 5, kind: "system", title: "Acme usage reporting service", says: "It receives usage reports.", by: "model", based_on: ["F0001"], evidence: [{ file: "README.md", line: 1 }], detail: { system: "Acme", need: "optional" } };
  const glance = { id: "S1-091", section: 1, kind: "glance", title: sys.title, says: "Usage reports go to Acme.", by: "model", based_on: ["F0001"], repeats: sys.id, evidence: sys.evidence };
  const p = drawn({ ...r, findings: [glance, ...r.findings, sys] });
  tabNamed(p.app, "Risks").click();
  assert.ok(!readable(shownPanel(p.app)).includes("Acme usage reporting service"));
  const agent = drawn(report());
  tabNamed(agent.app, "Risks").click();
  assert.ok(readable(shownPanel(agent.app)).includes("Which tools run without an OK"), "an agent's Risks are as before");
});

// ── Could it move? (0.6.0) ──
// A reading of a small LangGraph agent that scores its runs with LangSmith
// (so AgentMesh, which offers no evaluations, would lose that), uses
// LangSmith's sandboxes, and keeps LangGraph's checkpoints.
function moveReading({ needs = true } = {}) {
  const files = {
    "pyproject.toml": "[project]\nname = \"maker\"\ndependencies = [\"langgraph>=1.2\", \"langsmith>=0.14\"]\n",
    "src/maker/graph.py": "from langgraph.checkpoint.memory import InMemorySaver\nsaver = InMemorySaver()\n",
    "src/maker/sandbox.py": "from langsmith.sandbox import SandboxClient\nSandboxClient()\n",
    "src/maker/score.py": "from langsmith import Client\nclient = Client()\nclient.evaluate(lambda x: x)\n",
  };
  const db = loadDatabase();
  const found = platformUses({ files: Object.keys(files), read: (f) => files[f] ?? null, db, frameworks: [{ framework: "LangGraph", package: "langgraph", file: "pyproject.toml", line: 3 }] });
  const reading = readingOf({ found, db, frameworks: [{ framework: "LangGraph", package: "langgraph" }], languages: [{ language: "Python", files: 3 }], ownCode: { files: 3, lines: 6 } });
  if (needs) Object.assign(reading.uses.find((r) => r.category === "sandboxes"), { needs: "A sandbox that can run a browser", choices: "Docker, picked by a setting" });
  return reading;
}
const withReading = (r, reading = moveReading()) => ({ ...r, portability: reading });

test("[F6.A9] Could it move? comes after Systems it uses: what it is built on and the services it reaches first; a row for each category it uses with how open it is in a word and a shape; for an outside service, what it needs and how it swaps", () => {
  const { app } = drawn(withReading(richReport()));
  tabNamed(app, "Could it move?").click();
  const panel = shownPanel(app);
  const lead = panel.querySelector(".move-lead");
  assert.equal(lead.querySelector(".k").textContent, "Built on");
  assert.equal(lead.querySelector(".v").textContent, "LangChain, LangGraph and LangSmith");
  assert.equal(lead.querySelector(".under").textContent, "LangGraph · Python");
  assert.equal(panel.querySelector("p.ties").textContent, "It reaches outside services for tracing and telemetry, evaluations, and sandboxes and code execution.");
  assert.deepEqual(panel.querySelectorAll("h2").map((h) => h.textContent), ["How tied it is", "Moving it"]);
  const rows = panel.querySelector("ul.tie-list").querySelectorAll("li").filter((li) => li.parentNode?.className === "tie-list");
  const byName = Object.fromEntries(rows.map((li) => [li.querySelector(".tie-name").textContent, li]));
  assert.deepEqual(Object.keys(byName).sort(), ["Evaluations", "Memory and saved state", "Sandboxes and code execution", "Tracing and telemetry"].sort());
  const sand = byName["Sandboxes and code execution"];
  assert.equal(sand.querySelector(".lv .word").textContent, "Partly open");
  assert.equal(levelOf(sand.querySelector(".lv")).shape, SHAPE_OF.medium, "a shape with the word, never a color alone");
  assert.match(sand.querySelector(".tie-need").textContent, /^NeedsA sandbox that can run a browserAlso offersDocker, picked by a setting$/);
  assert.equal(sand.querySelector(".tie-swap").textContent, "Light to swap: its code is in one file");
  const mem = byName["Memory and saved state"];
  assert.equal(mem.querySelector(".lv .word").textContent, "Open source");
  assert.equal(mem.querySelector(".tie-swap"), null, "how it swaps is said only of an outside service");
  assert.equal(mem.querySelector(".tie-need"), null);
  assert.match(panel.querySelector("p.not-used").textContent, /^Not used: .*Prompt management/);
  for (const b of panel.querySelectorAll(".lv")) assert.ok(/\bfact\b/.test(b.className), "its shapes are facts in the text's color, never a warning");
});

test("[F6.A9] Moving it: AgentMesh and two more, the rest behind Every platform; each keeps swapping its outside services apart from re-hosting its own code; what it would lose first, in the destination's own words; the database's date in one small line", () => {
  const reading = moveReading();
  const { app, sent } = drawn(withReading(richReport()));
  tabNamed(app, "Could it move?").click();
  const panel = () => shownPanel(app);
  const dests = () => panel().querySelectorAll("section.dest");
  assert.equal(dests().length, 3);
  assert.equal(dests()[0].querySelector("h3").textContent, "AgentMesh");
  const mesh = dests()[0];
  assert.deepEqual(mesh.querySelectorAll("h4").map((h) => h.textContent), ["Swap its outside services", "Re-host its own code3 files, 6 lines"]);
  const swapCells = mesh.querySelectorAll(".work")[0].querySelectorAll("li");
  const evalCell = swapCells.find((li) => li.querySelector("button.ref").textContent === "Evaluations");
  assert.ok(evalCell, "a service to swap is listed under Swap");
  assert.equal(evalCell.querySelector(".lv .word").textContent, "Not offered", "AgentMesh's none shows like anyone else's");
  assert.equal(levelOf(evalCell.querySelector(".lv")).shape, SHAPE_OF.high);
  const meshDb = loadDatabase().platforms.find((p) => p.id === "agentmesh");
  assert.equal(evalCell.querySelector(".cell-what").textContent, meshDb.categories.evaluations.what.split(/(?<=\.)\s/)[0], "the database's own first sentence");
  assert.equal(swapCells[0], evalCell, "what it would lose comes first");
  const before = resizes(sent);
  const every = panel().querySelector('button[data-k="every-platform"]') ?? panel().querySelectorAll("button.btn").find((b) => b.textContent === "Every platform");
  assert.equal(every.textContent, "Every platform");
  assert.equal(every.getAttribute("aria-expanded"), "false");
  every.click();
  assert.equal(dests().length, reading.destinations.length);
  assert.ok(resizes(sent) > before, "the frame is made to fit");
  assert.equal(panel().querySelectorAll("button.btn").find((b) => b.getAttribute("aria-expanded") === "true").textContent, "Fewer platforms");
  assert.match(panel().querySelector("p.db-line").textContent, /^From the agent platforms database, checked Nov 2\d, 2026\.$/);
  assert.ok(!/Nov 26/.test(panel().querySelector("p.db-line").textContent), "a date alone is never drawn as the day before");
  const words = readable(panel());
  for (const re of [/\bsrc\/maker\b/, /\.py\b/, /:\d+\b/]) assert.ok(!re.test(words), `nothing like ${re}: ${words.match(re)?.[0]}`);
  // Inspect's own words give no advice; the database's are the vendors' own.
  const own = [...panel().querySelectorAll("p.ties"), ...panel().querySelectorAll("h4"), ...panel().querySelectorAll("p.tie-swap"), ...panel().querySelectorAll("p.db-line")].map((n) => n.textContent).join("\n");
  for (const re of [/recommend/i, /\bbest\b/i, /\bshould\b/i, /\bchoose\b/i]) assert.ok(!re.test(own), `nothing like ${re}`);
});

test("[F6.A9] a category's title opens the database's whole words in the dialog, and Close brings focus back", async () => {
  const p = drawn(withReading(richReport()));
  const { app } = p;
  tabNamed(app, "Could it move?").click();
  const btn = shownPanel(app).querySelectorAll("button.ref").find((b) => b.textContent === "Evaluations" && b.getAttribute("data-k").startsWith("cell:agentmesh:"));
  btn.click();
  await ticks(30);
  const dlg = p.layer.querySelector("section.dialog");
  assert.ok(dlg, "the dialog is open");
  assert.equal(dlg.querySelector("h2").textContent, "Evaluations: AgentMesh");
  const meshDb = loadDatabase().platforms.find((p) => p.id === "agentmesh");
  assert.ok(readable(dlg).includes(meshDb.categories.evaluations.what), "its whole words");
  dlg.querySelectorAll("button").find((b) => b.textContent === "Close").click();
  await ticks(5);
  assert.equal(p.layer.querySelector("section.dialog"), null, "closed");
});

test("[F6.A9] while the job runs the tab shows placeholders until the reading arrives, and what it needs until the model answers; a later copy that leaves the reading out keeps the one drawn", () => {
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts, "Step 2 of 5: Reading the code."), { job_state: "working", lifecycle: null });
  tabNamed(p.app, "Could it move?").click();
  assert.match(tabNamed(p.app, "Could it move?").getAttribute("aria-label"), /still to come$/);
  assert.ok(shownPanel(p.app).querySelector(".sk-lead"), "the reading still to come is a placeholder");
  const reading = moveReading({ needs: false });
  const copy = workingCopy({ about: { ...ABOUT, portability: reading }, findings: scripts, stage: "Step 3 of 5: Judging what it does and the systems it uses." });
  p.data(copy);
  const sand = () => shownPanel(p.app).querySelectorAll("li").find((li) => li.querySelector?.(".tie-name")?.textContent === "Sandboxes and code execution");
  assert.ok(sand().querySelector(".tie-need .sk"), "what it needs is a placeholder until the model answers");
  const bare = { ...copyOf(scripts, "Step 4 of 5: Judging its risks and its tests.") };
  delete bare.portability;
  p.data(bare);
  assert.ok(shownPanel(p.app).querySelector(".move-lead"), "a copy short of room keeps the reading drawn before");
});
