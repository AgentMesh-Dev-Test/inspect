// How well an agent, plugin or skills follow AgentMesh's portability guidance
// for builders (0.7.0), from the repository's own files and the facts already
// gathered, by rule and never by the model:
// https://agentmesh.ai/draft/articles/portability-guidance-for-builders.html
//
// Each item is followed, missing or unknown, from code evidence only. Unknown
// says unknown: a thing the files cannot show (whether a release tag exists
// when GitHub did not say, whether an outside service can be turned off when
// no setting shows it) is never guessed. An item that does not apply to this
// subject (tool servers when it has none, lock files when it has no
// manifest) is left out of the count.
//
//   import { guidanceOf, GUIDANCE_URL } from "./guidance.mjs"
//   guidanceOf({ all, root, read, facts, portability, tags }) ->
//     { url, basics: [{id, title, state, says}], extras: [...], followed, of }

import { posix } from "node:path";

export const GUIDANCE_URL = "https://agentmesh.ai/draft/articles/portability-guidance-for-builders.html";

const trim = (s) => String(s ?? "").trim();
const base = (f) => posix.basename(f);
const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** A folder kept for a coding assistant working on the repository, not the agent's own. */
const ASSISTANT_DIR = /(^|\/)\.(claude|cursor|codex|agents|github|opencode|gemini|windsurf)\//;
const VENDORED = /(^|\/)(node_modules|vendor|third_party|dist|build|\.venv|venv|site-packages)\//;

/** A runner that fetches a package when a server starts, and how its version is named. */
const FETCHERS = new Set(["npx", "uvx", "bunx", "pipx", "pnpx"]);
/** Whether an npm or Python package name names an exact version. */
export function pinned(spec) {
  const s = trim(spec);
  if (!s) return false;
  const npm = /^(@[^/@\s]+\/)?[^@\s]+@(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(s);
  if (npm) return true;
  return /^[A-Za-z0-9_.-]+(\[[^\]]*\])?==\d[\w.!+-]*$/.test(s);
}

/** Each server of an .mcp.json or mcp.json text: {name, remote, pinned, local}. */
export function mcpServers(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const servers = j?.mcpServers ?? j?.servers ?? j?.mcp_servers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, s]) => {
    const cmd = trim(s?.command);
    const args = Array.isArray(s?.args) ? s.args.map(String) : [];
    if (trim(s?.url) || /^(http|sse|streamable-http)$/i.test(trim(s?.type)) && trim(s?.url)) return { name, remote: true, pinned: true, local: false };
    if (FETCHERS.has(base(cmd)) || (base(cmd) === "pnpm" && args[0] === "dlx")) {
      const spec = args.filter((a) => !a.startsWith("-") && a !== "dlx")[0] ?? "";
      return { name, remote: false, pinned: pinned(spec), local: false };
    }
    // A program the repository ships (node ./server.js, python -m its own module, a path).
    return { name, remote: false, pinned: true, local: true };
  });
}

/** Lock files, by the manifest they lock. */
const LOCKS = {
  "package.json": ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"],
  "pyproject.toml": ["uv.lock", "poetry.lock", "pdm.lock", "Pipfile.lock", "requirements.lock"],
  Pipfile: ["Pipfile.lock"],
  "Cargo.toml": ["Cargo.lock"],
  "go.mod": ["go.sum"],
};
/** A requirements file whose every requirement names an exact version (==), or a hash. */
function requirementsPinned(text) {
  const reqs = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter((l) => l && !l.startsWith("-"));
  return reqs.length > 0 && reqs.every((l) => /==|--hash=/.test(l) || /^\S+ @ /.test(l));
}

/**
 * The reading. `all` is every file of the repository; `root` the folder of
 * the plugin inspected ("" for the repository); `facts` the facts gathered;
 * `portability` the reading of platforms.mjs; `tags` GitHub's answer on the
 * repository's tags: {count} or null when it was not asked or did not answer.
 */
