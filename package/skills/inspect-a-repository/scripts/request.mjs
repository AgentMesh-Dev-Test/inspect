// Read the request: which public GitHub repository, at which commit.
//
// The repository comes from a `repository:` line (https://github.com/<owner>/<name>
// or <owner>/<name>) or from a GitHub address anywhere in the message; the
// commit from a `commit:` line or from the last part of a /commit/<digest> or
// /tree/<digest> address. A commit is its digest, 7 to 40 hexadecimal
// characters: a branch or a tag can move, so neither is taken.
//
// Two asks are noticed and never acted on: to run, install, build or test the
// code (Inspect only reads it), and for a verdict or a fit with a plan
// (Inspect gives neither). The reply says so, and the inspection goes ahead.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { readRequest, RUN_REFUSAL, VERDICT_REFUSAL } from "./request.mjs"

const trim = (s) => String(s ?? "").trim();

export const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const DIGEST = /^[0-9a-fA-F]{7,40}$/;

/** What the reply says when it is asked to run the code. */
export const RUN_REFUSAL = "Inspect only reads the code: it runs, installs, builds and tests nothing from the repository, so it did not do that part.";
/** What the reply says when it is asked for a verdict or a fit. */
export const VERDICT_REFUSAL = "Inspect gives no verdict and judges no fit: it says what the agent does and how safe it is, and the decision stays with you.";

const RUN_ASK = /\b(?:run|execute|install|build|compile|deploy)\b[^.?!\n]{0,60}\b(?:it|its|the|this|code|repo(?:sitory)?|tests?|agent|scripts?)\b|\b(?:run|execute)\s+(?:its|the)\s+tests?\b|\bnpm\s+(?:install|test|run)\b|\bpip\s+install\b/i;
const VERDICT_ASK = /\b(?:should\s+(?:we|i)\s+(?:bring|use|adopt|install|hire)|bring\s+(?:it|this|them|[\w./-]+)\s+in(?:to)?\b|whether\s+to\s+(?:bring|use|adopt|install)|is\s+it\s+safe\s+to\s+(?:use|install|adopt|bring)|recommend|verdict|go\s*\/\s*no[- ]go|fits?\s+(?:our|my|the)\s+(?:plan|roadmap|department)|catalog\s+roles?)\b/i;

/** A GitHub address's owner, name and, where it names one, the commit. */
export function fromAddress(text) {
  const m = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/(?:commit|tree)\/([^\s/?#)>"'`]+))?(?=[\s/?#)>"'`.,;]|$)/i.exec(String(text ?? ""));
  if (!m) return null;
  return { owner: m[1], name: m[2], ...(m[3] ? { commit: m[3] } : {}) };
}

/** The value of a `key:` line, or "". */
export function lineValue(text, key) {
  const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im").exec(String(text ?? ""));
  return m ? trim(m[1]) : "";
}

/**
 * The request: {ok: true, owner, name, commit, asks_to_run, asks_verdict}, or
 * {ok: false, refusal} saying what is missing or wrong. No call is made here.
 */
export function readRequest(text) {
  const words = String(text ?? "");
  const repoLine = lineValue(words, "repo(?:sitory)?");
  const commitLine = lineValue(words, "commit");
  let owner = ""; let name = ""; let commit = "";
  const fromLine = repoLine ? (fromAddress(repoLine) ?? (() => {
    const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(repoLine);
    return m ? { owner: m[1], name: m[2] } : null;
  })()) : null;
  const fromWords = fromLine ?? fromAddress(words);
  if (fromWords) { owner = fromWords.owner; name = fromWords.name; commit = fromWords.commit ?? ""; }
  if (commitLine) commit = commitLine.split(/\s+/)[0];
  const missing = [];
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name)) missing.push("the repository (https://github.com/<owner>/<name>)");
  if (!commit) missing.push("the commit (its digest, 7 to 40 hexadecimal characters)");
  if (missing.length) {
    return { ok: false, refusal: `Inspect needs ${missing.join(" and ")}, and the message does not name ${missing.length === 2 ? "either" : "it"}, so nothing was inspected.` };
  }
  if (!DIGEST.test(commit)) {
    return { ok: false, refusal: `Inspect reads one commit, named by its digest (7 to 40 hexadecimal characters), and ${JSON.stringify(commit)} is not one. A branch or a tag can move, so give the commit's digest; nothing was inspected.` };
  }
  return { ok: true, owner, name, commit: commit.toLowerCase(), asks_to_run: RUN_ASK.test(words), asks_verdict: VERDICT_ASK.test(words) };
}
