export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;

export type SandboxMode = (typeof SANDBOX_MODES)[number];
export type EscalationTarget = Exclude<SandboxMode, "read-only">;

export const ESCALATION_TARGETS = [
  "workspace-write",
  "danger-full-access"
] as const satisfies readonly EscalationTarget[];

const MODE_RANK: Readonly<Record<SandboxMode, number>> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2
};

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && (SANDBOX_MODES as readonly string[]).includes(value);
}

export function isEscalationTarget(value: unknown): value is EscalationTarget {
  return typeof value === "string" && (ESCALATION_TARGETS as readonly string[]).includes(value);
}

export function isStrictlyWider(requested: EscalationTarget, current: SandboxMode): boolean {
  return MODE_RANK[requested] > MODE_RANK[current];
}
