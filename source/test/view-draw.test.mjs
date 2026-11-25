// F5.R9, how the report's view draws (0.2.2, and the tabs of 0.2.3): every
// item At a glance shows its level as a word and a shape; the counts say what
// they count and agree; a risk's whole title is in its row, with its level,
// its category and its file and line; and the report is five tabs, each
// labeled with its count, that only the person moves between.
//
// What is worth pinning, from the view's own script run against a stand-in
// page: the three flaws a person saw in the design-agent report (0.2.2), and
// what the tabs promise (0.2.3). The five tabs and their counts, the ARIA
// tabs pattern and its keys, a "See S7-010" link that opens the tab holding
// the finding, a tab that says it is waiting while the job runs and whose
// count climbs as findings arrive, and a tab that stays where the person put
// it when new data arrives. How the tabs lay out at a width is checked in a
// headless browser (test/view-host.html; the build record says how); here
// the stylesheet is held to never cutting a title and to scrolling the tab
// strip inside itself.
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
const TAB_NAMES = ["Overview", "What it does", "What it reaches", "Risks", "Tests and gaps"];
const TAB_SECTIONS = [[1, 2], [3, 4], [5, 6], [7], [8]];

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
  // height back, a moment later.
  const parent = { postMessage: (m) => { sent.push(m); if (m.method === "view/resize" && m.id !== undefined) queueMicrotask(() => say({ id: m.id, result: { height: m.params.height } })); } };
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

/** The view, drawn with one report, as a host sends it (DESCRIPTOR-UI Section 9.4). */
function drawn(report, { job_state = "completed", lifecycle = "draft" } = {}) {
  const p = page();
  p.say({ id: "h-1", method: "view/initialize", params: { version: "descriptor-view-v1", color_scheme: "light", locale: "en-US", width: 690 } });
  p.data = (r, o = {}) => p.say({ method: "view/data", params: { name: "inspection", media_type: KIND, text: JSON.stringify(r), lifecycle: o.lifecycle === undefined ? null : o.lifecycle, job_state: o.job_state ?? "working" } });
  p.say({ method: "view/data", params: { name: "inspection", media_type: KIND, text: JSON.stringify(report), lifecycle, job_state } });
  assert.ok(!p.sent.some((m) => m.method === "view/report-failure"), `the view drew: ${JSON.stringify(p.sent.find((m) => m.method === "view/report-failure"))}`);
  return p;
}
const tabsOf = (app) => app.querySelectorAll('button[role="tab"]');
const tabNamed = (app, name) => tabsOf(app).find((t) => t.querySelector(".tab-name").textContent === name);
const shownPanel = (app) => { const open = app.querySelectorAll('div[role="tabpanel"]').filter((p) => p.getAttribute("hidden") === null); assert.equal(open.length, 1, "one panel shows"); return open[0]; };
const selected = (app) => tabsOf(app).filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.querySelector(".tab-name").textContent);
const resizes = (sent) => sent.filter((m) => m.method === "view/resize").length;
const ticks = async (n = 5) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

