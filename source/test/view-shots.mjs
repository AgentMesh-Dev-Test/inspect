#!/usr/bin/env node
// Draws views/report.html in the stand-in host (test/view-host.html) in a
// headless Edge, started hidden and driven over the DevTools protocol, and
// saves a screenshot of each case with what the host heard.
//
//   node test/view-shots.mjs --out <folder> --finished <inspection.json> --partial <working copy .json> [--waiting <working copy .json>] [--cases <cases.json>]
//
// A case: { name, report: "finished" | "partial" | "waiting" | <path>, job_state, lifecycle, scheme: "light" | "dark", window: 1440, box: 690, tab: "risks", press: ["ArrowRight"], probe: "<an expression evaluated in the view, kept in summary.json>" }.
// Without --cases, the default set: the partial and the finished report on
// Overview and on Risks, at a 1440 window with a 690-pixel frame and a 400
// window with a 368-pixel frame, light and dark; and the waiting copy on What
// it does. For each case summary.json keeps whether the view said ready and
// how soon, every request it made, anything outside the bridge or its
// declaration, whether the page scrolled sideways, and whether the tab strip
// scrolls inside itself.
//
// This is a check a person runs and looks at, not a test of the suite: it
// starts a browser. Nothing here touches a network; the host and the view
// load nothing. The browser's profile is a temporary folder, removed after.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = readFileSync(join(HERE, "..", "views", "report.html"), "utf8");
const DESCRIPTOR = JSON.parse(readFileSync(join(HERE, "..", "agent-descriptor.json"), "utf8"));
const HOST = pathToFileURL(join(HERE, "view-host.html")).href;
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.out || !args.finished || !args.partial) {
  console.error("view-shots: --out, --finished and --partial are needed");
  process.exit(2);
}
const OUT = resolve(args.out);
mkdirSync(OUT, { recursive: true });
const FIXTURES = { finished: args.finished, partial: args.partial, waiting: args.waiting };
const STATES = { finished: { job_state: "completed", lifecycle: "draft" }, partial: { job_state: "working", lifecycle: null }, waiting: { job_state: "working", lifecycle: null } };

function defaultCases() {
  const out = [];
  for (const report of ["partial", "finished"]) for (const [window, box] of [[1440, 690], [400, 368]]) for (const scheme of ["light", "dark"]) for (const tab of ["overview", "risks"]) {
    out.push({ name: `${report}-${window}-${scheme}-${tab}`, report, scheme, window, box, tab });
  }
  if (FIXTURES.waiting) out.push({ name: "waiting-1440-light-does", report: "waiting", scheme: "light", window: 1440, box: 690, tab: "does" });
  return out;
}
const cases = args.cases ? JSON.parse(readFileSync(args.cases, "utf8")) : defaultCases();