export function guidanceOf({ all, root = "", read, facts = [], portability = null, tags = null }) {
  const R = root ? `${root.replace(/\/$/, "")}/` : "";
  const mine = all.filter((f) => f.startsWith(R) && !VENDORED.test(f));
  const rel = (f) => f.slice(R.length);
  const has = (name) => mine.some((f) => rel(f) === name) || (R && all.includes(name));
  const hasCI = (re) => mine.some((f) => !rel(f).includes("/") && re.test(base(f))) || (R && all.some((f) => !f.includes("/") && re.test(f)));
  const factsOf = (kind) => facts.filter((f) => f.kind === kind);
  const uses = portability?.uses ?? [];
  const used = (cat) => uses.some((u) => u.category === cat);
  const basics = [];
  const extras = [];
  const item = (list, id, title, state, says) => list.push({ id, title, state, says });

  // 1. plugin.json at the root, Agent Plugins 1.0.0, with a description and keywords.
  {
    const own = mine.find((f) => rel(f) === "plugin.json");
    const toolOnly = mine.filter((f) => /^\.(claude|cursor|codex)-plugin\/plugin\.json$/.test(rel(f))).map((f) => ({ claude: "Claude Code", cursor: "Cursor", codex: "Codex" })[/^\.(\w+)-plugin/.exec(rel(f))[1]]);
    if (!own) item(basics, "plugin", "plugin.json at the root", "missing", toolOnly.length ? `Only ${and(toolOnly)}'s own manifest` : "No plugin.json");
    else {
      let j = null;
      try { j = JSON.parse(read(own) ?? ""); } catch { j = null; }
      const lacks = [!trim(j?.description) ? "a description" : null, !(Array.isArray(j?.keywords) && j.keywords.length) ? "keywords" : null].filter(Boolean);
      item(basics, "plugin", "plugin.json at the root", lacks.length ? "missing" : "followed", lacks.length ? `It has no ${and(lacks)}` : "With a description and keywords");
    }
  }

  // 2. Each skill in skills/<name>/SKILL.md with front matter.
  {
    const skills = mine.filter((f) => base(f) === "SKILL.md" && !ASSISTANT_DIR.test(rel(f)));
    if (!skills.length) item(basics, "skills", "Skills in skills/<name>/SKILL.md", "missing", "No skills");
    else {
      const placed = skills.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(rel(f)));
      const fronted = skills.filter((f) => { const t = read(f) ?? ""; const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t); return m && /^name\s*:/m.test(m[1]) && /^description\s*:/m.test(m[1]); });
      const off = skills.length - placed.length;
      const bare = skills.length - fronted.length;
      if (!off && !bare) item(basics, "skills", "Skills in skills/<name>/SKILL.md", "followed", skills.length === 1 ? "Its skill is" : "Every skill is");
      else item(basics, "skills", "Skills in skills/<name>/SKILL.md", "missing", off ? (off === skills.length ? "Its skills sit outside skills/" : "Some skills sit outside skills/") : "Some skills lack a name or description");
    }
  }

  // 3. Tool servers in .mcp.json, each remote or pinned.
  {
    const file = mine.find((f) => rel(f) === ".mcp.json") ?? mine.find((f) => rel(f) === "mcp.json");
    const codeUsesMcp = used("tool-connections") || factsOf("mcp-server").length > 0;
    if (!file) {
      if (codeUsesMcp) item(basics, "mcp", "Tool servers in .mcp.json, remote or pinned", "missing", "It reaches tool servers with no .mcp.json");
      else item(basics, "mcp", "Tool servers in .mcp.json, remote or pinned", "not-applicable", "No tool servers");
    } else {
      const servers = mcpServers(read(file) ?? "");
      if (servers === null) item(basics, "mcp", "Tool servers in .mcp.json, remote or pinned", "unknown", "Its .mcp.json could not be read");
      else if (!servers.length) item(basics, "mcp", "Tool servers in .mcp.json, remote or pinned", "not-applicable", "No tool servers");
      else {
        const loose = servers.filter((s) => !s.pinned).map((s) => s.name);
        item(basics, "mcp", "Tool servers in .mcp.json, remote or pinned", loose.length ? "missing" : "followed", loose.length ? `${and(loose)} ${loose.length === 1 ? "is" : "are"} fetched at start without a fixed version` : servers.length === 1 ? "Its server is" : "Every server is");
      }
    }
  }

  // 4. LICENSE, README.md and AGENTS.md.
  {
    const want = [["LICENSE", /^(LICEN[CS]E|COPYING)(\.[A-Za-z]+)?$/i], ["README.md", /^README(\.md|\.markdown)?$/i], ["AGENTS.md", /^AGENTS\.md$/]];
    const lacking = want.filter(([, re]) => !hasCI(re)).map(([n]) => n);
    item(basics, "files", "LICENSE, README.md and AGENTS.md", lacking.length ? "missing" : "followed", lacking.length ? `No ${and(lacking)}` : "All three");
  }

  // 5. No keys committed (at this commit; the history is not read).
  {
    const keys = factsOf("credential-shape").filter((f) => !f.data?.in_test);
    item(basics, "secrets", "No keys in the code", keys.length ? "missing" : "followed", keys.length ? (keys.length === 1 ? "A key is committed" : "Keys are committed") : "None found");
  }

  // 6. Lock files committed for each manifest.
  {
    const manifests = mine.filter((f) => Object.hasOwn(LOCKS, base(f)) || base(f) === "requirements.txt");
    if (!manifests.length) item(basics, "locks", "Lock files committed", "not-applicable", "No dependencies to lock");
    else {
      const loose = manifests.filter((m) => {
        const dir = posix.dirname(m);
        const at = (n) => all.includes(dir === "." ? n : `${dir}/${n}`) || (R && all.includes(n));
        if (base(m) === "requirements.txt") return !requirementsPinned(read(m)) && !LOCKS["pyproject.toml"].some(at);
        if (base(m) === "package.json") {
          let j = null;
          try { j = JSON.parse(read(m) ?? ""); } catch { j = null; }
          const deps = Object.keys({ ...(j?.dependencies ?? {}), ...(j?.optionalDependencies ?? {}) });
          if (!deps.length) return false;
          // A workspace's lock file sits at the repository's root.
          return !LOCKS["package.json"].some(at) && !LOCKS["package.json"].some((n) => all.includes(n));
        }
        return !LOCKS[base(m)].some(at) && !LOCKS[base(m)].some((n) => all.includes(n));
      });
      item(basics, "locks", "Lock files committed", loose.length ? "missing" : "followed", loose.length ? (loose.length === manifests.length ? "No lock file" : "Some dependencies have no lock file") : "For every manifest");
    }
  }

  // 7. A tagged release.
  if (tags && Number.isFinite(tags.count)) item(basics, "release", "A tagged release", tags.count > 0 ? "followed" : "missing", tags.count > 0 ? "Tagged" : "No release tags");
  else item(basics, "release", "A tagged release", "unknown", "GitHub did not say");

  // 8. Samples, and tests that run without live keys.
  {
    const samples = mine.some((f) => /^(samples|examples)\//.test(rel(f)));
    const tests = factsOf("test-file").filter((f) => f.file.startsWith(R));
    const offline = tests.filter((t) => !t.data?.live);
    const lacks = [!samples ? "no samples folder" : null, !tests.length ? "no tests" : tests.length && !offline.length ? "its tests need live keys" : null].filter(Boolean);
    const words = lacks.length ? lacks.join(" and ") : "";
    item(basics, "samples", "Samples and tests that run offline", lacks.length ? "missing" : "followed", lacks.length ? words.charAt(0).toUpperCase() + words.slice(1) : "Both");
  }

  // 9. Vendor extras can be turned off: each outside service the reading
  // found, by a setting alone. A service its code calls is not shown either
  // way, so that is unknown.
  {
    const outside = uses.filter((r) => r.outside);
    if (!outside.length) item(basics, "extras", "Vendor extras can be turned off", "not-applicable", "No vendor extras");
    else {
      const unclear = outside.filter((r) => r.swap !== "settings" && r.swap !== "in-process").map((r) => r.title.toLowerCase());
      item(basics, "extras", "Vendor extras can be turned off", unclear.length ? "unknown" : "followed", unclear.length ? `Not clear from the code for ${and(unclear)}` : outside.length === 1 ? "It is a setting" : "Each is a setting");
    }
  }

  // Only where the agent does it.
  const a2a = used("agent-to-agent") || (portability?.uses ?? []).some((u) => u.sources?.some((s) => s.standard === "A2A"));
  if (a2a) {
    const card = mine.some((f) => /(^|\/)\.well-known\/agent(-card)?\.json$/.test(rel(f)) || base(f) === "agent-card.json");
    const inCode = !card && mine.some((f) => /\.(py|ts|js|mjs)$/.test(f) && /\bAgentCard\s*\(/.test(read(f) ?? ""));
    item(extras, "a2a", "An agent card for its callers", card || inCode ? "followed" : "missing", card ? "Published" : inCode ? "Built in its code" : "No agent card");
  }
  if (mine.some((f) => /^knowledge\//.test(rel(f)))) {
    const lacking = ["index.md", "log.md"].filter((n) => !has(`knowledge/${n}`));
    item(extras, "knowledge", "Knowledge in OKF", lacking.length ? "missing" : "followed", lacking.length ? `No ${and(lacking.map((n) => `knowledge/${n}`))}` : "With index.md and log.md");
  }
  if (used("sandboxes")) item(extras, "sandbox", "Generated code runs in a sandbox", "followed", "Through a sandbox");
  if (mine.some((f) => rel(f) === "schedules.json")) item(extras, "schedules", "Scheduled jobs declared", "followed", "In schedules.json");

  const counted = basics.filter((b) => b.state !== "not-applicable");
  return { url: GUIDANCE_URL, basics, extras, followed: counted.filter((b) => b.state === "followed").length, of: counted.length };
}
