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
import { KINDS, LEVELS, LLM_TOP_10, AGENTIC_TOP_10, stepLine } from "./lists.mjs";

/** The most one call's prompt may take, in tokens, so it fits the model's window with room for the answer. */
export const CALL_TOKENS = 160_000;
/** Each call's output budget. */
export const BUDGETS = { first: 20_000, second: 24_000, glance: 6_000 };

/** A cautious count of the tokens a text takes: a token for every three characters. */
export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 3);

/** The kinds of fact each of the first two calls reads when all of them do not fit. */
export const KINDS_FOR = {
  first: ["skill", "part", "own-code", "entry", "how-it-runs", "model", "model-client", "memory", "human-step", "setting", "setup-doc", "example-setting", "sdk", "address", "handed-address", "framework", "language", "tool", "publisher"],
  second: ["tool", "capability", "human-step", "command", "address", "handed-address", "setting", "sdk", "credential-shape", "install-script", "link", "refused-path", "vulnerability", "test-file", "test-command", "memory", "license", "repository-license", "model", "skill"],
};

/** How a title and its words are written (0.2.6): for a manager, never with
 *  code in them. checks.mjs notPlain holds back a judgment that breaks it. */
export const PLAIN_RULE = "Write every title and every sentence for a manager, in plain words. Never put in them a file or folder name, a path or a line number; a setting, variable or function name as the code writes it (anything with an underscore, a dot between words or brackets); a command line or a command-line tool's name; a package name with a version tag such as @latest; an advisory id (GHSA or CVE); backquotes; or the word facts (say the code shows, or the code does not show). Name each thing as a person would: the Slack connection, the Gemini key, its list of tools that need an OK. Files, lines and names as the code writes them belong only in based_on.";

/** Each skill named and said for a person (0.3.3): a skill's own description is
 *  written for the model that runs it ("Use for… Route by…"), not for the
 *  person deciding; checks.mjs checkSkillNames keeps the plain ones. */
export const SKILL_NAMES = 'Also answer "skills": one entry for each of the agent\'s own skills (each skill fact whose data.for_coding_assistants is false), with "skill" its fact id, "title" a short plain name of three to eight words for what it makes or does for the team (such as Captions for talking-head videos), and "does" one or two plain sentences on what it does for the team. Write both for a manager: never the trigger words the skill\'s own description writes for a model (use for, invoke when, route by), and never the title again in its sentences.';