// ── A report shaped like the design-agent one, small ──
const ev = (file, line) => [{ file, line, text: "x" }];
const cat = (id, name = id) => ({ id, name });
const LONG = "Shell execution through Docker, with the host's socket mounted into the sandbox the model's commands run in";
function findings() {
  const out = [
    { id: "S2-001", section: 2, kind: "fact", title: "Apache-2.0", says: "The license.", by: "script", evidence: ev("LICENSE", 1) },
    { id: "S3-001", section: 3, kind: "skill", title: "brand-lint", says: "A skill.", by: "script", evidence: ev("skills/brand-lint/SKILL.md", 1) },
    { id: "S4-001", section: 4, kind: "model", title: "Claude through LangChain", says: "The model.", by: "model", evidence: ev("src/design_agent/models.py", 12) },
    { id: "S5-001", section: 5, kind: "system", title: "Slack", says: "It posts to Slack.", by: "model", evidence: ev("src/design_agent/slack.py", 9) },
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
const ABOUT = { owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, started_at: "2026-11-25T18:25:40Z", version: "0.2.3" };
const report = (list = findings()) => buildReport({ owner: "langchain-ai", name: "design-agent", url: "https://github.com/langchain-ai/design-agent", sha: SHA, checked: true, date: "2026-11-24T10:00:00Z", version: "0.2.3", now: "2026-11-25T18:29:10Z", findings: list, held: [], facts: [], bom: { components: [] }, osv: { asked: 0 }, usage: {} });
const copyOf = (list, stage = "Asking the model.") => workingCopy({ about: ABOUT, findings: list, stage });

const levelOf = (badge) => ({ word: badge.querySelector(".word")?.textContent ?? "", shape: badge.querySelector("svg")?.markup ?? "" });
const SHAPE_OF = Object.fromEntries([...script.matchAll(/\n    (critical|high|medium|low|none|unrated): '([^']+)'/g)].map((m) => [m[1], m[2]]));

test("[F5.R9] every item At a glance shows its level as a word and a shape, never color alone, the one with no level too", () => {
  const { app } = drawn(report());
  const items = shownPanel(app).querySelectorAll("ul.matters li");
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
  tabNamed(app, "Risks").click();
  const row = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-027");
  assert.equal(levelOf(row.querySelector(".lv")).word, "Not rated");
});

test("[F5.R9] the counts say what they count, and agree: the report's total, the tabs' counts, and the ones At a glance that repeat them", () => {
  const r = report();
  const { app } = drawn(r);
  const total = r.findings.length; const glance = r.findings.filter((f) => f.section === 1).length; const rest = total - glance;
  assert.equal(r.counts.findings, total);
  assert.equal(app.querySelector(".meta .tally").textContent, `${total} findings: ${rest} in sections 2 to 8, and ${glance} at a glance that repeat them`);
  assert.equal(app.querySelector(".glance-h .count").textContent, `${glance} findings, each repeated from sections 2 to 8`);
  const tabCounts = tabsOf(app).map((t) => Number(t.querySelector(".tab-n").textContent));
  assert.equal(tabCounts.reduce((a, b) => a + b, 0), total, "the five tabs' counts add up to the report's total");
  // On each tab, its sections' own counts add up to its label.
  for (const [i, name] of TAB_NAMES.entries()) {
    tabNamed(app, name).click();
    const perSection = shownPanel(app).querySelectorAll("section.sec .sec-h .count").map((c) => Number.parseInt(c.textContent, 10)).reduce((a, b) => a + b, 0);
    const glanced = name === "Overview" ? glance : 0;
    assert.equal(perSection + glanced, tabCounts[i], `${name}'s sections add up to its label`);
  }
  // Risks: the filter's All is section 7, and a filter by level says how many it shows of it.
  tabNamed(app, "Risks").click();
  const seven = r.findings.filter((f) => f.section === 7).length;
  const all = app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("All"));
  assert.equal(all.querySelector(".c").textContent, String(seven));
  assert.equal(app.querySelector(".showing").textContent, `Showing ${seven} of the ${seven} findings in section 7`);
  app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Medium")).click();
  assert.equal(app.querySelector(".showing").textContent, `Showing 2 of the ${seven} findings in section 7`);
  const notRated = app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Not rated"));
  assert.ok(notRated?.querySelector("svg"), "the Not rated chip has its shape too");
});

test("[F5.R9] a working copy that leaves findings out counts them in its head and its tab, and says so where they belong", () => {
  const all = findings().filter((f) => f.section !== 1);
  const copy = copyOf(all, "Asking the model about sections 6 to 8.");
  copy.findings = copy.findings.filter((f) => f.id !== "S3-001"); copy.partial.omitted = 1;
  const { app } = drawn(copy, { job_state: "working", lifecycle: null });
  assert.equal(app.querySelector(".meta .tally").textContent, `${all.length} findings so far`);
  assert.equal(tabNamed(app, "What it does").querySelector(".tab-n").textContent, "2", "the tab counts the finding left out of this copy");
  tabNamed(app, "What it does").click();
  assert.ok(shownPanel(app).querySelectorAll("p.coming").some((p) => p.textContent === "1 more finding without a level is not in this copy yet; it arrives with the report."));
  tabNamed(app, "Risks").click();
  assert.equal(app.querySelector(".showing").textContent, "Showing 5 of the 5 findings in section 7", "section 7 left nothing out");
});

test("[F5.R9] a risk's row holds its whole title, its level, its category and its file and line under the title; the stylesheet never cuts a title", () => {
  const { app } = drawn(report());
  tabNamed(app, "Risks").click();
  const row = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-012");
  const toggle = row.querySelector(".toggle");
  assert.deepEqual(toggle.children.map((c) => c.className), ["lv medium", "t", "cat"], "level, then the title, then the category");
  assert.equal(toggle.querySelector(".tt").textContent, `▸${LONG}`, "the whole title, as the report gives it");
  assert.equal(toggle.querySelector(".t .place").textContent, "src/design_agent/runtime/sandbox/docker.py:138 +1", "the file and line sit under the title");
  assert.equal(toggle.querySelector(".cat").textContent, "ASI05 +1");
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

test("[F5.R9] the report is five tabs in the ARIA tabs pattern, each labeled with its count, Risks with its highest level as a word and a shape; it starts on Overview", () => {
  const r = report();
  const { app } = drawn(r);
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
    const n = TAB_SECTIONS[i].reduce((a, s) => a + r.findings.filter((f) => f.section === s).length, 0);
    assert.equal(t.querySelector(".tab-n").textContent, String(n), `${TAB_NAMES[i]} counts its findings`);
    assert.match(t.getAttribute("aria-label"), new RegExp(`^${TAB_NAMES[i]}, ${TAB_SECTIONS[i].length > 1 ? "sections" : "section"} ${TAB_SECTIONS[i].join(" and ")}: ${n} findings?`));
    assert.equal(t.querySelector(".tab-key").textContent, TAB_SECTIONS[i].map((s) => `S${s}`).join(" "), "the prefix its findings' ids carry");
  }
  // Risks names its highest level, Medium here, in words and with its shape.
  const risks = tabNamed(app, "Risks");
  assert.equal(levelOf(risks.querySelector(".lv")).word, "Medium");
  assert.equal(levelOf(risks.querySelector(".lv")).shape, SHAPE_OF.medium);
  assert.match(risks.getAttribute("aria-label"), /, the highest Medium$/);
  for (const name of TAB_NAMES.filter((x) => x !== "Risks")) assert.equal(tabNamed(app, name).querySelector(".lv"), null, `${name} names no level`);
  // A high risk raises it.
  const higher = findings().map((f) => (f.id === "S7-021" ? { ...f, level: "high" } : f));
  const { app: app2 } = drawn(report(higher));
  assert.equal(levelOf(tabNamed(app2, "Risks").querySelector(".lv")).word, "High");
  assert.equal(levelOf(tabNamed(app2, "Risks").querySelector(".lv")).shape, SHAPE_OF.high);
  // Overview: At a glance, then What was inspected, then the summary for security.
  const overview = shownPanel(app);
  assert.deepEqual(overview.children.map((c) => c.className), ["glance", "sec", "forsec"]);
  assert.equal(overview.querySelector(".sec-h h2").textContent, "What was inspected");
  assert.equal(overview.querySelector(".forsec button").textContent, "Save a summary for security");
  // The head and the status line sit above the tabs, so every tab shows them.
  const top = app.children.map((c) => c.className || c.tagName.toLowerCase());
  assert.deepEqual(top.slice(0, 2), ["header", "tabs-wrap"]);
  assert.ok(app.querySelector("header ol.track"), "the status line is in the head");
});

test("[F5.R9] a See link opens the tab that holds the finding, then opens the finding, brings it into sight and gives it focus", async () => {
  const { app, sent } = drawn(report());
  const see = (id) => shownPanel(app).querySelectorAll("button.linkish").find((b) => b.textContent === `See ${id}`);
  // A filter that would hide it is let go.
  tabNamed(app, "Risks").click();
  app.querySelectorAll("button.chip").find((b) => b.textContent.startsWith("Low")).click();
  tabNamed(app, "Overview").click();
  const before = resizes(sent);
  see("S7-012").click();
  assert.deepEqual(selected(app), ["Risks"]);
  assert.equal(resizes(sent), before + 1, "the frame is asked to fit the tab");
  await ticks();
  const row = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-012");
  assert.ok(row, "the finding is in the Risks tab, the filter let go");
  assert.equal(row.querySelector(".toggle").getAttribute("aria-expanded"), "true");
  assert.ok(row.querySelector(".detail"), "it is open");
  assert.equal(row.scrolled, 1, "it was scrolled into sight, after the frame was fitted");
  assert.equal(app.querySelector("button.chip[aria-pressed=\"true\"]").textContent.startsWith("All"), true);
  // One in section 6 opens What it reaches.
  tabNamed(app, "Overview").click();
  see("S6-011").click();
  assert.deepEqual(selected(app), ["What it reaches"]);
  await ticks();
  const six = app.querySelectorAll("li.row").find((r) => r.id === "f-S6-011");
  assert.equal(six.scrolled, 1);
  assert.equal(doc.activeElement, six.querySelector(".toggle"), "focus goes to the finding");
});

test("[F5.R9] a finding past the fold is unfolded by its See link", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `S3-${String(i + 1).padStart(3, "0")}`, section: 3, kind: "part", title: `part ${i + 1}`, says: "A part.", by: "script", evidence: ev(`lib/p${i}.mjs`, 1) }));
  const list = [{ id: "S1-001", section: 1, kind: "glance", title: "The last part", says: "Again.", by: "model", repeats: "S3-018", evidence: many[17].evidence }, ...findings().filter((f) => f.section !== 1), ...many.slice(1)];
  const { app } = drawn(report(list));
  shownPanel(app).querySelector("button.linkish").click();
  assert.deepEqual(selected(app), ["What it does"]);
  await ticks();
  assert.ok(app.querySelectorAll("li.row").some((r) => r.id === "f-S3-018" && r.scrolled === 1), "the row past the fold is drawn and in sight");
});

