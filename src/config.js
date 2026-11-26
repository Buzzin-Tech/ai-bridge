import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_PATHS = [
  join(process.cwd(), "ai-bridge.config.json"),
  join(homedir(), ".config", "ai-bridge", "config.json"),
  join(homedir(), "ai-bridge.config.json"),
];

function detectAntigravityBrain() {
  const candidates = [
    join(homedir(), ".gemini", "antigravity", "brain"),
    join(homedir(), ".antigravity", "brain"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadConfig() {
  for (const p of CONFIG_PATHS) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf8"));
        return raw;
      } catch {}
    }
  }
  return {};
}

const userConfig = loadConfig();

export const config = {
  antigravity: {
    brainPath: userConfig.antigravity?.brainPath ?? detectAntigravityBrain(),
  },
  anthropic: {
    apiKey: userConfig.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null,
    model: userConfig.anthropic?.model ?? "claude-sonnet-4-6",
  },
};
