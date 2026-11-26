// The judgments: what only a model can say about the facts, at three named
// points, each answer a list of findings that cite facts by id.
//
//   call 1  sections 3, 4 and 5: each job in plain words, what you give it and
//           what it hands back, whether you can change its models, how it
//           runs, what it remembers, where a person must step in, each system
//           it reaches with its access and credentials, what it spends
//   call 2  sections 6, 7 and 8: the tools it gives its model and which run
//           without a person's OK; the risks, each with a level and a
//           category; the least access it needs and what to put behind an
//           approval; what its tests miss, what could not be settled without
//           running it, and questions for the publisher
//   call 3  section 1, last: the few findings that matter most
//
// Each call has its own output budget (BUDGETS), and each prompt must fit
// what one call can take (CALL_TOKENS). The first two calls read every fact
// when they fit; when they do not, each reads the kinds of fact its sections
// rest on, so the facts go to the model in parts. A call whose part still
// does not fit is not made, and the report says which judgments were not
// asked for and why, never cutting the facts it was given. An answer cut at
// its budget is a failure (the shared caller says so), never read as whole.
//
//   needs: node >= 22; the model's four settings, through the shared caller
//   import { judge, CALL_TOKENS, BUDGETS, estimateTokens } from "./judge.mjs"
import { callModel, readJson } from "./model-caller.mjs";
import { factLine } from "./collect.mjs";
import { KINDS, LEVELS, LLM_TOP_10, AGENTIC_TOP_10 } from "./lists.mjs";

/** The most one call's prompt may take, in tokens, so it fits the model's window with room for the answer. */
export const CALL_TOKENS = 160_000;
/** Each call's output budget. */
export const BUDGETS = { first: 16_000, second: 24_000, glance: 6_000 };

/** A cautious count of the tokens a text takes: a token for every three characters. */
export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 3);

/** The kinds of fact each of the first two calls reads when all of them do not fit. */
export const KINDS_FOR = {
  first: ["skill", "part", "entry", "how-it-runs", "model", "model-client", "memory", "human-step", "setting", "sdk", "address", "handed-address", "framework", "language", "tool", "publisher"],
  second: ["tool", "capability", "human-step", "command", "address", "handed-address", "setting", "sdk", "credential-shape", "install-script", "link", "refused-path", "vulnerability", "test-file", "test-command", "memory", "license", "repository-license", "model", "skill"],
};

/** How a title and its words are written (0.2.6): for a manager, never with
 *  code in them. checks.mjs notPlain holds back a judgment that breaks it. */
export const PLAIN_RULE = "Write every title and every sentence for a manager, in plain words. Never put in them a file or folder name, a path or a line number; a setting, variable or function name as the code writes it (anything with an underscore, a dot between words or brackets); a command line or a command-line tool's name; a package name with a version tag such as @latest; an advisory id (GHSA or CVE); backquotes; or the word facts (say the code shows, or the code does not show). Name each thing as a person would: the Slack connection, the Gemini key, its list of tools that need an OK. Files, lines and names as the code writes them belong only in based_on.";

const SYSTEM = [
  "You are Inspect. You read the facts scripts found in an outside agent's code at one commit, and write judgments about what the agent does and how safe it is, for the person in charge of a department's agents.",
  "Every judgment is a finding that cites, in based_on, the ids of the facts it rests on. A finding that cites no fact, or a fact not in the list, is thrown away. Never invent a file, a line or a fact.",
  "Say in plain words what the code shows. In sections 3, 4 and 5 say only what it shows: no guesses, and no word that judges the code (wrong, should, bug) or infers beyond it (probably, likely, seems).",
  PLAIN_RULE,
  "Give no verdict on whether to bring the agent in, and say nothing about how it fits anyone's plan or which catalog role it matches.",
  "Answer with JSON only.",
].join(" ");

