// The published lists a finding is held to, and the report's eight sections.
//
// A risk carries a level and a category, and both come from a list somebody
// else published, never from words of Inspect's own:
//
//   - the level, from the CVSS v4.0 qualitative severity rating scale
//     (FIRST): none, low, medium, high, critical;
//   - the category, from the OWASP Top 10 for LLM Applications 2025
//     (LLM01:2025 to LLM10:2025) or the OWASP Top 10 for Agentic
//     Applications (ASI01 to ASI10, OWASP GenAI Security Project, published
//     2025-12-09);
//   - a license, by its SPDX License List identifier;
//   - a dependency, by its CycloneDX bom-ref (a package URL), and a known
//     vulnerability by its OSV id.
//
// The names are the lists' own, word for word.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { LEVELS, LLM_TOP_10, AGENTIC_TOP_10, SECTIONS, categoryOf } from "./lists.mjs"

/** The CVSS v4.0 qualitative severity words, lowest first. */
export const LEVELS = ["none", "low", "medium", "high", "critical"];

/** The OWASP Top 10 for LLM Applications 2025. */
export const LLM_TOP_10 = {
  "LLM01:2025": "Prompt Injection",
  "LLM02:2025": "Sensitive Information Disclosure",
  "LLM03:2025": "Supply Chain",
  "LLM04:2025": "Data and Model Poisoning",
  "LLM05:2025": "Improper Output Handling",
  "LLM06:2025": "Excessive Agency",
  "LLM07:2025": "System Prompt Leakage",
  "LLM08:2025": "Vector and Embedding Weaknesses",
  "LLM09:2025": "Misinformation",
  "LLM10:2025": "Unbounded Consumption",
};

/** The OWASP Top 10 for Agentic Applications. */
export const AGENTIC_TOP_10 = {
  ASI01: "Agent Goal Hijack",
  ASI02: "Tool Misuse",
  ASI03: "Identity & Privilege Abuse",
  ASI04: "Agentic Supply Chain Vulnerabilities",
  ASI05: "Unexpected Code Execution",
  ASI06: "Memory & Context Poisoning",
  ASI07: "Insecure Inter-Agent Communication",
  ASI08: "Cascading Failures",
  ASI09: "Human-Agent Trust Exploitation",
  ASI10: "Rogue Agents",
};

/** Each list's id as the report names it. */
export const LIST_IDS = {
  llm: "owasp-top-10-llm-2025",
  agentic: "owasp-top-10-agentic",
  spdx: "spdx-license-list",
  cyclonedx: "cyclonedx-1.5",
  osv: "osv",
};

/** A category from one of the two OWASP lists, by its id, or null when the
 *  id is on neither: {list, id, name}. */
export function categoryOf(id) {
  const key = String(id ?? "").trim().toUpperCase();
  if (LLM_TOP_10[key]) return { list: LIST_IDS.llm, id: key, name: LLM_TOP_10[key] };
  if (AGENTIC_TOP_10[key]) return { list: LIST_IDS.agentic, id: key, name: AGENTIC_TOP_10[key] };
  return null;
}

/** A level from the CVSS words, or null. OSV's and GitHub's word MODERATE is
 *  the scale's medium. */
export function levelOf(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (w === "moderate") return "medium";
  return LEVELS.includes(w) ? w : null;
}

/** The eight sections, in order, with the owner's titles. */
export const SECTIONS = [
  { number: 1, key: "at-a-glance", title: "At a glance" },
  { number: 2, key: "what-was-inspected", title: "What was inspected" },
  { number: 3, key: "what-it-does", title: "What it does" },
  { number: 4, key: "how-it-works", title: "How it works" },
  { number: 5, key: "what-it-connects-to", title: "Systems it uses" },
  { number: 6, key: "what-it-can-do-on-its-own", title: "What it can do on its own" },
  { number: 7, key: "risks", title: "Risks, and what it needs to run safely" },
  { number: 8, key: "tests-and-what-inspect-could-not-tell", title: "Tests, and what Inspect couldn't tell" },
];

/** The kinds of finding each section holds. */
export const KINDS = {
  1: ["description", "glance"],
  // 0.5.0: what a plugin or skill repository is and the plugins it holds;
  // each command, sub-agent and rule it adds; each MCP server it brings.
  2: ["repository", "commit", "publisher", "license", "built-on", "activity", "subject", "plugins"],
  3: ["job", "skill", "part", "code", "input", "output", "slash-command", "sub-agent", "rule", "not-judged"],
  4: ["model", "how-it-runs", "memory", "human-step", "not-judged"],
  5: ["system", "credential", "mcp-server", "spend", "not-judged"],
  6: ["tool", "autonomy", "not-judged"],
  7: ["risk", "least-access", "approval", "not-judged"],
  8: ["test", "test-gap", "could-not-tell", "question", "not-judged"],
};

/** The sections whose findings another agent reads, and so must be precise. */
export const PRECISE = new Set([3, 4, 5]);

/** How many steps a job takes, as its status lines count them (0.4.3). */
export const STEPS = 5;
/** A status line, in the words the report's view draws: "Step 3 of 5:
 *  Judging what it does and the systems it uses." Plain words only: no
 *  section numbers, no digests, no internal words (0.4.3). */
export const stepLine = (n, words) => `Step ${n} of ${STEPS}: ${words}.`;
