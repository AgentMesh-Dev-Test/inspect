// F5.R9, how the report's view draws (0.2.4): the whole view is one row of
// six tabs with nothing above it; a row shows only its title, and on Risks
// its level, until it is opened; the top of the report answers with the
// risks by level and the top judgments; and nothing on the page explains a
// count, a section or how the report was made.
//
// What is worth pinning, from the view's own script run against a stand-in
// page: the six tabs and their counts in the ARIA tabs pattern, with its
// keys; rows closed by default, and what an open row shows; Overview's
// tiles, top judgments, what was inspected and the plain save button; a
// "See it in Risks" link that opens the finding; the level filter on Risks
// with every row shown; About Inspect in Inspect's own words; the line
// under the tabs while the job runs, gone once it is done; a tab that stays
// where the person put it when new data arrives; and the words that must
// never be drawn. How the tabs lay out at a width is checked in a headless
// browser (test/view-host.html; the build record says how); here the
// stylesheet is held to never cutting a title and to scrolling the tab strip
// inside itself.
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
const TAB_NAMES = ["Overview", "What it does", "What it reaches", "Risks", "Tests and gaps", "About Inspect"];
const TAB_SECTIONS = [[1, 2], [3, 4], [5, 6], [7], [8], []];
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
  const document = {
    documentElement: root, body, activeElement: null,
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
function drawn(report, { job_state = "completed", lifecycle = "draft", desc = descriptor() } = {}) {
  const p = page();
  p.say({ id: "h-1", method: "view/initialize", params: { version: "descriptor-view-v1", color_scheme: "light", locale: "en-US", width: 690 } });
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
const report = (list = findings(), held = []) => buildReport({ owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, date: "2026-11-24T10:00:00Z", version: "0.2.4", now: "2026-11-25T18:29:10Z", findings: list, held, facts: [], bom: { components: [] }, osv: { asked: 0 }, usage: {} });
const copyOf = (list, stage = "Asking the model.") => workingCopy({ about: ABOUT, findings: list, stage });

const levelOf = (badge) => ({ word: badge.querySelector(".word")?.textContent ?? "", shape: badge.querySelector("svg")?.markup ?? "" });
const SHAPE_OF = Object.fromEntries([...script.matchAll(/\n    (critical|high|medium|low|none|unrated): '([^']+)'/g)].map((m) => [m[1], m[2]]));

test("[F5.R9] the view is one row of six tabs with nothing above it, in the ARIA tabs pattern; the first five count their findings, Risks names its highest level as a word and a shape; it starts on Overview", () => {
  const r = report();
  const { app } = drawn(r);
  assert.equal(app.children[0].className, "tabs-wrap", "the tabs come first: no head, no title, no status line above them");
  assert.equal(app.querySelectorAll('div[role="tablist"]').length, 1, "one row of tabs");
  assert.equal(app.querySelector("h1"), null, "no title of its own");
  const list = app.querySelector('div[role="tablist"]');
  assert.ok(list?.getAttribute("aria-label"), "the tab list has a name");
  const tabs = tabsOf(app);
  assert.deepEqual(tabs.map((t) => t.querySelector(".tab-name").textContent), TAB_NAMES);
  assert.deepEqual(selected(app), ["Overview"], "it starts on Overview");
  for (const [i, t] of tabs.entries()) {
    const on = i === 0;
    assert.equal(t.getAttribute("tabindex"), on ? "0" : "-1", "only the open tab is in the page's tab order");
    const panel = app.querySelectorAll('div[role="tabpanel"]').find((p) => p.id === t.getAttribute("aria-controls"));
    assert.ok(panel, `${TAB_NAMES[i]} controls a panel`);
    assert.equal(panel.getAttribute("aria-labelledby"), t.id);
    assert.equal(panel.getAttribute("hidden") === null, on);
    assert.equal(t.querySelector(".tab-key"), null, "no section codes on a tab");
    if (!TAB_SECTIONS[i].length) { assert.equal(t.querySelector(".tab-n"), null, "About Inspect counts nothing"); continue; }
    const n = TAB_SECTIONS[i].reduce((a, s) => a + r.findings.filter((f) => f.section === s).length, 0);
    assert.equal(t.querySelector(".tab-n").textContent, String(n), `${TAB_NAMES[i]} counts its findings`);
    assert.match(t.getAttribute("aria-label"), new RegExp(`^${TAB_NAMES[i]}, ${n} findings?`));
  }
  const total = tabs.slice(0, 5).map((t) => Number(t.querySelector(".tab-n").textContent)).reduce((a, b) => a + b, 0);
  assert.equal(total, r.findings.length, "the five counts add up to the report's total");
  const risks = tabNamed(app, "Risks");
  assert.equal(levelOf(risks.querySelector(".lv")).word, "High");
  assert.equal(levelOf(risks.querySelector(".lv")).shape, SHAPE_OF.high);
  assert.match(risks.getAttribute("aria-label"), /, the highest High$/);
  for (const name of TAB_NAMES.filter((x) => x !== "Risks")) assert.equal(tabNamed(app, name).querySelector(".lv"), null, `${name} names no level`);
});

test("[F5.R9] a row is closed by default and shows only its title, and on Risks its level; opened, it shows the finding's words, where it is in the code, its plain category and Copy", async () => {
  const { app, sent } = drawn(report());
  tabNamed(app, "Risks").click();
  const row = rowOf(app, "S7-001");
  const toggle = row.querySelector(".toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "closed by default");
  assert.deepEqual(toggle.children.map((c) => c.className), ["chev", "lv medium", "tt"], "the level, then the title");
  assert.equal(row.textContent, "▸Medium@hono/node-server 2.1.5: GHSA-jpvv-r467-5p4w", "nothing else on the closed row");
  for (const r of app.querySelectorAll("li.row")) {
    assert.equal(r.querySelector(".detail"), null, "every row starts closed");
    assert.ok(!/\.(py|mjs|json|md|toml):\d/.test(r.textContent), "no file and line on a closed row");
    assert.ok(!/LLM0|ASI0/.test(r.textContent), "no category code on a row");
    assert.equal(r.querySelector("button.copy"), null, "no Copy on a closed row");
  }
  toggle.click();
  const open = rowOf(app, "S7-001");
  const detail = open.querySelector(".detail");
  assert.ok(detail, "it opens");
  assert.equal(open.querySelector(".toggle").getAttribute("aria-expanded"), "true");
  assert.equal(detail.querySelector("p").textContent, "A known vulnerability.", "the finding's words");
  const dts = detail.querySelectorAll("dt").map((x) => x.textContent);
  const dds = detail.querySelectorAll("dd").map((x) => x.textContent);
  assert.deepEqual(dts, ["In the code", "Category"]);
  assert.equal(dds[0], "sandbox/render/package-lock.json:449", "the file and line");
  assert.equal(dds[1], "Supply chain, Agentic supply chain vulnerabilities", "the category by its plain name, never its code");
  assert.ok(!/LLM0|ASI0|pkg:|GHSA/.test(dds[1]));
  const copy = detail.querySelector("button.copy");
  assert.equal(copy.textContent, "Copy");
  copy.click();
  await ticks();
  const copied = sent.find((m) => m.method === "view/copy-text");
  assert.match(copied.params.text, /sandbox\/render\/package-lock\.json line 449: https:\/\/github\.com\/langchain-ai\/design-agent\/blob\//, "Copy carries the address of the line");
  // A row on a tab without levels shows its title alone.
  tabNamed(app, "What it does").click();
  assert.deepEqual(rowOf(app, "S3-001").querySelector(".toggle").children.map((c) => c.className), ["chev", "tt"]);
});

test("[F5.R9] Overview: the risk tiles, the top judgments each with a level and a See it in link, what was inspected as a label and value list, and a plain save button", async () => {
  const { app, sent } = drawn(report());
  const overview = shownPanel(app);
  const tiles = overview.querySelectorAll("button.tile");
  assert.deepEqual(tiles.map((t) => t.textContent), ["0Critical risks", "1High risk", "1Medium risk", "1Low risk"]);
  for (const t of tiles) assert.ok(t.querySelector("svg"), "each tile has its shape");
  const items = overview.querySelectorAll("ul.matters li");
  assert.equal(items.length, 4);
  const got = items.map((li) => ({ title: li.querySelector(".t").textContent, ...levelOf(li.querySelector(".lv")), see: li.querySelector(".see button")?.textContent }));
  for (const g of got) assert.ok(WORDS.includes(g.word) && g.shape, `${g.title} shows its level in words and a shape`);
  assert.deepEqual(got.map((g) => g.see), ["See it in Risks", "See it in What it reaches", "See it in Risks", "See it in Risks"]);
  const of = Object.fromEntries(got.map((g) => [g.title, g]));
  assert.equal(of["Which tools run without an OK"].word, "Not rated");
  assert.equal(of["Which tools run without an OK"].shape, SHAPE_OF.unrated);
  assert.equal(of["Gemini key sent in a URL"].word, "Low", "a copy without its level takes the level of the finding it repeats");
  assert.equal(new Set(Object.values(SHAPE_OF)).size, Object.keys(SHAPE_OF).length, "no two levels share a shape");
  // What was inspected.
  assert.equal(overview.querySelector("h2").textContent, "What was inspected");
  const facts = overview.querySelector("dl.facts");
  const pairs = facts.querySelectorAll("dt").map((dt, i) => [dt.textContent, facts.querySelectorAll("dd")[i].textContent]);
  assert.deepEqual(pairs, [["License", "Apache-2.0"], ["Built on", "Python and TypeScript, with LangChain and LangGraph"], ["Kept up", "Last pushed Nov 24, 2026, 37 commits in the last 90 days"], ["Publisher", "langchain-ai, an organization"], ["Commit", "86d8f66, Nov 24, 2026"]]);
  // The save button, with no box around it explaining it.
  const save = overview.querySelector("button.btn");
  assert.equal(save.textContent, "Save a summary for security");
  assert.equal(save.parentNode.className, "save");
  assert.equal(save.parentNode.textContent, "Save a summary for security", "nothing beside it");
  save.click();
  await ticks();
  const file = sent.find((m) => m.method === "view/save-file");
  assert.equal(file.params.media_type, "text/plain");
  assert.match(file.params.name, /^security-summary-langchain-ai-design-agent-86d8f66\.txt$/);
  assert.match(file.params.text, /Risks, highest first/);
  // A tile opens Risks at its level.
  shownPanel(app).querySelectorAll("button.tile")[1].click();
  assert.deepEqual(selected(app), ["Risks"]);
  assert.equal(app.querySelector('button.chip[aria-pressed="true"]').textContent, "High1");
});

test("[F5.R9] See it in Risks opens the tab that holds the finding, lets go of a filter that hides it, opens the finding, brings it into sight and gives it focus", async () => {
  const { app, sent } = drawn(report());
  const see = (title) => shownPanel(app).querySelectorAll("ul.matters li").find((li) => li.querySelector(".t").textContent === title).querySelector(".see button");
  tabNamed(app, "Risks").click();
  app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Low")).click();
  tabNamed(app, "Overview").click();
  const before = resizes(sent);
  see(LONG).click();
  assert.deepEqual(selected(app), ["Risks"]);
  assert.equal(resizes(sent), before + 1, "the frame is asked to fit the tab");
  await ticks();
  const row = rowOf(app, "S7-012");
  assert.ok(row, "the finding is in the Risks tab, the filter let go");
  assert.ok(row.querySelector(".detail"), "it is open");
  assert.equal(row.scrolled, 1, "it was scrolled into sight, after the frame was fitted");
  assert.equal(app.querySelector('button.chip[aria-pressed="true"]').textContent.startsWith("All"), true);
  tabNamed(app, "Overview").click();
  see("Which tools run without an OK").click();
  assert.deepEqual(selected(app), ["What it reaches"]);
  await ticks();
  const six = rowOf(app, "S6-011");
  assert.equal(six.scrolled, 1);
  assert.equal(doc.activeElement, six.querySelector(".toggle"), "focus goes to the finding");
});

test("[F5.R9] Risks: a filter by level, every row shown highest first, what it needs to run safely under its own heading, and no line saying how many are shown", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `S7-${String(i + 40).padStart(3, "0")}`, section: 7, kind: "risk", title: `risk ${i + 1}`, says: "A risk.", by: "model", level: "low", level_by: "model", evidence: ev(`lib/r${i}.mjs`, 1) }));
  const { app } = drawn(report([...findings(), ...many]));
  tabNamed(app, "Risks").click();
  const panel = shownPanel(app);
  const chips = panel.querySelectorAll("button.chip").map((b) => b.textContent);
  assert.deepEqual(chips, ["All34", "High1", "Medium1", "Low31", "No risk1"]);
  const rated = panel.querySelector("ul.rows.rated").children;
  assert.equal(rated.length, 34, "every risk is drawn, none folded");
  assert.deepEqual(rated.slice(0, 2).map((li) => li.id), ["f-S7-012", "f-S7-001"], "the highest first");
  assert.equal(panel.querySelectorAll("button").filter((b) => /Show all|more/i.test(b.textContent)).length, 0, "no Show all");
  assert.ok(!/Showing/.test(panel.textContent));
  const heads = panel.querySelectorAll("h2").map((h) => h.textContent);
  assert.deepEqual(heads, ["To run it safely"]);
  assert.ok(rowOf(app, "S7-027"), "least access is a row under it");
  panel.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("High")).click();
  assert.deepEqual(shownPanel(app).querySelectorAll("li.row").map((r) => r.id), ["f-S7-012"]);
});

