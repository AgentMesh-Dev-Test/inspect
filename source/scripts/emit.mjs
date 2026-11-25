// The one place a finding is emitted.
//
// Every finding, from the scripts and from the model, passes emitFinding in
// the order it is found. Today the emitter keeps each finding for the report,
// which is delivered whole at the end of the job. When the adapter lets an
// agent post findings to its running job (the Adapter Streaming work), the
// post goes in `onFinding`, here, and nowhere else changes.
//
// The emitter gives each finding its id, S<section>-<nnn>, numbered within
// its section in the order emitted, so a later page can draw it as it
// arrives and the report can list them in section order.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { createEmitter } from "./emit.mjs"

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
