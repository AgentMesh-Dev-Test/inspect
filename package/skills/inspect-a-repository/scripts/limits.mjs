// How many inspections Inspect starts in a day (0.4.5).
//
// Each inspection makes at most three calls of the model, each with its own
// output budget (judge.mjs BUDGETS) and a cap on what it is given
// (CALL_TOKENS), so a cap on inspections is a cap on what the model is asked
// for: PER_ASKER for one asker and PER_DAY for everyone, by UTC day. They are
// checked before anything is read or asked, so a refusal comes at the door,
// with the reason and when to try again, never in the middle of the work.
//
// The counts live in the records folder the host keeps from one job to the
// next (RECORDS, or --records), in one small file: the day, the total, and a
// count for each asker under a digest of the account or agent that asked,
// never its name. A new day starts the file again, so it keeps one day at
// most. Two inspections that start in the same moment may both read the
// same count, so a cap can let one more through; it never lets many.
//
//   needs: node >= 22. Reads and writes one file in the records folder.
//   import { admit, askerOf, PER_ASKER, PER_DAY, COUNTS_FILE } from "./limits.mjs"
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The most inspections one asker starts in a UTC day. */
export const PER_ASKER = 20;
/** The most inspections Inspect starts in a UTC day, for everyone. */
export const PER_DAY = 200;
/** The file in the records folder that holds the day's counts. */
export const COUNTS_FILE = "inspect-daily.json";

const day = (now) => now.toISOString().slice(0, 10);
/** Whole hours until the next UTC day, at least one. */
const hoursLeft = (now) => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 3_600_000));
};
const inHours = (n) => `${n} ${n === 1 ? "hour" : "hours"}`;

/** Who asked, from the job folder's message.json, as a digest: the account
 *  when the host names it, else the agent that sent the message; null when
 *  neither is there. */
export function askerOf(jobDir) {
  let m = null;
  try { m = JSON.parse(readFileSync(join(jobDir, "message.json"), "utf8")); } catch { return null; }
  const acct = typeof m?.acct === "string" ? m.acct : m?.acct?.id ?? m?.acct?.account ?? null;
  const who = String(acct ?? m?.from ?? "").trim();
  return who ? createHash("sha256").update(who).digest("hex").slice(0, 16) : null;
}

/**
 * Whether one more inspection may start now: {ok: true, total, mine} with
 * the counts taken, or {ok: false, refusal} in words. A folder or file that
 * cannot be read or written refuses too: a cap that cannot count is no cap.
 */
export function admit({ recordsDir, asker, now = new Date(), perAsker = PER_ASKER, perDay = PER_DAY } = {}) {
  const file = join(recordsDir, COUNTS_FILE);
  let c = { day: day(now), total: 0, by: {} };
  try {
    if (existsSync(file)) {
      const read = JSON.parse(readFileSync(file, "utf8"));
      if (read?.day === day(now)) c = { day: read.day, total: Number(read.total) || 0, by: read.by && typeof read.by === "object" ? read.by : {} };
    }
  } catch (e) {
    return { ok: false, refusal: `Inspect cannot read today's count of its inspections here (${String(e?.message ?? e)}), so it did not start one; try again later.` };
  }
  const who = asker || "unknown";
  const mine = Number(c.by[who]) || 0;
  if (c.total >= perDay) return { ok: false, refusal: `Inspect has made the ${perDay} inspections it makes in a day, so it did not start this one. Try again in ${inHours(hoursLeft(now))}.` };
  if (mine >= perAsker) return { ok: false, refusal: `You have asked for the ${perAsker} inspections one asker may have in a day, so Inspect did not start this one. Try again in ${inHours(hoursLeft(now))}.` };
  c.total += 1;
  c.by[who] = mine + 1;
  try {
    mkdirSync(recordsDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(c)}\n`);
    renameSync(tmp, file);
  } catch (e) {
    return { ok: false, refusal: `Inspect cannot keep today's count of its inspections here (${String(e?.message ?? e)}), so it did not start one; try again later.` };
  }
  return { ok: true, total: c.total, mine: c.by[who] };
}
