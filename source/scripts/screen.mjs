// AgentMesh's screening, before the model reads anything (0.4.6).
//
// Everything Inspect gives its model comes from the repository, and a
// repository is written by whoever wants it judged: a line in it can be
// written to tell the model the agent is safe. So every fact line a call
// would read goes first to the platform's own screening door (POST
// /v1/screen-text: the house screening, Google Model Armor, the EXT-10
// screening socket), reached with this job's own credential, and only the
// lines that pass reach the model.
//
// It fails closed, because Inspect's output is a judgment: no credential, a
// door that cannot be reached, any answer but a whole list of verdicts, or a
// part the screener itself could not reach means no judgment at all, and the
// report says so. Never a judgment made on text that was not screened.
//
// The wire is the one ride-maker's screen-the-signs uses
// (AgentMesh packages/makers/ride-maker/scripts/broker.mjs): one request
// signed by the job's worker key over
// mesh-screen-job-v1:<ts>:<worker>:<sha256 hex of the texts as JSON>. That
// client is not carried byte for byte, because it answers verdict words only
// and drops `unscreened`, which is what tells a passage the screener held from
// a passage the screener never reached, and Inspect must not call the second
// kind an attack.
//
//   needs: node >= 22; MESH_JOB_JWT, MESH_JOB_NKEY_SEED and MESH_API_BASE,
//   which the platform gives every job it runs in a container
//   import { screenLines, DOOR } from "./screen.mjs"
import { createHash, createPrivateKey, sign } from "node:crypto";

/** The door's own limits (AgentMesh services/src/api/job-screen.ts). */
export const DOOR = { texts: 400, text_chars: 2000, total_chars: 60_000 };

/** How a line's verdict ranks: the worst of its parts is the line's. */
const RANK = { pass: 0, flag: 1, hold: 2 };

/** The platform's API root from MESH_API_BASE, the platform origin with no
 *  path as the deployment manager sets it; a value already ending in /v1 is
 *  read as it stands. Unset is null: a job that does not know its platform
 *  has no screening, and is never pointed at another platform's. */
export function apiRootOf(base) {
  const b = String(base ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/.test(b)) return null;
  return /\/v1$/.test(b) ? b : `${b}/v1`;
}

/** The job's credential, or the words for why there is none. */
export function credentialOf(env = process.env) {
  const jwt = String(env.MESH_JOB_JWT ?? "").trim();
  const seed = String(env.MESH_JOB_NKEY_SEED ?? "").trim();
  const api = apiRootOf(env.MESH_API_BASE);
  if (!jwt || !seed) return { missing: "this job was given no credential for AgentMesh's screening" };
  if (!api) return { missing: "this job was not told the platform's address, so AgentMesh's screening could not be asked" };
  let worker = null;
  try { worker = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"))?.sub ?? null; } catch { worker = null; }
  if (typeof worker !== "string" || !worker) return { missing: "this job's credential for AgentMesh's screening is not one it can use" };
  return { jwt, seed, api, worker };
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("the job's key is not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The worker key's ed25519 signature over `text`, base64: the seed's two
 *  prefix bytes, then the 32 bytes of the key. */
export function signWithSeed(seed, text) {
  const raw = base32(seed).subarray(2, 34);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw]), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(text, "utf8"), key).toString("base64");
}

export const textsDigest = (texts) => createHash("sha256").update(JSON.stringify(texts), "utf8").digest("hex");
export const screenCanonical = ({ ts, worker, texts }) => `mesh-screen-job-v1:${ts}:${worker}:${textsDigest(texts)}`;

/** Each line cut into parts the door takes, in order: [{line, text}]. */
export function partsOf(lines) {
  const out = [];
  lines.forEach((l, line) => {
    const s = String(l ?? "");
    for (let at = 0; at < Math.max(1, s.length); at += DOOR.text_chars) out.push({ line, text: s.slice(at, at + DOOR.text_chars) });
  });
  return out;
}

