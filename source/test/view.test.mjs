// F5.R9, the report's view, and the words for a person (Common Agent
// Specification 6.13; DESCRIPTOR-UI 0.2.0 Section 9).
//
// What is worth pinning, from the file's bytes and the descriptor: the
// views[] entry names a declared offering and output, a file in the package
// and that file's digest, and only requests from the bridge's closed list;
// the view loads nothing from anywhere and names no address a script, style,
// image, font or frame could come from; it speaks only the bridge's methods
// and asks only for what it declares; every --ca-* token it draws with is one
// of the twelve and carries a fallback; every level has a shape of its own;
// and the descriptor's words for a person are as Section 6.13 asks.
//
// How the view draws, in light and dark, with the full, partial and empty
// reports, is checked by playing the host's side of the bridge in a headless
// browser (the build record says how); nothing here starts a browser.
//   node --test test/view.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, descriptor } from "./helpers.mjs";

const REQUESTS = ["resize", "propose-inputs", "save-file", "copy-text"];
const BRIDGE = ["view/initialize", "view/data", "view/host-changed", "view/teardown", "view/ready", "view/resize", "view/propose-inputs", "view/save-file", "view/copy-text", "view/report-failure"];
const TOKENS = ["--ca-color-background", "--ca-color-surface", "--ca-color-text", "--ca-color-text-muted", "--ca-color-accent", "--ca-color-border", "--ca-color-danger", "--ca-font-body", "--ca-font-mono", "--ca-font-size", "--ca-radius", "--ca-space"];
const d = descriptor();
const view = d.views?.[0];
const bytes = view ? readFileSync(join(ROOT, view.file)) : Buffer.alloc(0);
const html = bytes.toString("utf8");

test("[F5.R9] views[] declares the report view for the output inspection, by the digest of its file in the package", () => {
  assert.equal(d.views.length, 1);
  const o = d.offerings.find((x) => x.id === view.for.offering);
  assert.ok(o, "for names a declared offering");
  assert.ok(o.outputs.some((x) => x.name === view.for.output), "for names a declared output");
  assert.equal(view.id, "report");
  assert.equal(view.file, "views/report.html");
  assert.match(view.file, /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^:\\]+$/, "a relative path with forward slashes, no .. and no scheme");
  assert.ok(existsSync(join(ROOT, view.file)));
  assert.match(view.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(view.digest, `sha256:${createHash("sha256").update(bytes).digest("hex")}`, "the digest is of the file's exact bytes");
  assert.deepEqual(view.requests, ["resize", "copy-text", "save-file"]);
  for (const r of view.requests) assert.ok(REQUESTS.includes(r));
});

test("[F5.R9] the view is one file that loads nothing and names no address anything could be loaded from", () => {
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/https?:\/\//i.test(html), "no address");
  const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  const markup = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "");
  const tags = [...markup.matchAll(/<[a-z][^>]*>/gi), ...script.matchAll(/<[a-z][^>`'"]*(?:"[^"]*"[^>`'"]*)*>/gi)].map((m) => m[0]);
  for (const t of tags) assert.ok(!/\s(src|href|srcset|action|formaction|poster|xlink:href)\s*=/i.test(t) && !/^<(link|iframe|frame|object|embed|img|base|audio|video|source|script\s+src)\b/i.test(t), `a tag that loads nothing: ${t}`);
  assert.ok(!/url\s*\(|@import|@font-face/i.test(style), "the style loads nothing");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|window\.open|importScripts|\bimport\s*\(|\.src\s*=|\.href\s*=|location\s*=/i.test(script), "the script reaches out to nothing");
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'none';/, "its own policy closes the network too");
});

test("[F5.R9] the view speaks only the bridge's methods, and asks only for the requests it declares", () => {
  const methods = [...new Set([...html.matchAll(/"(view\/[a-z-]+)"/g)].map((m) => m[1]))];
  for (const m of methods) assert.ok(BRIDGE.includes(m), `${m} is a bridge method`);
  const asked = [...new Set([...html.matchAll(/ask\("view\/([a-z-]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(asked.sort(), [...view.requests].sort());
  assert.match(html, /const REQUESTS = \["resize", "copy-text", "save-file"\];/, "it answers view/initialize with what it declares");
});

test("[F5.R9] every token the view draws with is one of the twelve, with a fallback; every level has its own shape; no em dash", () => {
  const used = [...html.matchAll(/var\((--ca-[a-z-]+)(\s*[,)])/g)];
  assert.ok(used.length >= 12);
  for (const [, name, after] of used) {
    assert.ok(TOKENS.includes(name), `${name} is a token`);
    assert.equal(after.trim(), ",", `${name} carries a fallback`);
  }
  for (const level of ["critical", "high", "medium", "low", "none"]) assert.match(html, new RegExp(`\\n    ${level}: '<`), `${level} has a shape`);
  assert.ok(!/[–—]/.test(html), "no en or em dash");
});

test("[F5.R9] the descriptor's words for a person: a name, one short sentence, an about for each input, and an example that runs", () => {
  assert.equal(d.name, "Inspect");
  assert.ok(d.summary.length <= 200 && !/[.!?]\s+\S/.test(d.summary.replace(/\.$/, "")), "one sentence of at most 200 characters");
  const o = d.offerings[0];
  for (const i of o.inputs) assert.ok(i.about && !/[.!?]\s+[A-Z]/.test(i.about), `${i.name} has one sentence for a person`);
  for (const i of o.inputs.filter((x) => x.required)) assert.ok(o.example.inputs[i.name], `the example gives ${i.name}`);
  for (const k of Object.keys(o.example.inputs)) assert.ok(o.inputs.some((i) => i.name === k), `${k} is a declared input`);
  assert.ok(o.example.good_result && !/[.!?]\s+\S/.test(o.example.good_result.replace(/\.$/, "")));
  const md = o.outputs.find((x) => x.name === "inspection-md");
  assert.equal(md.kind, "text/markdown");
  assert.equal(md.presentation, "document");
});