/** Each thing said once (0.3.0): checks.mjs nearSame holds back a title that repeats another. */
export const SAY_ONCE = "Within a section, never write two findings that say or ask the same thing, even in other words (which tools need approval, and which tools should wait for a person, are one finding); merge them into one. A finding's words never repeat its title: they say what the title can't.";

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
    `Section 3 "What it does": kind job (each job a caller can give it, in plain words, citing in based_on the skill facts of the skills that do it; detail {name, does}), kind input (what you give it; detail {name, kind}), kind output (what it hands back; detail {name, kind}), and one finding of kind code for the agent's own code outside its skills, from the own-code fact and the entry and how-it-runs facts: its title says in a few words what that code covers, such as "Slack app, tools and a sandbox runner".`,
    `Section 4 "How it works": kind model (which models it calls and whether you can change them without changing the code; detail {models: [..], changeable: "yes" | "no" | "partly", how}), kind how-it-runs (how it runs: a server, a command, a container, a hosted graph), kind memory (what it remembers between jobs and where), kind human-step (each step where a person must step in; detail {where, what}). Say when the code shows no memory or no human step, citing what you looked at.`,
    `Section 5 "Systems it uses": kind system, one finding for each outside system it reaches, titled with the system's name and what it is used for. Every credential setting the code reads belongs to one system's finding, which cites all of its setting facts and names them in credentials: Inspect decides need by rule from those settings wherever they settle it, so a setting left out can change the answer. detail {system, product, need: "required" | "optional" | "unclear", supply: "<what the person supplies, in their words: Your ElevenLabs key, A Slack app and its two tokens, or Nothing to set up>", without: "<what happens without it: which feature is off, or that the agent won't start>", sends: "<what goes to the system, in plain words>", access: "read" | "write" | "read-write" | "unknown", credentials: ["ENV_NAME"]}. Judge need from the facts and cite them: a setting fact's data.how is "fails" when the code stops without the setting, "guard" when it skips a feature without it, "default" when the code has a default; a setup-doc fact says what the setup docs say of it (required, optional or only mentioned); an example-setting fact says the example settings file lists it. Your need is used only where the settings, and whether only its skills reach it, don't settle it: then need is "required" only when the agent can't do its main job without the system, "optional" when only some of its features use it, and "unclear" when the code doesn't show which. Then kind spend (what it spends per run: model calls, paid services; detail {what, per}).`,
    "",
    SAY_ONCE,
    "Write at most 40 findings in all, the most telling first, each in at most three sentences.",
    SKILL_NAMES,
    `Answer: ${SHAPE.replace(/\}$/, ", \"skills\": [{\"skill\": \"F0012\", \"title\": \"<three to eight plain words>\", \"does\": \"<one or two plain sentences>\"}]}")}`,
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
    `Section 7 "Risks, and what it needs to run safely": kind risk, for where outside content can reach an action (the prompt-injection path), where data leaves, scripts that run at install, committed secrets, known vulnerabilities in dependencies that have no level yet, and license obligations. Every risk has "level", one of ${LEVELS.join(", ")} (the CVSS v4.0 qualitative words), and "categories", one or more of: ${Object.keys(LLM_TOP_10).map((k) => `${k} ${LLM_TOP_10[k]}`).join("; ")}; ${Object.keys(AGENTIC_TOP_10).map((k) => `${k} ${AGENTIC_TOP_10[k]}`).join("; ")}; or, for a license obligation, the license's SPDX identifier, or for a dependency, its package URL or OSV id. Every risk also has detail {safe: "<how to make it safe, in one or two plain sentences: the least access it needs, or what to put behind a person's OK>"}, so a risk and its fix are one finding.`,
    `Section 8 "Tests, and what Inspect couldn't tell": kind test (what its tests cover, citing the test-file facts it rests on), kind test-gap (what they miss), kind could-not-tell (what could not be settled without running it, ending with the question to ask the publisher, so a gap and its question are one finding).`,
    "",
    SAY_ONCE,
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
    'Section 1 "At a glance" opens with the description of the agent: two to four plain sentences that say what the agent is, what it does, who it is for and how it runs, from the findings of sections 3 to 5. Then it holds the few findings that matter most to the person deciding whether to bring the agent in, most important first, at most 5. For each, name the finding it repeats and say it again in one plain sentence. Give no verdict.',
    PLAIN_RULE,
    'Answer: {"description": "<two to four sentences>", "glance": [{"repeats": "S7-001", "says": "<one sentence>"}]}',
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
  const answerOf = (r) => (r.failed ? { failed: r.failed } : { drafts: draftsOf(r), ...(Array.isArray(r?.doc?.skills) ? { skills: r.doc.skills } : {}) });
  // Each call's answer is handed on the moment it lands (onCall), so its
  // findings are checked and posted while the next call is still running.
  onStatus(stepLine(3, "Judging what it does and the systems it uses"));
  const first = answerOf(await one("first", promptFor("first", firstPrompt), BUDGETS.first, [3, 4, 5]));
  await onCall("first", first);
  onStatus(stepLine(4, "Judging its risks and its tests"));
  const second = answerOf(await one("second", promptFor("second", secondPrompt), BUDGETS.second, [6, 7, 8]));
  await onCall("second", second);
  const out = {
    first, second,
    usage, not_made: notMade,
    /** The last call, made once the findings it reads are checked. */
    async glance(findings) {
      onStatus(stepLine(5, "Writing the overview"));
      const r = await one("glance", glancePrompt(findings), BUDGETS.glance, [1]);
      return r.failed ? { failed: r.failed } : { drafts: Array.isArray(r.doc?.glance) ? r.doc.glance : [], description: typeof r.doc?.description === "string" ? r.doc.description : null };
    },
  };
  return out;
}

/** The kinds the model may write in each section. */
export const MODEL_KINDS = { 3: ["job", "input", "output", "code"], 4: ["model", "how-it-runs", "memory", "human-step"], 5: ["system", "spend"], 6: ["tool", "autonomy"], 7: ["risk"], 8: ["test", "test-gap", "could-not-tell"] };
for (const [s, ks] of Object.entries(MODEL_KINDS)) for (const k of ks) if (!KINDS[s].includes(k)) throw new Error(`the kind ${k} is not one of section ${s}'s`);
