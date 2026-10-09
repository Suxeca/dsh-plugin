import test from "node:test";
import assert from "node:assert/strict";
import { ESCALATION_KEYS, classifyEscalation, planEscalationStripping } from "../dist/escalation-guard.js";
import { ESCALATION_TARGETS, SANDBOX_MODES, isSandboxMode, isStrictlyWider } from "../dist/sandbox-modes.js";

const BOTH = [...ESCALATION_KEYS];

const valid = (sandbox_permissions = "workspace-write", justification = "needed") => ({
  sandbox_permissions,
  justification
});

test("exports the closed DSH mode vocabulary", () => {
  assert.deepEqual(SANDBOX_MODES, ["read-only", "workspace-write", "danger-full-access"]);
  assert.deepEqual(ESCALATION_TARGETS, ["workspace-write", "danger-full-access"]);
  assert.equal(isSandboxMode("workspace-write"), true);
  assert.equal(isSandboxMode("future-mode"), false);
  assert.equal(isStrictlyWider("danger-full-access", "workspace-write"), true);
  assert.equal(isStrictlyWider("workspace-write", "workspace-write"), false);
});

test("does nothing when no escalation fields are present", () => {
  assert.deepEqual(classifyEscalation({ file_path: "x" }, "danger-full-access"), { kind: "none" });
  assert.deepEqual(planEscalationStripping(undefined, "danger-full-access"), []);
});

test("strips known redundant requests even when their justification is malformed", () => {
  assert.deepEqual(planEscalationStripping(valid("workspace-write"), "workspace-write"), BOTH);
  assert.deepEqual(planEscalationStripping(valid("danger-full-access"), "danger-full-access"), BOTH);
  assert.deepEqual(planEscalationStripping(valid("workspace-write"), "danger-full-access"), BOTH);
  assert.deepEqual(planEscalationStripping(valid("workspace-write", ""), "workspace-write"), BOTH);
  assert.deepEqual(
    planEscalationStripping({ sandbox_permissions: "workspace-write" }, "workspace-write"),
    BOTH
  );
  assert.deepEqual(
    planEscalationStripping(
      { sandbox_permissions: "workspace-write", justification: 7 },
      "danger-full-access"
    ),
    BOTH
  );
});

test("preserves genuine widening requests", () => {
  assert.deepEqual(classifyEscalation(valid("workspace-write"), "read-only"), {
    kind: "preserve",
    reason: "valid-escalation"
  });
  assert.deepEqual(classifyEscalation(valid("danger-full-access"), "workspace-write"), {
    kind: "preserve",
    reason: "valid-escalation"
  });
});

test("preserves malformed widening requests for DSH core validation", () => {
  assert.deepEqual(classifyEscalation({ sandbox_permissions: "workspace-write" }, "read-only"), {
    kind: "preserve",
    reason: "invalid-request"
  });
  assert.deepEqual(classifyEscalation({ justification: "reason" }, "danger-full-access"), {
    kind: "preserve",
    reason: "invalid-request"
  });
  assert.deepEqual(classifyEscalation(valid("danger-full-access", "   "), "read-only"), {
    kind: "preserve",
    reason: "invalid-request"
  });
  assert.deepEqual(classifyEscalation({ ...valid(), justification: 7 }, "read-only"), {
    kind: "preserve",
    reason: "invalid-request"
  });
});

test("preserves unknown modes and requested targets", () => {
  assert.deepEqual(classifyEscalation(valid("workspace-write"), "future-mode"), {
    kind: "preserve",
    reason: "unknown-contract"
  });
  assert.deepEqual(classifyEscalation(valid("future-mode"), "read-only"), {
    kind: "preserve",
    reason: "invalid-request"
  });
});
