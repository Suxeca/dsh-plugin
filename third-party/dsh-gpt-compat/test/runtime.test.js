import test from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import * as plugin from "../dist/index.js";

const installRuntime = async (mode) => {
  const ctx = new Context();
  ctx.provide("systemPrompt", {
    tools: () => () => {},
    section: () => () => {}
  });
  await ctx.plugin(ToolRuntime, { mode: "native" });
  ctx.provide("sandboxPolicy", {
    resolve: () => ({ mode, workspaceRoot: "/workspace" })
  });
  await ctx.plugin(plugin, { providers: ["*"], tools: ["edit"] });
  return ctx;
};

const editTool = defineTool({
  name: "edit",
  description: "Test one edit call.",
  parameters: {
    content: { type: "string", required: true },
    sandbox_permissions: {
      type: "string",
      enum: ["workspace-write", "danger-full-access"]
    },
    justification: { type: "string" }
  },
  output: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string", required: true },
        hasPermissions: { type: "boolean", required: true },
        frozen: { type: "boolean", required: true }
      }
    },
    render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
  },
  execute: async (args) => ({
    content: args.content,
    hasPermissions: "sandbox_permissions" in args || "justification" in args,
    frozen: Object.isFrozen(args)
  })
});

test("real ToolRuntime dispatches redundant escalation under the standing policy", async () => {
  const ctx = await installRuntime("workspace-write");
  ctx.tools.register(editTool);

  const result = await ctx.tools.execute({
    callId: "call_1",
    name: "edit",
    arguments: {
      content: "updated",
      sandbox_permissions: "workspace-write",
      justification: "not used"
    },
    signal: new AbortController().signal
  });

  assert.equal(result.isError, false);
  assert.deepEqual(result.value, {
    content: "updated",
    hasPermissions: false,
    frozen: true
  });
});

test("real ToolRuntime strips an incomplete redundant escalation", async () => {
  const ctx = await installRuntime("workspace-write");
  ctx.tools.register(editTool);

  const result = await ctx.tools.execute({
    callId: "call_2",
    name: "edit",
    arguments: {
      content: "updated",
      sandbox_permissions: "workspace-write",
      justification: ""
    },
    signal: new AbortController().signal
  });

  assert.equal(result.isError, false);
  assert.deepEqual(result.value, {
    content: "updated",
    hasPermissions: false,
    frozen: true
  });
});
