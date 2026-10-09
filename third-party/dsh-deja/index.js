// dsh-deja — the history you already have, inside DeepSeek Harness.
//
// dsh answers questions about its own sessions through the built-in
// session-query subsystem. This plugin answers the other question: what you did
// in Claude Code, Codex, Cursor, opencode and twenty-one more agents, on this
// machine, before dsh existed. The index is deja's; this file is the seam.

import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { argv, contributions, guarded } from "./lib.js";

const require = createRequire(import.meta.url);
const pExecFile = promisify(execFile);

// The tool registry lives in the host. A plugin that throws on a missing peer
// takes the whole profile down with it, so this degrades: without dsh-tools the
// command and automatic recall still work, only the model-facing tools are
// skipped.
let defineTool = null;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {}

const PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const ARCH = process.arch === "x64" ? "amd64" : process.arch;

// resolveDeja picks the binary in the order a user would expect: what they
// pointed at, then the deja they installed themselves and keep current with
// `deja update` or a package manager, and only then the copy npm brought along
// with this plugin. Each candidate is asked for its version rather than
// trusted, because a name on PATH that does not run is worse than no name.
function resolveDeja() {
  const exe = PLATFORM === "windows" ? "deja.exe" : "deja";
  const candidates = [process.env.DEJA_BIN, exe];
  try {
    candidates.push(require.resolve(`@vshulcz/deja-vu-${PLATFORM}-${ARCH}/bin/${exe}`));
  } catch {}

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ["version"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return candidate;
    } catch {}
  }
  // Nothing answered. Keep the plain name so the failure a user sees names the
  // thing that is missing.
  return exe;
}

const DEJA = resolveDeja();

const NOTHING = "Nothing in this machine's history matches that.";
const MISSING =
  "deja is not installed on this machine, so there is no history to search. " +
  "Install it with: curl -fsSL https://raw.githubusercontent.com/vshulcz/deja-vu/main/install.sh | sh";

// installed answers whether the binary picked at load actually runs. Without
// this every tool would report an empty history to a user who simply never
// installed deja, which reads as "you have no past" rather than "nothing is
// here to read it".
function checkInstalled() {
  if (!DEJA) return false;
  try {
    return execFileSync(DEJA, ["version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).length > 0;
  } catch {
    return false;
  }
}

const INSTALLED = checkInstalled();

function answer(text) {
  if (INSTALLED) return text || NOTHING;
  return MISSING;
}

// ── Circuit breaker and robust runner ───────────────────────────────────────
// Consecutive failures or timeouts trigger a 60s silence so repeated slow queries
// never freeze the Node.js event loop or block dialog interactions.
let consecutiveFailures = 0;
let circuitBreakerUntil = 0;

function isCircuitOpen() {
  return Date.now() < circuitBreakerUntil;
}

function recordSuccess() {
  consecutiveFailures = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    circuitBreakerUntil = Date.now() + 60 * 1000;
  }
}

// runAsync returns stdout asynchronously without blocking Node's event loop.
// Used for all model tools, CLI commands, and background prompt prefetching.
async function runAsync(args, input, timeout = 15000) {
  if (!INSTALLED || isCircuitOpen()) return "";
  try {
    const { stdout } = await pExecFile(DEJA, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    });
    recordSuccess();
    return (stdout || "").trim();
  } catch {
    recordFailure();
    return "";
  }
}

// runSync is used ONLY for prompt context assembly where the host requires a
// synchronous string return. Timeout is strictly bounded (300ms by default)
// rather than 20s, so the main event loop is never frozen.
function runSync(args, input, timeout = 300) {
  if (!INSTALLED || isCircuitOpen()) return "";
  try {
    const stdout = execFileSync(DEJA, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
    });
    recordSuccess();
    return (stdout || "").trim();
  } catch {
    recordFailure();
    return "";
  }
}

// Backward-compatible alias for existing synchronous call sites.
function run(args, input) {
  return runSync(args, input, 300);
}

// ── Smart filter and LRU cache for prompt recalls ───────────────────────────
function shouldBypassRecall(prompt) {
  if (!prompt || typeof prompt !== "string") return true;
  const trimmed = prompt.trim();
  if (trimmed.length < 4) return true;
  const trivialPatterns = /^(好的?|确认|继续|ok|okay|yes|no|y|n|对|是的?|明白|收到|行|可以|再来|按计划|开始吧?|赞|谢谢|thx|thanks)$/i;
  if (trivialPatterns.test(trimmed)) return true;
  return false;
}

const RECALL_CACHE_CAP = 100;
const recallCache = new Map(); // prompt -> { result, timestamp }

function setRecallCache(prompt, result) {
  if (recallCache.size >= RECALL_CACHE_CAP) {
    const oldest = recallCache.keys().next().value;
    recallCache.delete(oldest);
  }
  recallCache.set(prompt, { result, timestamp: Date.now() });
}

function getRecallCache(prompt) {
  const entry = recallCache.get(prompt);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 10 * 60 * 1000) {
    recallCache.delete(prompt);
    return null;
  }
  return entry.result;
}