const SHAPE = '{"findings": [{"section": <number>, "kind": "<kind>", "title": "<a few words>", "says": "<one to three plain sentences>", "based_on": ["F0001"], "level": "<risks only>", "categories": ["<risks only: list ids>"], "detail": {<fields of the kind>}}]}';

/** The prompt of the first call. */
export function firstPrompt(factText, { repo }) {
  return [
    `The agent: ${repo}. The facts, one to a line (id, kind, file:line or the call it came from, the line's text, then data):`,
    factText,
    "",
    "Write the findings of these sections. The scripts already list each skill and part, each model name, each credential and section 2; do not repeat a fact on its own, judge across them.",
    `Section 3 "What it does": kind job (each job a caller can give it, in plain words; detail {name, does}), kind input (what you give it; detail {name, kind}), kind output (what it hands back; detail {name, kind}).`,
    `Section 4 "How it works": kind model (which models it calls and whether you can change them without changing the code; detail {models: [..], changeable: "yes" | "no" | "partly", how}), kind how-it-runs (how it runs: a server, a command, a container, a hosted graph), kind memory (what it remembers between jobs and where), kind human-step (each step where a person must step in; detail {where, what}). Say when the code shows no memory or no human step, citing what you looked at.`,
    `Section 5 "What it connects to": kind system (each system it reaches; detail {system, product, access: "read" | "write" | "read-write" | "unknown", credentials: ["ENV_NAME"]}), kind spend (what it spends per run: model calls, paid services; detail {what, per}).`,
    "",
    "Write at most 40 findings in all, the most telling first, each in at most three sentences.",
    `Answer: ${SHAPE}`,
  ].join("\n");
}

/** The prompt of the second call. */
export function secondPrompt(factText, { repo }) {
  return [
    `The agent: ${repo}. The facts, one to a line (id, kind, file:line or the call it came from, the line's text, then data):`,
    factText,
    "",
    "Write the findings of these sections, with the security reviewer's words: what it may reach, what it may spend, and what it must never do.",
    `Section 6 "What it can do on its own": kind tool (each tool it gives its model; detail {name, does: "shell" | "file-write" | "browser" | "send-message" | "network" | "other", needs_ok: "yes" | "no" | "unknown"}), kind autonomy (which tools run without a person's OK).`,
    `Section 7 "Risks, and what it needs to run safely": kind risk, for where outside content can reach an action (the prompt-injection path), where data leaves, scripts that run at install, committed secrets, known vulnerabilities in dependencies that have no level yet, and license obligations. Every risk has "level", one of ${LEVELS.join(", ")} (the CVSS v4.0 qualitative words), and "categories", one or more of: ${Object.keys(LLM_TOP_10).map((k) => `${k} ${LLM_TOP_10[k]}`).join("; ")}; ${Object.keys(AGENTIC_TOP_10).map((k) => `${k} ${AGENTIC_TOP_10[k]}`).join("; ")}; or, for a license obligation, the license's SPDX identifier, or for a dependency, its package URL or OSV id. Then kind least-access (the least access it needs to run), kind approval (what to put behind a person's approval).`,
    `Section 8 "Tests, and what Inspect couldn't tell": kind test (what its tests cover), kind test-gap (what they miss), kind could-not-tell (what could not be settled without running it), kind question (a question for the publisher).`,
    "",
    "Write at most 50 findings in all, the most serious first, each in at most three sentences.",
    `Answer: ${SHAPE}`,
  ].join("\n");
}

/** The prompt of the last call: section 1 from the findings delivered. */
export function glancePrompt(findings) {
  const lines = findings.map((f) => `${f.id} [section ${f.section}, ${f.kind}${f.level ? `, ${f.level}` : ""}] ${f.title}: ${f.says}`);
  return [
    "These are the checked findings of an inspection report, one to a line:",
    ...lines,
    "",
    'Section 1 "At a glance" holds the few findings that matter most to the person deciding whether to bring the agent in, most important first, at most 5. For each, name the finding it repeats and say it again in one plain sentence. Give no verdict.',
    PLAIN_RULE,
    'Answer: {"glance": [{"repeats": "S7-001", "says": "<one sentence>"}]}',
  ].join("\n");
}