test("[F5.R9] a tab of two sections has two plain headings, with no number and no count; a tab of one has none", () => {
  const { app } = drawn(report());
  const heads = (name) => { tabNamed(app, name).click(); return shownPanel(app).querySelectorAll("h2").map((h) => h.textContent); };
  assert.deepEqual(heads("What it does"), ["What it does", "How it works"]);
  assert.deepEqual(heads("What it reaches"), ["What it connects to", "What it can do on its own"]);
  assert.deepEqual(heads("Tests and gaps"), []);
});

test("[F5.R9] About Inspect says what Inspect does, how it works and what it doesn't do, in its own words from its Descriptor, with no More toggle", () => {
  const { app } = drawn(report());
  tabNamed(app, "About Inspect").click();
  const panel = shownPanel(app);
  assert.deepEqual(panel.querySelectorAll("h2").map((h) => h.textContent), ["What it does", "How it works", "What it doesn't do"]);
  const d = descriptor();
  assert.equal(panel.querySelectorAll("p")[0].textContent, d.summary);
  assert.equal(panel.querySelectorAll("p")[1].textContent, "Scripts collect the facts; a model writes only the judgments, and each judgment cites the facts it rests on.");
  assert.deepEqual(panel.querySelectorAll("li").map((li) => li.textContent), ["Running, installing, building or testing the repository's code", "Giving a verdict on whether to bring the agent in, or judging how it fits a plan or a catalog role"]);
  assert.equal(panel.querySelectorAll("details").length, 0);
  assert.ok(!/\bMore\b/.test(panel.textContent));
  // Without a Descriptor, its own words.
  const { app: bare } = drawn(report(), { desc: null });
  tabNamed(bare, "About Inspect").click();
  assert.equal(shownPanel(bare).querySelectorAll("p")[0].textContent, d.summary);
});

