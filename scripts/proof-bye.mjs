// Verify memlane bye:
// - dry-runs by default
// - removes only Memlane-owned MCP config entries and instruction blocks
// - removes init-only knowledge scaffolds
// - preserves knowledge dirs with user data unless --delete-knowledge is passed
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "memlane-bye-proof-"));
const DIST = path.resolve("dist/index.js");

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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function runMemlane(work, home, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [DIST, ...args], {
      cwd: work,
      env: { ...process.env, HOME: home },
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

async function makeWork(name) {
  const home = path.join(ROOT, `${name}-home`);
  const work = path.join(ROOT, `${name}-work`);
  await fs.mkdir(path.join(work, "docs"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.writeFile(path.join(work, "AGENTS.md"), "# Agent Notes\n");
  await fs.writeFile(path.join(work, "docs", "CLAUDE.md"), "# Claude Notes\n");
  await fs.writeFile(
    path.join(work, ".mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "other" } } }, null, 2) + "\n"
  );
  await fs.writeFile(
    path.join(home, ".codex", "config.toml"),
    "[other]\ncommand = \"keep\"\n"
  );
  return { home, work };
}

async function initWork(work, home) {
  await runMemlane(work, home, [
    "init",
    "--name",
    "bye-proof",
    "--gist",
    "Bye proof workstream.",
    "--with-ollama",
  ]);
}

console.log("=== init-only scaffold cleanup ===");
{
  const { home, work } = await makeWork("scaffold");
  await initWork(work, home);

  const dry = JSON.parse((await runMemlane(work, home, ["bye", "--json"])).stdout);
  assert(!dry.applied, "bye should dry-run by default");
  assert(await exists(path.join(work, "knowledge")), "dry-run should not remove knowledge");

  const applied = JSON.parse(
    (await runMemlane(work, home, ["bye", "--yes", "--json"])).stdout
  );
  assert(applied.applied, "bye --yes should apply cleanup");
  assert(!(await exists(path.join(work, "knowledge"))), "init-only knowledge should be removed");

  const mcp = await readJson(path.join(work, ".mcp.json"));
  assert(mcp.mcpServers.other.command === "other", ".mcp.json should preserve other servers");
  assert(!mcp.mcpServers.memlane, ".mcp.json should remove memlane");
  assert(!(await exists(path.join(work, ".cursor", "mcp.json"))), "cursor mcp should be removed");
  assert(!(await exists(path.join(work, "opencode.jsonc"))), "opencode config should be removed");

  const codex = await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8");
  assert(codex.includes("[other]"), "codex should preserve other config");
  assert(!codex.includes("[mcp_servers.memlane]"), "codex should remove memlane section");

  const agents = await fs.readFile(path.join(work, "AGENTS.md"), "utf8");
  const claude = await fs.readFile(path.join(work, "docs", "CLAUDE.md"), "utf8");
  assert(agents.includes("# Agent Notes"), "AGENTS.md should preserve user content");
  assert(claude.includes("# Claude Notes"), "CLAUDE.md should preserve user content");
  assert(!agents.includes("MEMLANE:BEGIN"), "AGENTS.md should remove memlane block");
  assert(!claude.includes("MEMLANE:BEGIN"), "CLAUDE.md should remove memlane block");
}

console.log("=== knowledge with user data is preserved ===");
{
  const { home, work } = await makeWork("userdata");
  await initWork(work, home);
  await fs.mkdir(path.join(work, "knowledge", "decisions"), { recursive: true });
  await fs.writeFile(
    path.join(work, "knowledge", "decisions", "real-decision.md"),
    "---\nname: real-decision\ntype: decision\ntags: []\n---\n\n## Content\nKeep this.\n"
  );

  const applied = JSON.parse(
    (await runMemlane(work, home, ["bye", "--yes", "--json"])).stdout
  );
  const knowledgeStep = applied.steps.find((s) => s.label === "Knowledge directory");
  assert(knowledgeStep.status === "skipped", "knowledge with user data should be skipped");
  assert(await exists(path.join(work, "knowledge", "decisions", "real-decision.md")), "user data should remain");

  await runMemlane(work, home, ["bye", "--yes", "--delete-knowledge"]);
  assert(!(await exists(path.join(work, "knowledge"))), "--delete-knowledge should remove knowledge dir");
}

await fs.rm(ROOT, { recursive: true, force: true });
console.log("\nALL CHECKS PASSED");
