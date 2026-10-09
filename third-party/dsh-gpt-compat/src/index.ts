import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-sandbox-policy";
import type { ToolDefinition, ToolExecution } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { classifyEscalation } from "./escalation-guard.js";
import { ESCALATION_TARGETS } from "./sandbox-modes.js";

export const name = "gpt-compat";
export const inject = ["tools", "sandboxPolicy"];

export interface Config {
  /** Provider ids to guard. An explicit "*" enables every provider. */
  providers: string[];
  /** Registered DSH tool names allowed to use the escalation compatibility rule. */
  tools: string[];
}

export const DEFAULT_CONFIG = Object.freeze({
  providers: Object.freeze(["*"]),
  tools: Object.freeze(["bash", "pwsh", "write", "edit"])
});

export const Config: z<Config> = z.object({
  providers: z.array(z.string()).default([...DEFAULT_CONFIG.providers]),
  tools: z.array(z.string()).default([...DEFAULT_CONFIG.tools])
});

function uniqueNonEmpty(values: readonly string[] | undefined, fallback: readonly string[]): string[] {
  const source = values ?? fallback;
  return [...new Set(source.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function resolveConfig(config: Partial<Config> = {}): Config {
  return {
    providers: uniqueNonEmpty(config.providers, DEFAULT_CONFIG.providers),
    tools: uniqueNonEmpty(config.tools, DEFAULT_CONFIG.tools)
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function advertisesEscalation(definition: ToolDefinition | undefined): boolean {
  const parameters = asRecord(definition?.parameters);
  const properties = asRecord(parameters?.properties);
  const mode = asRecord(properties?.sandbox_permissions);
  const justification = asRecord(properties?.justification);
  const targets = mode?.enum;
  return (
    mode?.type === "string" &&
    Array.isArray(targets) &&
    ESCALATION_TARGETS.every((target) => targets.includes(target)) &&
    justification?.type === "string"
  );
}

function currentProvider(exec: ToolExecution): string | undefined {
  if (exec.agent === undefined || exec.agent.session === undefined) return undefined;
  try {
    const routed = exec.agent.session.requestHeader()?.config.provider;
    return routed ?? exec.agent.options.provider;
  } catch {
    return undefined;
  }
}

function matchesProvider(provider: string | undefined, providers: readonly string[]): boolean {
  return providers.includes("*") || (provider !== undefined && providers.includes(provider));
}

function stripKeys(
  args: Record<string, unknown>,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  const dropped = new Set(keys);
  return Object.freeze(Object.fromEntries(Object.entries(args).filter(([key]) => !dropped.has(key))));
}

/** Register the compatibility guard. Cordis supplies schema defaults before normal plugin startup. */
export function apply(ctx: Context, input: Partial<Config> = {}): void {
  const config = resolveConfig(input);
  if (config.providers.length === 0 || config.tools.length === 0) {
    ctx.logger.info("gpt-compat: inactive (configure at least one provider and tool)");
    return;
  }

  let warnedPolicyFailure = false;
  ctx.on("tools/pre-execute", (exec, next) => {
    if (!config.tools.includes(exec.name)) return next();
    if (!matchesProvider(currentProvider(exec), config.providers)) return next();
    if (!advertisesEscalation(ctx.tools.get(exec.name, exec.agent))) return next();

    const args = asRecord(exec.arguments);
    if (args === undefined) return next();
    if (args.sandbox_permissions === undefined && args.justification === undefined) return next();

    let currentMode: unknown;
    try {
      currentMode = ctx.sandboxPolicy.resolve(
        exec.agent === undefined ? {} : { session: exec.agent.session }
      ).mode;
    } catch (error) {
      if (!warnedPolicyFailure) {
        warnedPolicyFailure = true;
        ctx.logger.warn(
          "gpt-compat: sandbox policy resolution failed; preserving escalation arguments",
          error
        );
      }
      return next();
    }

    const decision = classifyEscalation(args, currentMode);
    if (decision.kind === "strip") {
      (exec as ToolExecution & { arguments: Readonly<Record<string, unknown>> }).arguments = stripKeys(
        args,
        decision.keys
      );
    }
    return next();
  });

  ctx.logger.info(
    `gpt-compat: escalation guard active (providers: ${config.providers.join(", ")}; tools: ${config.tools.join(", ")})`
  );
}

export { classifyEscalation } from "./escalation-guard.js";
export {
  ESCALATION_TARGETS,
  SANDBOX_MODES,
  isEscalationTarget,
  isSandboxMode,
  isStrictlyWider,
  type EscalationTarget,
  type SandboxMode
} from "./sandbox-modes.js";
