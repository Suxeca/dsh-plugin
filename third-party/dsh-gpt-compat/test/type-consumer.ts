import {
  Config as ConfigSchema,
  ESCALATION_TARGETS,
  classifyEscalation,
  type Config,
  type EscalationTarget,
  type SandboxMode
} from "dsh-gpt-compat";
import {
  ESCALATION_KEYS,
  type EscalationDecision,
  type EscalationKey
} from "dsh-gpt-compat/escalation-guard";

const config: Config = {
  providers: ["gpt-provider"],
  tools: ["edit"]
};
const mode: SandboxMode = "workspace-write";
const target: EscalationTarget = ESCALATION_TARGETS[0];
const key: EscalationKey = ESCALATION_KEYS[0];
const decision: EscalationDecision = classifyEscalation(
  { sandbox_permissions: target, justification: "needed" },
  mode
);

void [ConfigSchema, config, key, decision];
