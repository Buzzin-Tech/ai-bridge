#!/usr/bin/env node
/**
 * Registers ai-bridge as an MCP server in both Claude Code and Antigravity.
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(join(__dirname, "..", "src", "server.js"));

// ── Claude Code ──────────────────────────────────────────────────────────────
console.log("Registering with Claude Code...");
try {
  execSync(
    `claude mcp add ai-bridge node "${serverPath}"`,
    { stdio: "inherit" }
  );
  console.log("✓ Claude Code: ai-bridge MCP registered");
} catch (e) {
  console.warn("⚠ Could not register with Claude Code automatically.");
  console.warn(`  Run manually: claude mcp add ai-bridge node "${serverPath}"`);
}

// ── Antigravity ──────────────────────────────────────────────────────────────
// Antigravity requires HTTP-based MCP servers (serverUrl format, not stdio).
// The bridge must be running as an HTTP server: node src/server.js http
const agMcpPath = join(homedir(), ".gemini", "antigravity", "mcp_config.json");
const PORT = process.env.AI_BRIDGE_PORT ?? "3099";

if (existsSync(agMcpPath)) {
  console.log("\nRegistering with Antigravity...");
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(agMcpPath, "utf8")); } catch {}
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers["ai-bridge"] = {
    serverUrl: `http://localhost:${PORT}/sse`,
  };
  writeFileSync(agMcpPath, JSON.stringify(cfg, null, 2), "utf8");
  console.log("✓ Antigravity: ai-bridge registered at http://localhost:" + PORT + "/sse");
  console.log("  IMPORTANT: Start the HTTP server before using Antigravity tools:");
  console.log(`  node "${serverPath}" http`);
} else {
  console.warn("⚠ Antigravity mcp_config.json not found — skipping Antigravity registration.");
}

console.log("\nDone! Restart Claude Code and Antigravity to load the bridge.");
