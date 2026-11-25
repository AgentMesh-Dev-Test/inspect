// F5.R9, how the report's view draws (0.2.2): every item At a glance shows
// its level as a word and a shape; the counts say what they count and agree;
// and a risk's whole title is in its row, with its level, its category and
// its file and line.
//
// What is worth pinning, from the view's own script run against a stand-in
// page: the three flaws a person saw in the design-agent report. An item At
// a glance that repeats a finding with no level drew an empty level column;
// the head said 225 findings where the filter said 220, without saying the
// five At a glance repeat findings of sections 2 to 8; and section 7's rows
// cut each title to a few characters. How the rows lay out at a width is
// checked in a headless browser (the build record says how); here the
// stylesheet is held to never cutting a title.
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
import { ROOT, SHA } from "./helpers.mjs";

const html = readFileSync(join(ROOT, "views", "report.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const KIND = "application/vnd.agentmesh.inspection-report+json";
const WORDS = ["Critical", "High", "Medium", "Low", "No risk", "Not rated"];

// ── The stand-in page: just enough of the DOM for the view to draw into ──
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === "string" ? new Text(k) : k; n.parentNode = this; this.childNodes.push(n); } }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes = []; if (v !== "") this.append(new Text(String(v))); }
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
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this }); }
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { height: 900, width: 690 }; }
  closest() { return null; }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  matches(sel) {
    return sel.split(",").some((one) => {
      const m = one.trim().match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
      if (!m) throw new Error(`the stand-in page does not read the selector ${one}`);
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      return m[2].split(".").filter(Boolean).every((c) => this.classList.contains(c));
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
  const parent = { postMessage: (m) => sent.push(m) };
  const document = {
    documentElement: root, body, activeElement: null,
    createElement: (t) => (t === "template" ? new Template() : new Element(t)),
    createTextNode: (s) => new Text(s),
    getElementById: (id) => [root, ...descendants(root)].find((n) => n.id === id) ?? null,
  };
  const window = {
    parent, scrollY: 0, scrollTo() {},
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
  };
  // The view waits up to 20 seconds for an answer it is never given here;
  // those waits must not hold the test open.
  const later = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
  const context = vm.createContext({ window, document, Node, setTimeout: later, clearTimeout, requestAnimationFrame: (fn) => fn(), TextDecoder, atob, URL, Intl, console });
  vm.runInContext(script, context);
  const say = (m) => { for (const fn of listeners) fn({ source: parent, data: { jsonrpc: "2.0", ...m } }); };
  return { app, sent, say };
}

/** The view, drawn with one report, as a host sends it (DESCRIPTOR-UI Section 9.4). */
function drawn(report, { job_state = "completed", lifecycle = "draft" } = {}) {
  const p = page();
  p.say({ id: "h-1", method: "view/initialize", params: { version: "descriptor-view-v1", color_scheme: "light", locale: "en-US", width: 690 } });
  p.say({ method: "view/data", params: { name: "inspection", media_type: KIND, text: JSON.stringify(report), lifecycle, job_state } });
  assert.ok(!p.sent.some((m) => m.method === "view/report-failure"), `the view drew: ${JSON.stringify(p.sent.find((m) => m.method === "view/report-failure"))}`);
  return p;
}

// ── A report shaped like the design-agent one, small ──
const ev = (file, line) => [{ file, line, text: "x" }];
const cat = (id, name = id) => ({ id, name });
const LONG = "Shell execution through Docker, with the host's socket mounted into the sandbox the model's commands run in";
function findings() {
  const out = [
    { id: "S2-001", section: 2, kind: "fact", title: "Apache-2.0", says: "The license.", by: "script", evidence: ev("LICENSE", 1) },
    { id: "S3-001", section: 3, kind: "skill", title: "brand-lint", says: "A skill.", by: "script", evidence: ev("skills/brand-lint/SKILL.md", 1) },
    { id: "S6-011", section: 6, kind: "autonomy", title: "Which tools run without an OK", says: "Every tool runs without one.", by: "model", evidence: ev("src/design_agent/assembly.py", 362) },
    { id: "S7-001", section: 7, kind: "risk", title: "@hono/node-server 2.1.5: GHSA-jpvv-r467-5p4w", says: "A known vulnerability.", by: "script", level: "medium", level_by: "source", categories: [cat("LLM03:2025", "Supply chain"), cat("ASI04"), cat("pkg:npm/%40hono/node-server@2.1.5"), cat("GHSA-jpvv-r467-5p4w")], evidence: ev("sandbox/render/package-lock.json", 449) },
    { id: "S7-012", section: 7, kind: "risk", title: LONG, says: "It can run commands.", by: "model", level: "medium", level_by: "model", categories: [cat("ASI05"), cat("LLM06:2025")], evidence: [...ev("src/design_agent/runtime/sandbox/docker.py", 138), ...ev("src/design_agent/runtime/sandbox/docker.py", 140)] },
    { id: "S7-021", section: 7, kind: "risk", title: "Gemini key sent in a URL", says: "The key is in the query.", by: "model", level: "low", level_by: "model", categories: [cat("LLM02:2025")], evidence: ev("skills/motion-graphics/grounding/locate.mjs", 192) },
    { id: "S7-023", section: 7, kind: "risk", title: "Sandbox build fetches are pinned", says: "Pinned.", by: "model", level: "none", level_by: "model", categories: [cat("LLM03:2025")], evidence: ev("sandbox/Dockerfile", 4) },
    { id: "S7-027", section: 7, kind: "needs", title: "Least access to run it", says: "What it needs.", by: "model", evidence: ev("src/design_agent/runtime/sandbox/docker.py", 138) },
    { id: "S8-001", section: 8, kind: "could-not-tell", title: "Spending caps", says: "Not in the code.", by: "model", evidence: ev("tests/unit/harness/test_meter.py", 40) },
  ];
  // Section 1, as checkGlance writes it: a copy of the finding it repeats,
  // with that finding's level when it has one. The autonomy finding has none.
  const glance = (target, extra = {}) => ({ section: 1, kind: "glance", title: target.title, says: `Again: ${target.says}`, by: "model", repeats: target.id, evidence: target.evidence, ...(target.level ? { level: target.level, level_by: target.level_by } : {}), ...extra });
  const byId = Object.fromEntries(out.map((f) => [f.id, f]));
  const g = [glance(byId["S6-011"]), glance(byId["S7-012"]), glance(byId["S7-023"])];
  // One whose own copy lost its level (an older report): the view takes the level of the finding it repeats.
  const bare = glance(byId["S7-021"]); delete bare.level; delete bare.level_by;
  g.push(bare);
  return [...g.map((f, i) => ({ id: `S1-00${i + 1}`, ...f })), ...out];
}
const report = () => buildReport({ owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, date: "2026-11-24T10:00:00Z", version: "0.2.2", now: "2026-11-25T18:29:10Z", findings: findings(), held: [], facts: [], bom: { components: [] }, osv: { asked: 0 }, usage: {} });

const levelOf = (badge) => ({ word: badge.querySelector(".word")?.textContent ?? "", shape: badge.querySelector("svg")?.markup ?? "" });
const SHAPE_OF = Object.fromEntries([...script.matchAll(/\n    (critical|high|medium|low|none|unrated): '([^']+)'/g)].map((m) => [m[1], m[2]]));

test("[F5.R9] every item At a glance shows its level as a word and a shape, never color alone, the one with no level too", () => {
  const { app } = drawn(report());
  const items = app.querySelectorAll("ul.matters li");
  assert.equal(items.length, 4);
  const got = items.map((li) => { const b = li.querySelector(".lv"); assert.ok(b, "each item has a level"); return { title: li.querySelector(".t").textContent, ...levelOf(b) }; });
  for (const g of got) {
    assert.ok(WORDS.includes(g.word), `${g.title} says its level in words, not "${g.word}"`);
    assert.ok(g.shape, `${g.title} has a shape`);
  }
  const of = Object.fromEntries(got.map((g) => [g.title, g]));
  assert.deepEqual(of["Which tools run without an OK"], { title: "Which tools run without an OK", word: "Not rated", shape: SHAPE_OF.unrated }, "a finding with no level says so, with a shape of its own");
  assert.equal(of[LONG].word, "Medium");
  assert.equal(of[LONG].shape, SHAPE_OF.medium);
  assert.equal(of["Sandbox build fetches are pinned"].word, "No risk");
  assert.equal(of["Sandbox build fetches are pinned"].shape, SHAPE_OF.none);
  assert.equal(of["Gemini key sent in a URL"].word, "Low", "a copy without its level takes the level of the finding it repeats");
  assert.equal(new Set(Object.values(SHAPE_OF)).size, Object.keys(SHAPE_OF).length, "no two levels share a shape");
  // The same in a section that mixes levels: the row with none says Not rated.
  const row = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-027");
  assert.equal(levelOf(row.querySelector(".lv")).word, "Not rated");
});

test("[F5.R9] the counts say what they count, and agree: the report's total, the findings of sections 2 to 8, and the ones At a glance that repeat them", () => {
  const r = report();
  const { app } = drawn(r);
  const total = r.findings.length; const glance = r.findings.filter((f) => f.section === 1).length; const rest = total - glance;
  assert.equal(r.counts.findings, total);
  assert.equal(app.querySelector(".meta .tally").textContent, `${total} findings: ${rest} in sections 2 to 8, and ${glance} at a glance that repeat them`);
  assert.equal(app.querySelector(".glance-h .count").textContent, `${glance} findings, each repeated from sections 2 to 8`);
  const all = app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("All"));
  assert.equal(all.querySelector(".c").textContent, String(rest), "the filter's All is the findings of sections 2 to 8");
  assert.equal(app.querySelector(".showing").textContent, `Showing ${rest} of the ${rest} findings in sections 2 to 8`);
  const perSection = app.querySelectorAll("section.sec .sec-h .count").map((c) => Number.parseInt(c.textContent, 10)).reduce((a, b) => a + b, 0);
  assert.equal(perSection, rest, "the sections' own counts add up to the same number");
  // A filter by level says how many it shows of the same whole.
  app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Medium")).click();
  assert.equal(app.querySelector(".showing").textContent, `Showing 2 of the ${rest} findings in sections 2 to 8`);
  const notRated = app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Not rated"));
  assert.ok(notRated?.querySelector("svg"), "the Not rated chip has its shape too");
});

test("[F5.R9] a working copy that leaves findings out says so in the filter's count, and its head counts them", () => {
  const all = findings().filter((f) => f.section !== 1);
  const copy = workingCopy({ about: { owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, started_at: "2026-11-25T18:25:40Z", version: "0.2.2" }, findings: all, stage: "Asking the model about sections 6 to 8." });
  copy.findings = copy.findings.filter((f) => f.id !== "S3-001"); copy.partial.omitted = 1;
  const { app } = drawn(copy, { job_state: "working", lifecycle: null });
  assert.equal(app.querySelector(".meta .tally").textContent, `${all.length} findings so far`);
  assert.equal(app.querySelector(".showing").textContent, `Showing ${all.length - 1} of the ${all.length - 1} findings in sections 2 to 8; 1 more arrives with the report`);
});

test("[F5.R9] a risk's row holds its whole title, its level, its category and its file and line under the title; the stylesheet never cuts a title", () => {
  const { app } = drawn(report());
  const row = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-012");
  const toggle = row.querySelector(".toggle");
  assert.deepEqual(toggle.children.map((c) => c.className), ["lv medium", "t", "cat"], "level, then the title, then the category");
  assert.equal(toggle.querySelector(".tt").textContent, `▸${LONG}`, "the whole title, as the report gives it");
  assert.equal(toggle.querySelector(".t .place").textContent, "src/design_agent/runtime/sandbox/docker.py:138 +1", "the file and line sit under the title");
  assert.equal(toggle.querySelector(".cat").textContent, "ASI05 +1");
  const hono = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-001");
  assert.equal(hono.querySelector(".tt").textContent, "▸@hono/node-server 2.1.5: GHSA-jpvv-r467-5p4w");
  assert.equal(hono.querySelector(".cat .id").textContent, "LLM03:2025");
  assert.equal(hono.querySelector(".place").textContent, "sandbox/render/package-lock.json:449");
  // The rules that lay a row out: none cuts or hides the title or the place.
  const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const titled = rules.filter((r) => /\.toggle|\.tt\b|\.place\b|\.row\b/.test(r.sel) && !/\.cat\b/.test(r.sel));
  assert.ok(titled.length >= 6);
  for (const r of titled) assert.ok(!/text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap|overflow\s*:\s*hidden/.test(r.body), `${r.sel} cuts nothing`);
  // At a phone's width the title takes the row's whole width, under the level and the category.
  const narrow = style.slice(style.indexOf("@media (max-width: 640px)"));
  assert.match(narrow, /\.toggle \{[^}]*grid-template-areas: "lv cat" "t t"/);
});