test("[F5.R9] while the job runs the counts fill in, one line under the tabs says what Inspect is doing in plain words, and the line is gone once the report is done", () => {
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts, "Asking the model for the judgments of sections 3, 4 and 5: what it does, how it works and what it connects to."), { job_state: "working", lifecycle: null });
  const { app } = p;
  const now = () => app.querySelector("p.now");
  assert.equal(app.children[1], now(), "the line sits straight under the tabs");
  assert.equal(now().textContent, "Judging what it does, how it works and what it connects to");
  const label = (name) => tabNamed(app, name);
  assert.equal(label("What it reaches").querySelector(".tab-n").textContent, "…", "a tab with nothing yet");
  assert.match(label("What it reaches").getAttribute("aria-label"), /still to come$/);
  label("Tests and gaps").click();
  assert.equal(shownPanel(app).textContent, "Nothing yet.");
  const counts = () => TAB_NAMES.slice(0, 5).map((n) => label(n).querySelector(".tab-n").textContent);
  const climbs = [counts()];
  p.data(copyOf(findings().filter((f) => f.by === "script" || [3, 4, 5].includes(f.section)), "Asking the model for the judgments of sections 6, 7 and 8: what it can do on its own, its risks, and its tests."));
  climbs.push(counts());
  assert.equal(now().textContent, "Judging what it can do on its own, its risks and its tests");
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Writing section 1, at a glance, from the checked findings."));
  climbs.push(counts());
  assert.equal(now().textContent, "Writing the overview");
  assert.deepEqual(climbs, [["6", "1", "…", "1", "…"], ["6", "2", "1", "1", "…"], ["6", "2", "2", "5", "1"]]);
  p.data(report(), { job_state: "completed", lifecycle: "draft" });
  assert.equal(now(), null, "the line is gone once the report is done");
  assert.equal(app.children[0].className, "tabs-wrap");
  // A job that stops says so in one line.
  p.data(copyOf(scripts), { job_state: "failed", lifecycle: null });
  assert.equal(now().textContent, "Stopped before the report was finished.");
});