/**
 * Make the calls the budget allows: {first, second, glance, usage, not_made}.
 * Each answer is {drafts} or {failed: why}. `ask(prompt, options)` answers
 * {text, tokens_in, tokens_out}; by default the shared model caller.
 */
export async function judge({ facts, repo, ask = (prompt, o) => callModel(prompt, o), onStatus = () => {}, onCall = async () => {} } = {}) {
  const usage = { model_calls: 0, tokens_in: 0, tokens_out: 0 };
  const notMade = [];
  const all = facts.map(factLine).join("\n");
  const fits = (prompt) => estimateTokens(prompt) + estimateTokens(SYSTEM) <= CALL_TOKENS;
  const promptFor = (which, make) => {
    const whole = make(all, { repo });
    return fits(whole) ? whole : make(facts.filter((f) => KINDS_FOR[which].includes(f.kind)).map(factLine).join("\n"), { repo });
  };
  async function one(which, prompt, budget, sections) {
    const est = estimateTokens(prompt) + estimateTokens(SYSTEM);
    if (est > CALL_TOKENS) {
      const why = `the facts it rests on come to about ${est.toLocaleString("en-US")} tokens, more than the ${CALL_TOKENS.toLocaleString("en-US")} one call can take`;
      notMade.push({ which, sections, why });
      return { failed: why, not_made: true };
    }
    try {
      const a = await ask(prompt, { system: SYSTEM, maxOutputTokens: budget, json: true });
      usage.model_calls += 1;
      usage.tokens_in += Number(a?.tokens_in) || 0;
      usage.tokens_out += Number(a?.tokens_out) || 0;
      const doc = readJson(String(a?.text ?? ""));
      if (!doc || typeof doc !== "object") return { failed: "the model's answer was not the JSON asked for" };
      return { doc };
    } catch (e) {
      usage.model_calls += 1;
      return { failed: e?.modelFailure ? String(e.message) : `the model could not be reached (${String(e?.message ?? e)})` };
    }
  }
  const draftsOf = (r) => (Array.isArray(r?.doc?.findings) ? r.doc.findings : []);
  const answerOf = (r) => (r.failed ? { failed: r.failed } : { drafts: draftsOf(r) });
  // Each call's answer is handed on the moment it lands (onCall), so its
  // findings are checked and posted while the next call is still running.
  onStatus("Asking the model for the judgments of sections 3, 4 and 5: what it does, how it works and what it connects to.");
  const first = answerOf(await one("first", promptFor("first", firstPrompt), BUDGETS.first, [3, 4, 5]));
  await onCall("first", first);
  onStatus("Asking the model for the judgments of sections 6, 7 and 8: what it can do on its own, its risks, and its tests.");
  const second = answerOf(await one("second", promptFor("second", secondPrompt), BUDGETS.second, [6, 7, 8]));
  await onCall("second", second);
  const out = {
    first, second,
    usage, not_made: notMade,
    /** The last call, made once the findings it reads are checked. */
    async glance(findings) {
      onStatus("Writing section 1, at a glance, from the checked findings.");
      const r = await one("glance", glancePrompt(findings), BUDGETS.glance, [1]);
      return r.failed ? { failed: r.failed } : { drafts: Array.isArray(r.doc?.glance) ? r.doc.glance : [] };
    },
  };
  return out;
}

/** The kinds the model may write in each section. */
export const MODEL_KINDS = { 3: ["job", "input", "output"], 4: ["model", "how-it-runs", "memory", "human-step"], 5: ["system", "spend"], 6: ["tool", "autonomy"], 7: ["risk", "least-access", "approval"], 8: ["test", "test-gap", "could-not-tell", "question"] };
for (const [s, ks] of Object.entries(MODEL_KINDS)) for (const k of ks) if (!KINDS[s].includes(k)) throw new Error(`the kind ${k} is not one of section ${s}'s`);
