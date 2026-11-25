// Unpack GitHub's archive of a commit into the job's own folder.
//
// The archive came from somebody else, so it never decides where a file
// lands: an entry whose path is absolute, names a drive or climbs out with
// `..` is not written, and neither is a link of any kind. Each one is kept as
// a fact with its path (and, for a link, where it points), because a link in
// an agent's repository is something its reader should know about.
//
// GitHub writes a pax global header first, whose comment is the commit the
// archive was made from, and puts every file under one top folder
// (<owner>-<name>-<short digest>/), which is taken off each path.
//
// The reverse engineer's archive.mjs refuses an archive holding any link at
// all, which GitHub's archive of a repository with a link always is, so this
// reader is Inspect's own.
//
//   needs: node >= 22 (node:zlib)
//   import { untar, MAX_FILES } from "./untar.mjs"
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

/** The most files read from one archive. */
export const MAX_FILES = 20000;

const BLOCK = 512;
const text = (buf, from, to) => { const s = buf.subarray(from, to); const z = s.indexOf(0); return s.subarray(0, z < 0 ? s.length : z).toString("utf8"); };

/** The records of a pax header body: {key: value}. */
export function paxOf(body) {
  const out = {};
  let at = 0;
  const s = body.toString("utf8");
  while (at < s.length) {
    const sp = s.indexOf(" ", at);
    if (sp < 0) break;
    const len = Number(s.slice(at, sp));
    if (!Number.isInteger(len) || len <= 0) break;
    const rec = s.slice(sp + 1, at + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

/** Whether a path stays inside the folder: relative, no `..`, no drive. */
export function isSafePath(rel) {
  const p = String(rel ?? "").replace(/\\/g, "/");
  if (!p || p.includes("\0") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split("/").includes("..");
}

/**
 * Unpack `gz` (the archive's bytes) into `dir`. Answers
 * {ok: true, commit, files, links, refused, skipped} or {ok: false, said}
 * when the archive is not a gzip tar or holds more than maxFiles files.
 * Nothing is written until every entry has been read.
 */
export function untar(gz, dir, { maxFiles = MAX_FILES } = {}) {
  let tar;
  try { tar = gunzipSync(gz); } catch (e) { return { ok: false, said: `GitHub's archive could not be read as a gzip archive (${e.message}), so nothing was inspected.` }; }
  const entries = []; const links = []; const refused = []; const skipped = [];
  let commit = null; let pax = null; let longName = null; let at = 0;
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(text(h, 124, 136).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0 || at + BLOCK + size > tar.length) return { ok: false, said: "GitHub's archive ends in the middle of a file, so nothing was inspected." };
    const type = String.fromCharCode(h[156] || 0x30);
    const body = tar.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "g") { const g = paxOf(body); if (/^[0-9a-f]{40}$/i.test(g.comment ?? "")) commit = g.comment.toLowerCase(); continue; }
    if (type === "x") { pax = paxOf(body); continue; }
    if (type === "L") { longName = text(body, 0, body.length); continue; }
    const prefix = text(h, 345, 500);
    const raw = pax?.path ?? longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
    const target = pax?.linkpath ?? text(h, 157, 257);
    pax = null; longName = null;
    // GitHub's one top folder is taken off every path.
    const path = raw.replace(/\\/g, "/").replace(/^\.\//, "").split("/").slice(1).join("/").replace(/\/+$/, "");
    if (!path) continue;
    if (type === "5") continue;
    if (type === "2" || type === "1") { links.push({ path, points_to: target, kind: type === "2" ? "symbolic link" : "hard link" }); continue; }
    if (type !== "0" && type !== "\0" && type !== "7") { skipped.push({ path, why: `an entry of kind ${JSON.stringify(type)}, which is not a file` }); continue; }
    if (!isSafePath(path)) { refused.push({ path, why: "its path leaves the folder" }); continue; }
    entries.push({ path, bytes: Buffer.from(body) });
    if (entries.length > maxFiles) return { ok: false, said: `GitHub's archive holds more than ${maxFiles} files, the most Inspect reads, so nothing was inspected.` };
  }
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const files = [];
  for (const e of entries) {
    const to = resolve(root, e.path);
    if (to === root || !to.startsWith(root + sep)) { refused.push({ path: e.path, why: "its path leaves the folder" }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, e.bytes);
    files.push(e.path);
  }
  return { ok: true, commit, files: files.sort(), links, refused, skipped };
}
