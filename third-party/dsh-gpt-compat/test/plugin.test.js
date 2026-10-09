import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import * as plugin from "../dist/index.js";

const escalationDefinition = {
  name: "edit",
  description: "fixture",
  parameters: {
    type: "object",
    properties: {
      sandbox_permissions: {
        type: "string",
        enum: ["workspace-write", "danger-full-access"]
      },
      justification: { type: "string" }
    }
  }
};

const ordinaryDefinition = {
  name: "custom",
  description: "fixture",
  parameters: {
    type: "object",
    properties: {
      sandbox_permissions: { type: "string" },
      justification: { type: "string" }
    }
  }
};

const createContext = async ({ mode = "danger-full-access", resolve, definitions = {} } = {}, config) => {
  const ctx = new Context();
  const calls = [];
  ctx.provide("tools", {
    get: (name) => definitions[name] ?? (name === "edit" ? escalationDefinition : undefined)
  });
  ctx.provide("sandboxPolicy", {
    resolve: (request) => {
      calls.push(request);
      if (resolve) return resolve(request);
      return { mode, workspaceRoot: "/workspace" };
    }
  });
  await ctx.plugin(plugin, config ?? { providers: ["gpt-provider"], tools: ["edit"] });
  return { ctx, calls };
};

const execution = ({
  name = "edit",
  provider = "gpt-provider",
  routedProvider = provider,
  agent = true,
  arguments: args = {}
} = {}) => ({
  name,
  arguments: Object.freeze({
    file_path: "/workspace/x.js",
    sandbox_permissions: "workspace-write",
    justification: "not used",
    ...args
  }),
  ...(agent
    ? {
        agent: {
          options: { provider },
          session: {
            requestHeader: () =>
              routedProvider === undefined ? undefined : { config: { provider: routedProvider } }
          }
        }
      }
    : {}),
  callId: "call_1",
  signal: new AbortController().signal
});

const fire = (ctx, exec) =>
  ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));

test("strips a redundant request only from an opted-in DSH escalation tool", async () => {
  const { ctx } = await createContext();
  const exec = execution({ arguments: { payload: { nested: true } } });
  const nested = exec.arguments.payload;
  const gate = await fire(ctx, exec);

  assert.equal(gate.kind, "allow");
  assert.equal("sandbox_permissions" in exec.arguments, false);
  assert.equal("justification" in exec.arguments, false);
  assert.equal(exec.arguments.payload, nested);
  assert.equal(Object.isFrozen(exec.arguments), true);
});

test("strips a redundant request even when GPT supplies an empty justification", async () => {
  const { ctx } = await createContext({ mode: "workspace-write" });
  const exec = execution({ arguments: { justification: "" } });

  await fire(ctx, exec);

  assert.equal("sandbox_permissions" in exec.arguments, false);
  assert.equal("justification" in exec.arguments, false);
});

test("strips the first bash call's empty justification under workspace-write", async () => {
  const { ctx } = await createContext(
    {
      mode: "workspace-write",
      definitions: { bash: { ...escalationDefinition, name: "bash" } }
    },
    { providers: ["gpt-provider"], tools: ["bash"] }
  );
  const exec = execution({
    name: "bash",
    arguments: {
      command: "pwd",
      description: "Confirm current working directory",
      justification: "",
      run_in_background: false,
      sandbox_permissions: "workspace-write",
      timeoutMs: 10000,
      workdir: "/home/dianxian/workspace/projects/dianx-safety"
    }
  });

  await fire(ctx, exec);

  assert.equal("sandbox_permissions" in exec.arguments, false);
  assert.equal("justification" in exec.arguments, false);
});

test("preserves genuine widening and malformed widening requests for core validation", async () => {
  const { ctx } = await createContext({ mode: "read-only" });
  const widening = execution({
    arguments: {
      sandbox_permissions: "danger-full-access",
      justification: "need system access"
    }
  });
  const malformed = execution({ arguments: { justification: "   " } });
  const wideningOriginal = widening.arguments;
  const malformedOriginal = malformed.arguments;

  await fire(ctx, widening);
  await fire(ctx, malformed);

  assert.equal(widening.arguments, wideningOriginal);
  assert.equal(malformed.arguments, malformedOriginal);
});

test("does not alter third-party tools that reuse the field names", async () => {
  const { ctx } = await createContext({ definitions: { custom: ordinaryDefinition } });
  const exec = execution({ name: "custom" });
  const original = exec.arguments;

  await fire(ctx, exec);

  assert.equal(exec.arguments, original);
});

test("requires the registered tool schema to advertise the complete DSH capability", async () => {
  const { ctx } = await createContext(
    { definitions: { edit: ordinaryDefinition } },
    { providers: ["gpt-provider"], tools: ["edit"] }
  );
  const exec = execution();
  const original = exec.arguments;

  await fire(ctx, exec);

  assert.equal(exec.arguments, original);
});

test("uses the current session route before the agent creation provider", async () => {
  const { ctx } = await createContext();
  const currentRoute = execution({ provider: "old-provider", routedProvider: "gpt-provider" });
  const nonTargetRoute = execution({ provider: "gpt-provider", routedProvider: "other-provider" });
  const nonTargetOriginal = nonTargetRoute.arguments;

  await fire(ctx, currentRoute);
  await fire(ctx, nonTargetRoute);

  assert.equal("sandbox_permissions" in currentRoute.arguments, false);
  assert.equal(nonTargetRoute.arguments, nonTargetOriginal);
});

test("resolves deployment policy for explicitly wildcarded agentless calls", async () => {
  const { ctx, calls } = await createContext({}, { providers: ["*"], tools: ["edit"] });
  const exec = execution({ agent: false });

  await fire(ctx, exec);

  assert.deepEqual(calls, [{}]);
  assert.equal("sandbox_permissions" in exec.arguments, false);
});

test("preserves arguments when the current provider route cannot be read", async () => {
  const { ctx } = await createContext();
  const missingSession = execution();
  const throwingHeader = execution();
  const missingOriginal = missingSession.arguments;
  const throwingOriginal = throwingHeader.arguments;
  missingSession.agent.session = undefined;
  throwingHeader.agent.session.requestHeader = () => {
    throw new Error("route unavailable");
  };

  await fire(ctx, missingSession);
  await fire(ctx, throwingHeader);

  assert.equal(missingSession.arguments, missingOriginal);
  assert.equal(throwingHeader.arguments, throwingOriginal);
});

test("preserves arguments when sandbox policy resolution fails", async () => {
  const { ctx } = await createContext({
    resolve: () => {
      throw new Error("policy unavailable");
    }
  });
  const exec = execution();
  const original = exec.arguments;

  await fire(ctx, exec);

  assert.equal(exec.arguments, original);
});

test("normalizes direct and partial configuration without relying on Cordis schema defaults", () => {
  assert.deepEqual(plugin.resolveConfig(), {
    providers: ["*"],
    tools: ["bash", "pwsh", "write", "edit"]
  });
  assert.deepEqual(
    plugin.resolveConfig({ providers: [" gpt-provider ", "gpt-provider", ""], tools: ["edit"] }),
    { providers: ["gpt-provider"], tools: ["edit"] }
  );
});
