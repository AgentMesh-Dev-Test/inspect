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
import { ROOT, SHA, descriptor } from "./helpers.mjs";

const html = readFileSync(join(ROOT, "views", "report.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const KIND = "application/vnd.agentmesh.inspection-report+json";
const WORDS = ["Critical", "High", "Medium", "Low", "No risk", "Not rated"];
const TAB_NAMES = ["Overview", "What it does", "What it reaches", "Risks", "Tests and gaps"];
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
  const toastEl = new Element("div"); toastEl.setAttribute("id", "toast");
  root.append(body); body.append(app, toastEl);
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
  return { app, sent, say, document };
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
  "# Brand lint", "", "Checks a draft against the brand pack.", "", "## Steps", "",
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
    skill("S3-010", "Check a draft against the brand pack", { name: "brand-lint", path: "skills/brand-lint", description: "Check a draft against the brand pack.", lift_out: "yes", size: { scripts: 2, lines: 640, instructions_chars: 400, tests: { files: 1, cases: 12 } }, instructions: SKILL_TEXT, instructions_cut: false, instructions_address: null }),
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

test("[F5.R9] the view is one row of five tabs with nothing above it, in the ARIA tabs pattern, with no count on any tab; Risks names its highest level as a word and a shape; it starts on Overview", () => {
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

test("[F5.R9] Overview describes the whole agent: the description first, how much is there, what was inspected with the repository's link to copy, and two lines about Inspect at the foot; no risk on it", async () => {
  const { app, sent } = drawn(richReport());
  const panel = shownPanel(app);
  assert.equal(panel.children[0].className, "lead", "the description is the answer, first");
  assert.match(panel.children[0].textContent, /^Content Studio is a design agent/);
  const size = panel.querySelector("dl.size");
  const pairs = (dl) => Object.fromEntries(dl.children.reduce((a, n, i, all) => (n.tagName === "DT" ? [...a, [n.textContent, all[i + 1].textContent]] : a), []));
  assert.deepEqual(pairs(size), { Skills: "2, and 1 for coding assistants", Scripts: "2 in its skills, 640 lines of code", "Its own code": "4,100 lines", Tests: "14 in 2 files, 12 run offline", "Outside systems": "3, 2 required" });
  const facts = panel.querySelectorAll("dl.facts").find((d) => !d.classList.contains("size"));
  const shown = pairs(facts);
  assert.equal(shown.Commit, "86d8f66, Nov 24, 2026");
  assert.equal(shown.License, "Apache-2.0");
  assert.match(shown.Repository, /^langchain-ai\/design-agent Copy link$/);
  panel.querySelector("button.copy-link").click();
  await ticks();
  const copied = sent.filter((m) => m.method === "view/copy-text").at(-1);
  assert.equal(copied.params.text, `https://github.com/langchain-ai/design-agent/tree/${SHA}`, "the repository at the commit, copied: this frame opens no link");
  const foot = panel.querySelector(".about-foot");
  assert.equal(foot.querySelectorAll("p").length, 2);
  assert.match(foot.textContent, /^About Inspect\./);
  assert.match(foot.textContent, /What it doesn't do\./);
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
  assert.deepEqual(panel.querySelectorAll("h3").map((h) => h.textContent), ["Jobs", "Skills", "Skills for coding assistants", "Its own code"]);
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
  assert.equal(opened.querySelector("p").textContent, "Check a draft against the brand pack.");
  assert.deepEqual(opened.querySelectorAll("dt").map((x) => x.textContent), ["Uses", "Tests", "On its own"]);
  assert.deepEqual(opened.querySelectorAll("dd").map((x) => x.textContent), ["ElevenLabs", "12 tests in 1 test file", "Can be lifted out on its own"]);
  assert.ok(opened.querySelector('button[data-k="read:S3-010"]'), "Read the skill");
  assert.ok(!/skills\/|\.mjs|\.md|:\d/.test(readable(panel)), "no file on the tab");
});

test("[F5.R9] Read the skill opens a viewer: beside the list at a desktop's width, the whole frame at a phone's; the skill's Markdown is drawn as text, with no markup, image or link; Close and Escape put focus back", async () => {
  const wide = drawn(richReport(), { width: 1100 });
  tabNamed(wide.app, "What it does").click();
  rowOf(wide.app, "S3-010").querySelector(".toggle").click();
  wide.app.querySelector('button[data-k="read:S3-010"]').click();
  let panel = shownPanel(wide.app);
  assert.ok(panel.querySelector(".with-viewer .beside"), "the list stays, beside the viewer");
  const viewer = panel.querySelector("section.viewer");
  assert.equal(viewer.getAttribute("role"), "dialog");
  assert.equal(viewer.querySelector("h2").textContent, "Check a draft against the brand pack");
  assert.equal(doc.activeElement, viewer.querySelector('button[data-k="viewer-close"]'), "focus moves to Close");
  const md = viewer.querySelector(".md");
  assert.deepEqual(md.children.map((n) => n.tagName), ["H3", "P", "H4", "UL", "PRE", "P"]);
  assert.deepEqual(md.querySelectorAll("li").map((li) => li.textContent), ["Read the brand pack first", "Run the check on the draft"], "a link keeps its words only");
  assert.equal(md.querySelector("pre").textContent, "node lint.mjs <file>");
  assert.equal(md.children.at(-1).textContent, "<b>bold?</b>  and strong words", "markup is drawn as text, images are left out, emphasis marks go");
  assert.equal(md.querySelectorAll("img").length + md.querySelectorAll("a").length, 0);
  viewer.querySelector('button[data-k="viewer-close"]').click();
  assert.equal(shownPanel(wide.app).querySelector("section.viewer"), null);
  assert.equal(doc.activeElement?.getAttribute("data-k"), "read:S3-010", "focus goes back to Read the skill");
  const narrow = drawn(richReport(), { width: 368 });
  tabNamed(narrow.app, "What it does").click();
  rowOf(narrow.app, "S3-011").querySelector(".toggle").click();
  narrow.app.querySelector('button[data-k="read:S3-011"]').click();
  panel = shownPanel(narrow.app);
  assert.equal(panel.children.length, 1, "the viewer takes the whole frame");
  assert.ok(panel.children[0].classList.contains("full"));
  assert.equal(panel.children[0].getAttribute("aria-modal"), "true");
  assert.match(panel.querySelector(".cut").textContent, /The rest is longer than the report carries\. Copy the link to the whole skill/);
  panel.querySelector('button[data-k="viewer-copy"]').click();
  await ticks();
  assert.equal(narrow.sent.filter((m) => m.method === "view/copy-text").at(-1).params.text, ADDRESS);
  narrow.document.press("Escape");
  assert.equal(shownPanel(narrow.app).querySelector("section.viewer"), null, "Escape closes it");
});

test("[F5.R9] What it reaches: one row per outside system, required or optional as a word and a shape, what the person supplies, required first; a credential no system names is a system of its own; opened, what uses it, what happens without it and what goes to it", () => {
  const { app } = drawn(richReport(), { width: 1100 });
  tabNamed(app, "What it reaches").click();
  const panel = shownPanel(app);
  const sys = panel.querySelectorAll("li.row.system");
  assert.deepEqual(sys.map((r) => r.id), ["f-S5-010", "f-S5-020", "f-S5-011"], "required first, in the report's order");
  assert.deepEqual(sys.map((r) => r.querySelector(".need .word").textContent), ["Required", "Required", "Optional"]);
  assert.ok(sys.every((r) => r.querySelector(".need svg")?.markup), "each need has a shape");
  assert.deepEqual(sys.map((r) => r.querySelector(".under").textContent), ["A Slack app and its two tokens", "Your Gemini API key", "Your ElevenLabs key"]);
  assert.equal(rowOf(app, "S5-021"), undefined, "a credential a system names is in that system's row");
  assert.equal(rowOf(app, "S5-020").querySelector(".name").textContent, "Gemini", "a credential no system names is the system it opens");
  rowOf(app, "S5-020").querySelector(".toggle").click();
  assert.equal(rowOf(app, "S5-020").querySelector(".detail p").textContent, "The code stops without it.", "in words, never the setting as the code writes it");
  assert.ok(!panel.querySelectorAll("h3").some((h) => h.textContent === "Credentials"), "no list of credentials");
  rowOf(app, "S5-011").querySelector(".toggle").click();
  const open = rowOf(app, "S5-011").querySelector(".detail");
  assert.deepEqual(open.querySelectorAll("dt").map((x) => x.textContent), ["Used by", "Without it", "What goes to it"]);
  assert.equal(open.querySelector("button.ref").textContent, "Check a draft against the brand pack", "the skill that uses it opens in the viewer");
  open.querySelector("button.ref").click();
  assert.ok(shownPanel(app).querySelector("section.viewer"));
});

test("[F5.R9] Tests and gaps: each test row says how many tests, of what kind and whether they run offline; the count of all tests is no row; nothing held back is drawn", () => {
  const { app } = drawn(richReport([{ section: 7, title: "One judgment", why: "it cites a fact the scripts did not find" }]));
  tabNamed(app, "Tests and gaps").click();
  const panel = shownPanel(app);
  assert.deepEqual(panel.querySelectorAll("h3").map((h) => h.textContent), ["What Inspect couldn't tell", "Tests"]);
  assert.equal(rowOf(app, "S8-010").querySelector(".measure .words").textContent, "12 tests · unit · offline");
  assert.equal(rowOf(app, "S8-011"), undefined);
  assert.ok(!/Held back|One judgment/.test(readable(panel)), "judgments held back stay in the report, off the page");
});

test("[F5.R9] while the job runs, one line under the tabs says what Inspect is doing in plain words, tabs fill in with no count, and the line is gone once the report is done", () => {
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts, "Asking the model for the judgments of sections 3, 4 and 5: what it does, how it works and what it connects to."), { job_state: "working", lifecycle: null });
  const { app } = p;
  const now = () => app.querySelector("p.now");
  assert.equal(app.children[1], now(), "the line sits straight under the tabs");
  assert.equal(now().textContent, "Judging what it does, how it works and what it connects to");
  assert.equal(tabNamed(app, "What it reaches").textContent, "What it reaches");
  assert.match(tabNamed(app, "What it reaches").getAttribute("aria-label"), /still to come$/);
  tabNamed(app, "Tests and gaps").click();
  assert.equal(shownPanel(app).textContent, "Nothing yet.");
  tabNamed(app, "What it does").click();
  const rows = () => shownPanel(app).querySelectorAll("li.row").length;
  const climbs = [rows()];
  p.data(copyOf(findings().filter((f) => f.by === "script" || [3, 4, 5].includes(f.section)), "Asking the model for the judgments of sections 6, 7 and 8: what it can do on its own, its risks, and its tests."));
  climbs.push(rows());
  assert.equal(now().textContent, "Judging what it can do on its own, its risks and its tests");
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Writing section 1, at a glance, from the checked findings."));
  climbs.push(rows());
  assert.equal(now().textContent, "Writing the overview");
  assert.deepEqual(climbs, [1, 2, 2], "the tab fills in under the person");
  for (const t of tabsOf(app)) assert.ok(!/\d/.test(t.textContent), "no count while running either");
  p.data(report(), { job_state: "completed", lifecycle: "draft" });
  assert.equal(now(), null, "the line is gone once the report is done");
  p.data(copyOf(scripts), { job_state: "failed", lifecycle: null });
  assert.equal(now().textContent, "Stopped before the report was finished.");
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