test("[F5.R9] while the job runs, a tab whose sections have not arrived says so plainly, and the counts on the labels climb as findings come in", () => {
  // The scripts' findings only: section 2, one skill and one known vulnerability.
  const scripts = findings().filter((f) => f.by === "script");
  const p = drawn(copyOf(scripts, "Asking the model for the judgments of sections 3, 4 and 5."), { job_state: "working", lifecycle: null });
  const { app } = p;
  const label = (name) => tabNamed(app, name);
  for (const name of ["What it reaches", "Tests and gaps"]) {
    assert.ok(label(name).classList.contains("tab-waiting"), `${name} is waiting`);
    assert.equal(label(name).querySelector(".tab-n").textContent, "…", `${name} counts nothing yet, and says so without a 0`);
    assert.match(label(name).getAttribute("aria-label"), /: nothing yet, still to come$/);
    assert.equal(label(name).querySelector(".live"), null, `${name} says it once, with the ellipsis`);
  }
  assert.ok(label("Risks").classList.contains("tab-filling"), "Risks has the scripts' finding and waits for the model's");
  assert.equal(label("Risks").querySelector(".tab-n").textContent, "1");
  assert.ok(label("Risks").querySelector(".live"), "a tab still filling shows it is live");
  assert.match(label("Risks").getAttribute("aria-label"), /1 finding so far, more to come/);
  // The waiting tab, opened: it says so, and names the sections to come.
  label("Tests and gaps").click();
  const panel = shownPanel(app);
  assert.equal(panel.querySelector(".waitcard strong").textContent, "Nothing here yet.");
  assert.deepEqual(panel.querySelectorAll(".waitcard li").map((li) => li.textContent), ["8Tests, and what Inspect couldn't tellWaiting"]);
  // A tab that has some: its findings, and a line saying more arrive.
  label("Risks").click();
  assert.equal(shownPanel(app).querySelectorAll("li.row").length, 1);
  assert.ok(shownPanel(app).querySelectorAll("p.coming").some((x) => x.textContent === "More findings for this section arrive once the model has judged it."));
  assert.equal(shownPanel(app).querySelector(".sec-h .count").textContent, "1 finding so far");
  // The model answers about sections 3 to 5, then 6 to 8: the counts climb.
  const counts = () => TAB_NAMES.map((n) => label(n).querySelector(".tab-n").textContent);
  const climbs = [counts()];
  const first = findings().filter((f) => f.by === "script" || [3, 4, 5].includes(f.section));
  p.data(copyOf(first, "Asking the model for the judgments of sections 6, 7 and 8."));
  climbs.push(counts());
  assert.ok(!label("What it reaches").classList.contains("tab-waiting"), "section 5 arrived");
  assert.ok(label("What it reaches").classList.contains("tab-filling"), "section 6 is still to come");
  p.data(copyOf(findings().filter((f) => f.section !== 1), "Writing section 1, at a glance."));
  climbs.push(counts());
  assert.deepEqual(climbs, [["1", "1", "…", "1", "…"], ["1", "2", "1", "1", "…"], ["1", "2", "2", "5", "1"]]);
  for (const name of TAB_NAMES.slice(1)) assert.ok(!label(name).classList.contains("tab-filling") && !label(name).classList.contains("tab-waiting"), `${name} has all it will get`);
  assert.ok(label("Overview").classList.contains("tab-filling"), "At a glance is written last");
});

