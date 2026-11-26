import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const configDir = join(homedir(), ".config", "ai-bridge");
const logFile = join(configDir, "activity.jsonl");

function ensureDir() {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

export function logActivity(entry) {
  ensureDir();
  appendFileSync(logFile, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n", "utf8");
}

export function getActivity(limit = 20) {
  if (!existsSync(logFile)) return [];
  const lines = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}