test("[F5.R9] the tab the person is on stays put when new data arrives, and keeps its focus; an open row stays open", () => {
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts), { job_state: "working", lifecycle: null });
  const { app } = p;
  tabNamed(app, "Tests and gaps").click();
  assert.deepEqual(selected(app), ["Tests and gaps"]);
  assert.equal(doc.activeElement, tabNamed(app, "Tests and gaps"));
  p.data(copyOf(findings().filter((f) => f.section !== 1)));
  assert.deepEqual(selected(app), ["Tests and gaps"], "a working copy with more findings moves no tab");
  assert.equal(doc.activeElement, tabNamed(app, "Tests and gaps"), "focus stays on the tab, drawn again");
  assert.equal(shownPanel(app).querySelectorAll("li.row").length, 1, "and its findings fill in under the person");
  p.data(report(), { job_state: "completed", lifecycle: "draft" });
  assert.deepEqual(selected(app), ["Tests and gaps"], "the delivered report moves no tab either");
  tabNamed(app, "Risks").click();
  const toggle = rowOf(app, "S7-021").querySelector(".toggle");
  toggle.click(); toggle.focus();
  p.data(report(), { job_state: "completed", lifecycle: "accepted" });
  const again = rowOf(app, "S7-021");
  assert.deepEqual(selected(app), ["Risks"]);
  assert.ok(again.querySelector(".detail"));
  assert.equal(doc.activeElement, again.querySelector(".toggle"));
});

