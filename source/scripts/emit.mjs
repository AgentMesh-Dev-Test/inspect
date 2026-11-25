// The one place a finding is emitted, and where it is posted to the running job.
//
// Every finding, from the scripts and from the model, passes emitFinding in
// the order it is found. The emitter keeps each finding for the report, which
// is delivered whole at the end of the job, and hands it to `onFinding` the
// moment it is emitted.
//
// The emitter gives each finding its id, S<section>-<nnn>, numbered within
// its section in the order emitted, so a later page can draw it as it
// arrives and the report can list them in section order.
//
// Posting while the job runs (0.1.2): liveUpdates(jobDir) is the onFinding
// the command uses. It appends one line per update to the job folder's
// updates.jsonl, which the adapter reads while the job is open and sends to
// the sender on the job's task (adapter 0.102.0): each finding as a piece
// named by its id, its whole finding as the piece's data, and a status line
// as each stage of the inspection begins. Anything that looks like a
// credential is taken out first, as it is from the report. A finding too
// large for one piece goes as its title and words, with a note that the
// whole of it is in inspection.json; nothing is cut without saying so.
//
//
// The working copy (0.2.0): with each write, the report so far, posted under
// the report's own name, inspection, so the report's view can draw it while
// the job runs (see liveUpdates).
//
//   needs: node >= 22
//   import { createEmitter, liveUpdates, UPDATES_FILE, PIECE_CHARS, WORKING_COPY } from "./emit.mjs"
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { deepScrub, scrub } from "./secrets.mjs";
import { workingCopy } from "./report.mjs";

/** The file in the job folder the adapter reads updates from. */
export const UPDATES_FILE = "updates.jsonl";
/** The most a piece's data may take as JSON; the adapter takes 64 KB. */
export const PIECE_CHARS = 60_000;

/**
 * An emitter: { emitFinding(finding), findings(), count }. `onFinding` is
 * called with each finding, its id given, the moment it is emitted.
 */
export function createEmitter({ onFinding = () => {} } = {}) {
  const kept = [];
  const next = new Map();
  /** Emit one finding: give it its id, keep it, tell the listener. */
  function emitFinding(finding) {
    const section = Number(finding?.section);
    if (!Number.isInteger(section) || section < 1 || section > 8) throw new Error(`a finding names section ${JSON.stringify(finding?.section)}, which is not one of the eight`);
    const n = (next.get(section) ?? 0) + 1;
    next.set(section, n);
    const out = { id: `S${section}-${String(n).padStart(3, "0")}`, ...finding, section };
    kept.push(out);
    onFinding(out);
    return out;
  }
  /** The findings in section order, each section in the order emitted. */
  function findings() {
    return [...kept].sort((a, b) => a.section - b.section || kept.indexOf(a) - kept.indexOf(b));
  }
  return { emitFinding, findings, get count() { return kept.length; } };
}

/** A finding as one piece's data: the whole finding, or, when it is too large
 *  for one piece, its id, place, title and words with a note saying where the
 *  rest is. */
export function pieceData(finding) {
  const clean = deepScrub(finding);
  if (JSON.stringify(clean).length <= PIECE_CHARS) return clean;
  const { id, section, kind, title, says, by, level, level_by, categories, repeats } = clean;
  return {
    id, section, kind, title, says, by,
    ...(level ? { level, level_by } : {}), ...(categories ? { categories } : {}), ...(repeats ? { repeats } : {}),
    note: `this finding is larger than one piece takes (${PIECE_CHARS.toLocaleString("en-US")} characters), so its evidence and detail are in inspection.json under ${id}`,
  };
}

/** The name the working copy of the report is posted under: the report's own. */
export const WORKING_COPY = "inspection";

/**
 * The job's live updates, written to `<jobDir>/updates.jsonl`:
 * { start(about), finding(f), status(words), flush() }.
 *
 * Updates are kept and written together once per turn of the event loop
 * (0.2.0), as whole lines in one append, so the adapter never reads half an
 * update. On a worker the job folder is a mounted bucket, where every append
 * uploads the whole file again: in 0.1.2 one append per finding made the
 * scripts' findings take a minute to write. Now the scripts' findings are one
 * write, and each answer of the model one more.
 *
 * Each write ends with the working copy of the report (report.mjs
 * workingCopy), posted under the report's own name, so a page that draws the
 * report can draw it while the job runs: it is posted again whenever a
 * finding or a stage was added since the last, each post whole, replacing
 * the one before. `start(about)` gives it the repository and the commit.
 *
 * A write that fails is said once and never stops the inspection: the report
 * still carries every finding.
 */
export function liveUpdates(jobDir, { append = appendFileSync, warn = (line) => process.stderr.write(`${line}\n`), later = setImmediate } = {}) {
  const file = join(jobDir, UPDATES_FILE);
  let failed = false; let queued = []; let due = false; let about = null; let stage = ""; let changed = false;
  const found = [];
  const flush = () => {
    due = false;
    if (changed && about) queued.push({ piece: WORKING_COPY, data: workingCopy({ about, findings: found, stage }), last: true });
    changed = false;
    if (!queued.length) return;
    const lines = queued.map((u) => `${JSON.stringify(u)}\n`).join("");
    queued = [];
    try { append(file, lines); } catch (e) {
      if (!failed) warn(`the live updates could not be written to ${UPDATES_FILE} (${e?.message ?? e}); the report still carries every finding`);
      failed = true;
    }
  };
  const soon = () => { if (!due) { due = true; later(flush); } };
  return {
    start: (a) => { about = deepScrub(a); changed = true; soon(); },
    finding: (f) => { const clean = deepScrub(f); found.push(clean); queued.push({ piece: f.id, data: pieceData(clean), last: true }); changed = true; soon(); },
    status: (words) => { stage = scrub(String(words)); queued.push({ progress: stage }); changed = true; soon(); },
    flush,
  };
}
