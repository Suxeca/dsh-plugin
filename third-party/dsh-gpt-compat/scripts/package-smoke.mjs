import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "dsh-gpt-compat-consumer-"));
const npmCache = join(root, ".cache", "npm");
const environment = { ...process.env, npm_config_cache: npmCache };

try {
  const packed = await exec("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
    cwd: root,
    env: environment
  });
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(temporary, filename);
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ name: "package-smoke", private: true, type: "module" })
  );
  await exec(
    "npm",
    ["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", tarball],
    { cwd: temporary, env: environment }
  );
  await writeFile(
    join(temporary, "smoke.mjs"),
    `
      import assert from "node:assert/strict";
      import { name, classifyEscalation } from "dsh-gpt-compat";
      import { ESCALATION_KEYS } from "dsh-gpt-compat/escalation-guard";
      import { SANDBOX_MODES } from "dsh-gpt-compat/sandbox-modes";
      assert.equal(name, "gpt-compat");
      assert.deepEqual(ESCALATION_KEYS, ["sandbox_permissions", "justification"]);
      assert.equal(SANDBOX_MODES.length, 3);
      assert.equal(classifyEscalation(
        { sandbox_permissions: "workspace-write", justification: "not used" },
        "workspace-write"
      ).kind, "strip");
    `
  );
  await exec(process.execPath, ["smoke.mjs"], { cwd: temporary, env: environment });

  const manifest = JSON.parse(
    await readFile(join(temporary, "node_modules", "dsh-gpt-compat", "package.json"))
  );
  assert.equal(manifest.version, packageManifest.version);
  process.stdout.write("Tarball consumer smoke test passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