test("[F5.R9] the tab the person is on stays put when new data arrives, and keeps its focus", () => {
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
  assert.equal(app.querySelector("ol.track li[aria-current=\"step\"]").textContent, "Draft, waiting for your review");
  // A row opened stays open, and focused, through new data.
  tabNamed(app, "Risks").click();
  const toggle = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-021").querySelector(".toggle");
  toggle.click(); toggle.focus();
  p.data(report(), { job_state: "completed", lifecycle: "accepted" });
  const again = app.querySelectorAll("li.row").find((r) => r.id === "f-S7-021");
  assert.deepEqual(selected(app), ["Risks"]);
  assert.ok(again.querySelector(".detail"));
  assert.equal(doc.activeElement, again.querySelector(".toggle"));
});

test("[F5.R9] arrow keys, Home and End move between the tabs and open them; each change asks the frame to fit; a visible focus ring; the strip scrolls inside itself", () => {
  const { app, sent } = drawn(report());
  tabNamed(app, "Overview").focus();
  const go = (key) => { const before = resizes(sent); const moved = doc.activeElement.press(key); return { moved, asked: resizes(sent) - before, on: selected(app)[0], focus: doc.activeElement?.querySelector(".tab-name")?.textContent }; };
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "What it does", focus: "What it does" });
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "What it reaches", focus: "What it reaches" });
  assert.deepEqual(go("End"), { moved: true, asked: 1, on: "Tests and gaps", focus: "Tests and gaps" });
  assert.deepEqual(go("ArrowRight"), { moved: true, asked: 1, on: "Overview", focus: "Overview" }, "past the last, the first");
  assert.deepEqual(go("ArrowLeft"), { moved: true, asked: 1, on: "Tests and gaps", focus: "Tests and gaps" }, "before the first, the last");
  assert.deepEqual(go("Home"), { moved: true, asked: 1, on: "Overview", focus: "Overview" });
  assert.deepEqual(go("a"), { moved: false, asked: 0, on: "Overview", focus: "Overview" }, "another key does nothing");
  // A click asks the frame to fit too.
  const before = resizes(sent);
  tabNamed(app, "Risks").click();
  assert.equal(resizes(sent), before + 1);
  assert.equal(tabNamed(app, "Risks").getAttribute("tabindex"), "0");
  assert.equal(tabNamed(app, "Overview").getAttribute("tabindex"), "-1");
  // The stylesheet: a focus ring of its own on a tab; the strip scrolls
  // sideways inside itself and its tabs never wrap or shrink.
  const rule = (sel) => style.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()*+?^$|\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".tab:focus-visible"), /outline: 2px solid var\(--accent\)/);
  assert.match(rule(".tabs"), /overflow-x: auto/);
  assert.match(rule(".tab"), /flex: none/);
  assert.match(rule(".tab-name"), /white-space: nowrap/);
});
