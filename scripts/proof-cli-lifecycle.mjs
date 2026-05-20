// Verify human-facing Memlane CLI lifecycle:
// - status reports initialized workstream setup
// - doctor runs without MCP
// - backup copies knowledge safely
// - export writes a JSON graph snapshot
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "memlane-cli-lifecycle-"));
const HOME = path.join(ROOT, "home");
const WORK = path.join(ROOT, "work");
const DIST = path.resolve("dist/index.js");
const PACKAGE = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));
await fs.mkdir(HOME, { recursive: true });
await fs.mkdir(WORK, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function runMemlane(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [DIST, ...args], {
      cwd: WORK,
      env: { ...process.env, HOME },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`memlane ${args.join(" ")} failed (${code})\n${stderr}\n${stdout}`));
    });
  });
}

console.log("=== init ===");
await runMemlane([
  "init",
  "--name",
  "cli-lifecycle",
  "--gist",
  "CLI lifecycle proof.",
  "--json",
]);

console.log("=== status ===");
const status = JSON.parse((await runMemlane(["status", "--json"])).stdout);
assert(status.ok, "status should be ok after init");
assert(status.version === PACKAGE.version, "status should include package version");
assert(status.knowledgeDir.exists, "status should see knowledge dir");
assert(status.configs.claude.hasMemlane, "status should see Claude MCP config");
assert(status.configs.cursor.hasMemlane, "status should see Cursor MCP config");
assert(status.configs.codex.hasMemlane, "status should see Codex MCP config");
assert(status.configs.opencode.hasMemlane, "status should see OpenCode MCP config");

console.log("=== doctor ===");
const doctor = JSON.parse(
  (await runMemlane(["doctor", "--skip-index", "--json"])).stdout
);
assert(doctor.ok, "doctor should pass after init when index check is skipped");
assert(doctor.summary.entities === 2, "doctor should see workstream + state");

console.log("=== backup ===");
const backupPath = path.join(ROOT, "backup");
const backup = JSON.parse(
  (await runMemlane(["backup", "--out", backupPath, "--json"])).stdout
);
assert(backup.ok, "backup should succeed");
assert(await exists(path.join(backupPath, "_index.json")), "backup should copy index");
assert(
  await exists(path.join(backupPath, "states", "current-state.md")),
  "backup should copy state"
);

console.log("=== export ===");
const exportPath = path.join(ROOT, "export.json");
const exported = JSON.parse(
  (await runMemlane(["export", "--out", exportPath, "--json"])).stdout
);
assert(exported.entities === 2, "export command should report entity count");
const exportData = JSON.parse(await fs.readFile(exportPath, "utf8"));
assert(exportData.entities.length === 2, "export file should contain entities");
assert(Array.isArray(exportData.relations), "export file should contain relations");

console.log("=== backup safety ===");
let rejected = false;
try {
  await runMemlane(["backup", "--out", path.join(WORK, "knowledge", "nested")]);
} catch {
  rejected = true;
}
assert(rejected, "backup should reject output inside knowledge dir");

await fs.rm(ROOT, { recursive: true, force: true });
console.log("\nALL CHECKS PASSED");