const pendingPrefetches = new Map();

function prefetchPrompt(prompt, cwd = process.cwd()) {
  if (shouldBypassRecall(prompt)) return;
  if (getRecallCache(prompt) !== null) return;
  if (pendingPrefetches.has(prompt)) return;

  const p = runAsync(["hook-prompt", "--plain"], JSON.stringify({ prompt, cwd }), 6000)
    .then((res) => {
      setRecallCache(prompt, res);
      return res;
    })
    .catch(() => "")
    .finally(() => {
      pendingPrefetches.delete(prompt);
    });

  pendingPrefetches.set(prompt, p);
}

function tools(ctx) {
  if (!defineTool) return;

  // Every tool here answers with the text deja printed, so one output
  // declaration serves them all. The schema is plain JSON Schema — a
  // schemastery instance is rejected as "schema must be a value schema object",
  // because the host validates that this is an ordinary JSON record.
  const TEXT_OUTPUT = {
    schema: { type: "string" },
    render: (_args, value) => [{ type: "text", text: String(value) }],
  };

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_recall",
    description:
      "Search this machine's own past AI coding sessions — every agent used on it, including months before deja was installed. Use before debugging an error or re-implementing anything that may already exist. Match on the most specific token available: an exact error string, function name, file path or flag.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "Specific tokens to match. Several words are ANDed.",
      },
      limit: {
        type: "number",
        description: "How many sessions to return. Default 5.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      // deja itself caps the window; asking for a hundred sessions would
      // spend the model's context on a tail nobody reads.
      const asked = Number.isFinite(args.limit) ? Math.trunc(args.limit) : 5;
      const limit = String(Math.min(20, Math.max(1, asked)));
      const out = await runAsync(argv("search", ["--json", "--limit", limit], args.query));
      return answer(out);
    },
  })));

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_session",
    description:
      "A full digest of the single best-matching past session — what was tried, what was decided, what it cost. Use after deja_recall when the reasoning behind an earlier decision matters, not just that it happened.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "A query, or a session id prefix returned by deja_recall.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const out = await runAsync(argv("ctx", [], args.query));
      return answer(out);
    },
  })));

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_blame",
    description:
      "The past sessions that discussed a file, so you know why it is shaped the way it is before editing, refactoring or deleting it. Session history, not git authorship.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Path to the file, absolute or relative to the workspace.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const out = await runAsync(argv("blame", ["--json"], args.path));
      return answer(out);
    },
  })));

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_fix",
    description:
      "What this machine ran after that same error before, in the sessions where the error did not come back. Paste the failing output verbatim rather than a paraphrase — the match is on the error's own words.",
    parameters: {
      error: {
        type: "string",
        required: true,
        description: "The failing output, copied as it was printed.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const out = await runAsync(argv("fix", [], args.error));
      return answer(out);
    },
  })));

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_how",
    description:
      "The real invocation this machine uses for a build, test, deploy or script, with the flags it actually ran, ordered by how many sessions ran it. A guessed command is plausible and fails on this setup.",
    parameters: {
      what: {
        type: "string",
        required: true,
        description: "The thing to run: a tool, a task, a script name.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const out = await runAsync(argv("how", [], args.what));
      return answer(out);
    },
  })));

  guarded(() => ctx.tools.register(defineTool({
    name: "deja_remember",
    description:
      "Store one durable decision once it is settled, as a single self-contained fact that will make sense months later. Not transcripts, not a summary of the conversation, and not anything already obvious from the code.",
    parameters: {
      text: {
        type: "string",
        required: true,
        description: "The decision, in one or two sentences, with the reason it was taken.",
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (!INSTALLED) return MISSING;
      const written = await runAsync(argv("remember", [], args.text));
      return written || "deja did not record that.";
    },
  })));
}

function command(ctx) {
  guarded(() => ctx.commands.register({
    name: "deja",
    description: "Search this machine's past AI coding sessions",
    input: { hint: "what to look for" },
    async handler(invocation) {
      const query = String((invocation && invocation.rawInput) || "").trim();
      if (!query) {
        return { kind: "error", text: "Say what to look for: /deja <error, file, or decision>" };
      }
      // Named, not handed over as deja's first word: the bare-query path
      // dispatches a word that happens to be a command, so `/deja version`
      // printed a version number and `/deja index` rebuilt the index, and one
      // of the words people most want history about is `install`.
      const out = await runAsync(argv("search", [], query));
      return { kind: INSTALLED ? "success" : "error", text: answer(out) };
    },
  }));
}