test("[F5.R9] arrow keys, Home and End move between the six tabs and open them; each change asks the frame to fit; a visible focus ring; the strip scrolls inside itself", () => {
  const { app, sent } = drawn(report());
  tabNamed(app, "Overview").focus();
  const go = (key) => { const before = resizes(sent); const moved = doc.activeElement.press(key); return { moved, asked: resizes(sent) - before, on: selected(app)[0], focus: doc.activeElement?.querySelector(".tab-name")?.textContent }; };
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "What it does", focus: "What it does" });
  assert.deepEqual(go("End"), { moved: true, asked: 1, on: "About Inspect", focus: "About Inspect" });
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "Overview", focus: "Overview" }, "past the last, the first");
  assert.deepEqual(go("ArrowLeft"), { moved: true, asked: 1, on: "About Inspect", focus: "About Inspect" }, "before the first, the last");
  assert.deepEqual(go("Home"), { moved: true, asked: 1, on: "Overview", focus: "Overview" });
  assert.deepEqual(go("a"), { moved: false, asked: 0, on: "Overview", focus: "Overview" }, "another key does nothing");
  const before = resizes(sent);
  tabNamed(app, "Risks").click();
  assert.equal(resizes(sent), before + 1);
  const rule = (sel) => style.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()*+?^$|\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".tab:focus-visible"), /outline: 2px solid var\(--accent\)/);
  assert.match(rule(".tabs"), /overflow-x: auto/);
  assert.match(rule(".tab"), /flex: none/);
  assert.match(rule(".tab"), /min-height: 44px/, "a touch target");
  assert.match(rule(".tab-name"), /white-space: nowrap/);
  // A title is never cut.
  const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  for (const r of rules.filter((x) => /\.toggle|\.tt\b|\.row\b/.test(x.sel))) assert.ok(!/text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap|overflow\s*:\s*hidden/.test(r.body), `${r.sel} cuts nothing`);
  rowOf(app, "S7-012");
  assert.equal(rowOf(app, "S7-012").querySelector(".tt").textContent, LONG, "the whole title, as the report gives it");
});

test("[F5.R9] nothing on the page explains a count, a section or how the report was made, and no status, section code, category code or full commit is drawn, running or done, on any tab", () => {
  const held = [{ section: 7, title: "One judgment", why: "It cited a fact the scripts did not find." }];
  const scripts = findings().filter((f) => f.by === "script");
  const cases = [
    drawn(report(findings(), held)),
    drawn(report(findings(), held), { lifecycle: "accepted" }),
    drawn(copyOf(scripts, "Unpacked 412 files of langchain-ai/design-agent at 86d8f6677968; reading the facts by rule."), { job_state: "working", lifecycle: null }),
    drawn(copyOf(findings().filter((f) => f.section !== 1)), { job_state: "completed", lifecycle: null }),
  ];
  for (const { app } of cases) {
    for (const name of TAB_NAMES) {
      tabNamed(app, name).click();
      for (const r of app.querySelectorAll("li.row")) r.querySelector(".toggle").click();
      const words = readable(app);
      for (const re of NEVER) assert.ok(!re.test(words), `${name} draws nothing like ${re}: ${words.match(re)?.[0]}`);
    }
  }
  assert.equal(drawn(copyOf(scripts, "Unpacked 412 files of langchain-ai/design-agent at 86d8f6677968; reading the facts by rule."), { job_state: "working", lifecycle: null }).app.querySelector("p.now").textContent, "Reading the code");
});