// ── A small DevTools protocol client over the browser's own socket ──
class Cdp {
  constructor(url) { this.url = url; this.n = 0; this.waits = new Map(); this.listeners = new Set(); }
  open() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8"));
      if (m.id && this.waits.has(m.id)) { const w = this.waits.get(m.id); this.waits.delete(m.id); if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result); return; }
      for (const l of this.listeners) l(m);
    };
    return new Promise((ok, no) => { this.ws.onopen = ok; this.ws.onerror = () => no(new Error("the browser's socket did not open")); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.waits.set(id, { resolve, reject, method }));
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "inspect-view-edge-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let cdp;
const summary = [];
try {
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i += 1) await pause(100);
  const [port, path] = readFileSync(portFile, "utf8").split(/\r?\n/);
  cdp = new Cdp(`ws://127.0.0.1:${port}${path}`);
  await cdp.open();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: page } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // A frame in a process of its own is attached here; one in the page's
  // process is reached through an isolated world of its own.
  const frames = new Map();
  cdp.listeners.add((m) => {
    if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "iframe") frames.set(m.params.targetInfo.targetId, m.params.sessionId);
    if (m.method === "Target.detachedFromTarget") for (const [k, v] of frames) if (v === m.params.sessionId) frames.delete(k);
  });
  await cdp.send("Page.enable", {}, page);
  await cdp.send("Runtime.enable", {}, page);
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page);
  const inHost = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page)).result.value;
  const inView = async (expression) => {
    const [only] = frames.values();
    if (only) return (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, only)).result.value;
    const tree = await cdp.send("Page.getFrameTree", {}, page);
    const child = tree.frameTree.childFrames?.[0]?.frame?.id;
    if (!child) throw new Error("the view's frame is not there");
    const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId: child, worldName: "view-shots" }, page);
    return (await cdp.send("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true }, page)).result.value;
  };
  const settled = async () => {
    let last = ""; let same = 0;
    for (let i = 0; i < 100 && same < 4; i += 1) {
      await pause(100);
      const now = JSON.stringify(await inHost("[window.host.ready, window.host.heights.at(-1), document.documentElement.scrollHeight]"));
      same = now === last ? same + 1 : 0; last = now;
    }
  };

  for (const c of cases) {
    const file = FIXTURES[c.report] ?? c.report;
    const text = readFileSync(file, "utf8");
    const st = { ...STATES[c.report], ...(c.job_state ? { job_state: c.job_state } : {}), ...(c.lifecycle !== undefined ? { lifecycle: c.lifecycle } : {}) };
    frames.clear();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: c.window, height: 900, deviceScaleFactor: 1, mobile: false }, page);
    await cdp.send("Page.navigate", { url: HOST }, page);
    for (let i = 0; i < 50 && (await inHost("document.readyState").catch(() => "")) !== "complete"; i += 1) await pause(100);
    await inHost(`window.host.start(${JSON.stringify(VIEW)}, ${JSON.stringify({ scheme: c.scheme, box: c.box })})`);
    await inHost(`window.host.data(${JSON.stringify(text)}, ${JSON.stringify({ ...st, descriptor: DESCRIPTOR })})`);
    await settled();
    if (c.tab) await inView(`document.getElementById(${JSON.stringify(`tab-${c.tab}`)})?.click()`);
    for (const id of c.open ?? []) await inView(`document.getElementById(${JSON.stringify(`f-${id}`)})?.querySelector(".toggle")?.click()`);
    for (const key of c.press ?? []) await inView(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
    await settled();
    const seen = await inView(`(() => {
      const s = document.querySelector(".tabs");
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-label"));
      return { tab: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null, page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }, strip: s ? { scroll: s.scrollWidth, client: s.clientWidth } : null, tabs };
    })()`);
    const probe = c.probe ? await inView(c.probe) : undefined;
    const heard = await inHost("({ ready: window.host.ready, readyMs: Math.round((window.host.readyAt ?? NaN) - window.host.startedAt), asked: [...new Set(window.host.log.filter((m) => m && m.method && m.id !== undefined).map((m) => m.method))], broken: window.host.broken, heights: window.host.heights })");
    const height = await inHost("Math.ceil(document.documentElement.scrollHeight)");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: c.window, height: Math.max(600, height), deviceScaleFactor: 1, mobile: false }, page);
    await pause(150);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, page);
    const png = join(OUT, `${c.name}.png`);
    writeFileSync(png, Buffer.from(shot.data, "base64"));
    const row = { name: c.name, png, ...heard, ...seen, sideways: seen.page.scroll > seen.page.client, stripScrolls: Boolean(seen.strip && seen.strip.scroll > seen.strip.client), ...(probe !== undefined ? { probe } : {}) };
    summary.push(row);
    console.log(`${c.name}: ready ${row.ready} in ${row.readyMs} ms; asked ${row.asked.join(", ") || "nothing"}; ${row.broken.length ? `BROKEN ${JSON.stringify(row.broken)}` : "nothing outside the bridge"}; sideways ${row.sideways}; strip scrolls ${row.stripScrolls}; tab ${row.tab}`);
  }
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
} finally {
  try { await cdp?.send("Browser.close"); } catch { /* already gone */ }
  await pause(500);
  if (edge.exitCode === null) edge.kill();
  for (let i = 0; i < 10; i += 1) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await pause(300); } }
}
