import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { injectMessage, getActiveSessionId, listSessions } from "./antigravity.js";
import { config } from "./config.js";
import { logActivity } from "./activity.js";

function getTranscriptPath(sessionId) {
  return join(config.antigravity.brainPath, sessionId, ".system_generated", "logs", "transcript.jsonl");
}

function getLastModelStep(sessionId) {
  const path = getTranscriptPath(sessionId);
  if (!existsSync(path)) return -1;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  let last = -1;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.source === "MODEL" && typeof e.step_index === "number") last = e.step_index;
    } catch {}
  }
  return last;
}

function readNewModelResponse(sessionId, afterStep, afterTime) {
  const path = getTranscriptPath(sessionId);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.source !== "MODEL") continue;
      if (typeof e.step_index === "number" && e.step_index <= afterStep) continue;
      const created = new Date(e.created_at ?? 0).getTime();
      if (created < afterTime) continue;
      // Got a new model response — extract text
      let content = e.content ?? "";
      content = content.replace(/<USER_REQUEST>\n?/g, "").replace(/\n?<\/USER_REQUEST>/g, "");
      content = content.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "").trim();
      if (content.length > 0) return content;
    } catch {}
  }
  return null;
}

export async function askAntigravity(question, projectPath = null, model = null) {
  if (Number(process.env.AI_BRIDGE_DEPTH ?? 0) >= 2) {
    throw new Error("Blocked recursive bridge call (depth limit reached).");
  }

  // Find the right session — by project path or most recent
  let sessionId;
  if (projectPath) {
    const sessions = listSessions(20);
    const match = sessions.find(s => s.project && s.project.toLowerCase().includes(projectPath.toLowerCase().split(/[\\/]/).pop()));
    sessionId = match?.id ?? getActiveSessionId();
  } else {
    sessionId = getActiveSessionId();
  }

  const beforeStep = getLastModelStep(sessionId);
  const beforeTime = Date.now();

  // Inject the question into the live Antigravity session
  injectMessage(question, "Claude Code (ask_antigravity)", sessionId);

  // Poll transcript for new MODEL response (up to 90 seconds)
  const pollInterval = 2500;
  const maxWait = 90000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));
    const response = readNewModelResponse(sessionId, beforeStep, beforeTime);
    if (response) {
      const env = { ...process.env, AI_BRIDGE_DEPTH: String(Number(process.env.AI_BRIDGE_DEPTH ?? 0) + 1) };
      logActivity({ from: "claude", to: "antigravity", question, projectPath, model: "antigravity-live", response });
      return response;
    }
  }

  logActivity({ from: "claude", to: "antigravity", question, projectPath, error: "Timeout: no response from Antigravity within 90s" });
  throw new Error("Timeout: Antigravity did not respond within 90 seconds. Make sure Antigravity is open and active.");
}