/** The parts packed in order into requests within the door's limits. */
export function requestsOf(parts) {
  const out = [];
  let cur = [], size = 0;
  for (const p of parts) {
    if (cur.length && (cur.length >= DOOR.texts || size + p.text.length > DOOR.total_chars)) { out.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

const NOTHING_READ = "so the model was given nothing to read";

/** Why one answer of the door is no answer, in the report's words; null when it is a whole answer. */
function refusalOf(status, data, want) {
  if (status === 429) return { why: `AgentMesh's screening has screened all it will for Inspect this hour, ${NOTHING_READ}; ask again in an hour`, retry: false };
  if (status === 503 && data?.code === "screening_unavailable") return { why: `AgentMesh's screening is not set up on this platform, ${NOTHING_READ}`, retry: false };
  if (status === 401 || status === 403) return { why: `AgentMesh's screening refused this job's credential (it answered ${status}), ${NOTHING_READ}`, retry: false };
  if (status !== 200) return { why: `AgentMesh's screening answered ${status}, ${NOTHING_READ}`, retry: status >= 500 };
  const results = Array.isArray(data?.results) ? data.results : null;
  if (!results || results.length !== want) return { why: `AgentMesh's screening answered ${results ? results.length : "no"} verdicts for ${want} passages, ${NOTHING_READ}`, retry: false };
  if (results.some((r) => !r || !(r.verdict in RANK))) return { why: `AgentMesh's screening answered a verdict Inspect does not know, ${NOTHING_READ}`, retry: false };
  if (results.some((r) => r.unscreened)) return { why: `AgentMesh's screening could not check part of the code's text, ${NOTHING_READ}`, retry: true };
  return null;
}

/**
 * Screen each line. Answers {ok: true, verdicts: [{verdict, reason?}] one per
 * line, requests, texts, chars}, or {ok: false, why, requests} when any part
 * could not be screened. A request whose door could not be reached, answered
 * 5xx or could not check a part is asked once more; a refusal is not.
 */
export async function screenLines(lines, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const cred = credentialOf(env);
  if (cred.missing) return { ok: false, why: `${cred.missing}, ${NOTHING_READ}`, requests: 0 };
  const parts = partsOf(lines);
  const verdicts = lines.map(() => ({ verdict: "pass" }));
  let requests = 0;
  for (const batch of requestsOf(parts)) {
    const texts = batch.map((p) => p.text);
    let answer = null;
    for (let tries = 0; tries < 2 && !answer?.results; tries += 1) {
      const ts = Math.floor(now() / 1000);
      const body = { job_jwt: cred.jwt, texts, ts, sig: signWithSeed(cred.seed, screenCanonical({ ts, worker: cred.worker, texts })) };
      requests += 1;
      let status = 0, data = null;
      try {
        const res = await fetchImpl(`${cred.api}/screen-text`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        status = res.status;
        data = await res.json().catch(() => null);
      } catch (e) {
        answer = { why: `AgentMesh's screening could not be reached (${String(e?.message ?? e).slice(0, 120)}), ${NOTHING_READ}`, retry: true };
        continue;
      }
      const bad = refusalOf(status, data, texts.length);
      answer = bad ?? { results: data.results };
      if (bad && !bad.retry) break;
    }
    if (!answer?.results) return { ok: false, why: answer?.why ?? `AgentMesh's screening gave no answer, ${NOTHING_READ}`, requests };
    answer.results.forEach((r, i) => {
      const v = verdicts[batch[i].line];
      if (RANK[r.verdict] > RANK[v.verdict]) verdicts[batch[i].line] = { verdict: r.verdict, ...(typeof r.reason === "string" && r.reason ? { reason: r.reason.slice(0, 200) } : {}) };
    });
  }
  return { ok: true, verdicts, requests, texts: parts.length, chars: parts.reduce((n, p) => n + p.text.length, 0) };
}
