// Reading GitHub, anonymously and only reading.
//
// The repo family reads a commit the same way (packages/repo/repo-architect,
// scripts/github.mjs): the repository's own record, and ONE call for the
// archive at the commit, GET /repos/{owner}/{name}/tarball/{ref}, whose answer
// is a redirect to GitHub's download host that fetch follows. It reads as the
// platform's GitHub App; Inspect reads only public repositories and carries no
// key, so it reads anonymously, with GitHub's small hourly allowance for that,
// and says so in words when the allowance runs out.
//
// Every call is a GET, counted and recorded (the endpoint and GitHub's answer,
// never anything else), at most CALLS a job. GitHub's address is GITHUB_API,
// read on every run and written nowhere here.
//
//   needs: node >= 22; GITHUB_API
//   import { githubReader, GitHubFailed, CALLS, ARCHIVE_BYTES } from "./github.mjs"

/** The most calls to GitHub in one job. */
export const CALLS = 6;
/** The largest archive read, in bytes: 50 MB. */
export const ARCHIVE_BYTES = 50 * 1024 * 1024;
/** One call's longest wait, and the archive's. */
export const CALL_MS = 20_000;
export const ARCHIVE_MS = 240_000;

/** A failure that ends the job before any report: `said` is the reply. */
export class GitHubFailed extends Error {
  constructor(said, { kind = "failed", status = null } = {}) { super(said); this.name = "GitHubFailed"; this.said = said; this.kind = kind; this.status = status; }
}

const trim = (s) => String(s ?? "").trim();
const mb = (n) => `${(n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1)} MB`;

/** GitHub's API address, as the install placed it, or a failure in words. */
export function apiOf(env = process.env) {
  const api = trim(env?.GITHUB_API).replace(/\/+$/, "");
  let u = null;
  try { u = api ? new URL(api) : null; } catch { u = null; }
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) throw new GitHubFailed("Inspect cannot read GitHub: the address of GitHub's API (GITHUB_API) is not set here, so nothing was inspected.", { kind: "setting" });
  return api;
}

/**
 * The reader for one repository: { repository(), commit(), recentCommits(since),
 * archive(sha), calls }. Each method makes one counted GET.
 */
export function githubReader({ owner, name, env = process.env, fetchImpl = fetch, cap = CALLS, maxBytes = ARCHIVE_BYTES } = {}) {
  const api = apiOf(env);
  const calls = [];
  const headers = { accept: "application/vnd.github+json", "user-agent": "AgentMesh inspect", "x-github-api-version": "2022-11-28" };

  async function get(path, label, { timeout = CALL_MS } = {}) {
    if (calls.length >= cap) throw new GitHubFailed(`Inspect makes at most ${cap} calls to GitHub in one job, and ${label} would be one more, so nothing was inspected.`, { kind: "cap" });
    const entry = { call: `GET ${path.split("?")[0]}`, status: 0 };
    calls.push(entry);
    const res = await fetchImpl(`${api}${path}`, { method: "GET", redirect: "follow", headers, signal: AbortSignal.timeout(timeout) }).catch((e) => ({ failed: trim(e?.message) || "no answer" }));
    if (res.failed) { entry.status = "no answer"; throw new GitHubFailed(`GitHub did not answer ${label} (${entry.call}): ${res.failed}. Nothing was inspected; try again later.`, { kind: "no-answer" }); }
    entry.status = res.status;
    const remaining = Number(res.headers?.get?.("x-ratelimit-remaining"));
    if (Number.isFinite(remaining)) entry.remaining = remaining;
    if ((res.status === 403 || res.status === 429) && (remaining === 0 || res.status === 429)) {
      throw new GitHubFailed(`GitHub's allowance for anonymous reads from here has run out (it answered ${res.status} to ${entry.call}). Nothing was inspected; try again after the hour turns.`, { kind: "allowance", status: res.status });
    }
    return { res, entry };
  }

  async function json(path, label) {
    const { res, entry } = await get(path, label);
    if (res.status >= 400) return { status: res.status, data: null, entry };
    const data = await res.json().catch(() => null);
    return { status: res.status, data, entry };
  }

  const failed = (label, entry) => new GitHubFailed(`GitHub answered ${entry.status} to ${label} (${entry.call}), so nothing was inspected; try again later.`, { kind: "status", status: entry.status });

  return {
    calls,
    /** The repository's record; refuses when there is no public repository. */
    async repository() {
      const r = await json(`/repos/${owner}/${name}`, "the repository's record");
      if (r.status === 404) throw new GitHubFailed(`There is no public repository at ${owner}/${name} on GitHub, so nothing was inspected.`, { kind: "no-repository", status: 404 });
      if (r.status >= 400 || !r.data) throw failed("the repository's record", r.entry);
      if (r.data.private === true) throw new GitHubFailed(`There is no public repository at ${owner}/${name} on GitHub, so nothing was inspected.`, { kind: "no-repository" });
      return r.data;
    },
    /** The commit's record; refuses when the digest is not a commit of the repository. */
    async commit(digest) {
      const r = await json(`/repos/${owner}/${name}/commits/${digest}`, "the commit's record");
      if (r.status === 404 || r.status === 422) throw new GitHubFailed(`${digest} is not a commit of ${owner}/${name}, so nothing was inspected.`, { kind: "no-commit", status: r.status });
      if (r.status >= 400 || !r.data) throw failed("the commit's record", r.entry);
      return r.data;
    },
    /** The commits since a moment, up to 100: {count, more}. */
    async recentCommits(since) {
      const r = await json(`/repos/${owner}/${name}/commits?since=${encodeURIComponent(since)}&per_page=100`, "the recent commits");
      if (r.status >= 400 || !Array.isArray(r.data)) return { count: null, more: false, status: r.status };
      const link = r.entry && r.data.length === 100;
      return { count: r.data.length, more: Boolean(link) };
    },
    /** The archive of the repository at the commit, as bytes, at most maxBytes. */
    async archive(sha) {
      const { res, entry } = await get(`/repos/${owner}/${name}/tarball/${sha}`, "the archive", { timeout: ARCHIVE_MS });
      if (res.status === 404) throw new GitHubFailed(`GitHub has no archive of ${owner}/${name} at ${sha} (${entry.call} answered 404), so nothing was inspected.`, { kind: "status", status: 404 });
      if (res.status >= 400) throw failed("the archive", entry);
      const len = Number(res.headers?.get?.("content-length"));
      if (Number.isFinite(len) && len > maxBytes) throw new GitHubFailed(`The archive of ${owner}/${name} at ${sha.slice(0, 12)} is ${mb(len)}, over the limit of ${mb(maxBytes)} Inspect reads, so nothing was inspected.`, { kind: "too-large" });
      const chunks = []; let got = 0;
      if (res.body && typeof res.body[Symbol.asyncIterator] === "function") {
        for await (const c of res.body) {
          got += c.length;
          if (got > maxBytes) throw new GitHubFailed(`The archive of ${owner}/${name} at ${sha.slice(0, 12)} is over the limit of ${mb(maxBytes)} Inspect reads, so nothing was inspected.`, { kind: "too-large" });
          chunks.push(Buffer.from(c));
        }
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxBytes) throw new GitHubFailed(`The archive of ${owner}/${name} at ${sha.slice(0, 12)} is ${mb(buf.length)}, over the limit of ${mb(maxBytes)} Inspect reads, so nothing was inspected.`, { kind: "too-large" });
        chunks.push(buf);
      }
      entry.bytes = got || chunks.reduce((n, c) => n + c.length, 0);
      return Buffer.concat(chunks);
    },
  };
}