function userText(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return typeof content === "string" ? content.trim() : "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// autoRecall puts the answer in front of the model without anyone asking for
// it, through the seam the host evaluates on every assembly. The obvious
// alternative — splicing a message into the "agent/pre-step" waterfall — looks
// like it works and does not: a later listener rebuilds its answer from the
// payload, and the added message is dropped with nothing reported.
//
// The registration is guarded because the host throws "prompt context
// deja:recall is already registered" on a second copy in the same profile, and
// that failure is not local: the whole profile fails to load, so a duplicate
// memory plugin costs the user their agent. One registration is all recall
// needs. installedByCLI() below is the first line of defence; this is the one
// that holds when the installer wrote to a different DSH_HOME than the profile
// boots from.
// autoDigest puts what this project settled in front of the model once at the
// start of the session — the question-independent counterpart to autoRecall.
// dsh's own agent/session-start is emit-only, its return reaches nothing, so
// the digest rides the same assembly seam the recall does. deja_once keys the
// one-shot on the session id in deja's ledger, which survives a resume in a new
// process; the Set is the in-process guard that keeps the long-lived web and
// tui profiles from spawning deja on every assembly of a session already shown.
function autoDigest(ctx) {
  const seen = new Set();
  const digestCache = new Map();

  guarded(() =>
    ctx.systemPrompt.context({
      name: "deja:project",
      order: 110,
      text: (assembly) => {
        const agent = assembly && assembly.agent;
        if (!agent) return "";
        const sid = sessionId(agent);
        if (sid && seen.has(sid)) return "";
        if (sid) seen.add(sid);
        if (digestCache.has(sid)) {
          return digestCache.get(sid);
        }
        const res = runSync(
          ["hook-context", "--plain"],
          JSON.stringify({ session_id: sid, cwd: process.cwd(), source: "startup", deja_once: true }),
          500,
        );
        digestCache.set(sid, res);
        return res;
      },
    }),
  );
}

function sessionId(agent) {
  return (agent && (agent.sessionId || (agent.session && agent.session.id))) || "";
}

function autoRecall(ctx) {
  let asked = "";
  let recalled = "";

  // Proactively prefetch in the background as soon as a human message arrives
  guarded(() => {
    ctx.on("agent/inbox/inserted", (payload) => {
      try {
        const message = payload && payload.message;
        if (isHuman(message)) {
          const text = userText(message);
          if (text) {
            prefetchPrompt(text);
          }
        }
      } catch {}
    });
  });

  guarded(() =>
    ctx.systemPrompt.context({
      name: "deja:recall",
      order: 120,
      text: (assembly) => {
        const agent = assembly && assembly.agent;
        if (!agent) return "";
        const prompt = lastHumanText(agent);
        if (!prompt) return "";

        if (prompt === asked) {
          return recalled;
        }

        asked = prompt;

        // 1. Fast bypass for short, trivial confirmations (0ms)
        if (shouldBypassRecall(prompt)) {
          recalled = "";
          return recalled;
        }

        // 2. Cache hit from prefetch or recent turn (0ms)
        const cached = getRecallCache(prompt);
        if (cached !== null) {
          recalled = cached;
          return recalled;
        }

        // 3. Cache miss: strictly bounded sync invocation (max 300ms, never 20s)
        recalled = runSync(
          ["hook-prompt", "--plain"],
          JSON.stringify({ prompt, cwd: process.cwd() }),
          300,
        );
        setRecallCache(prompt, recalled);
        return recalled;
      },
    }),
  );
}

// lastHumanText is the newest thing the person actually typed. At assembly
// time the message has already left the inbox and has not been appended as a
// "user/message" yet — the only durable record of it is the inbox splice that
// carried it in, so both are read. Anything a plugin contributed is skipped:
// those carry a source of their own.
function lastHumanText(agent) {
  const events = agent && agent.session && agent.session.events;
  if (!Array.isArray(events)) return "";
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (event.type === "user/message" && isHuman(event.data)) return userText(event.data);
    if (event.type === "agent/inbox/spliced") {
      const inserted = event.data && event.data.inserted;
      if (!Array.isArray(inserted)) continue;
      for (let j = inserted.length - 1; j >= 0; j--) {
        if (isHuman(inserted[j])) return userText(inserted[j]);
      }
    }
  }
  return "";
}

function isHuman(message) {
  return Boolean(message) && (!message.source || message.source.kind === "user");
}

// `deja install dsh` writes plugins of its own into DSH_HOME and adds them to
// the profile, so a user who ran the installer and then added this package has
// both: two `/deja` commands, the same recall on the system prompt twice, and
// deja's MCP server answering the same six questions the tools here do. What
// the installer wrote wins — it is the copy `deja install` keeps current — and
// this package contributes only the parts that are missing.
//
// The two halves are separate on purpose: `deja install dsh` writes command.js
// and the MCP row, and only `deja install dsh-auto` adds auto.js. A profile can
// have the command from the installer and still want recall from here.
function cliPluginDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "plugins", "deja");
}

function installedByCLI(file) {
  try {
    return existsSync(join(cliPluginDir(), file));
  } catch {
    return false;
  }
}

function apply(ctx, config) {
  const adds = contributions(
    { command: installedByCLI("command.js"), auto: installedByCLI("auto.js") },
    config,
  );
  if (adds.tools) tools(ctx);
  if (adds.command) command(ctx);
  if (adds.recall) {
    autoDigest(ctx);
    autoRecall(ctx);
  }
}

apply.inject = ["tools", "commands", "systemPrompt"];

export default apply;
