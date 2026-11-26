import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";

function getBrainPath() {
  const p = config.antigravity.brainPath;
  if (!p || !existsSync(p)) throw new Error("Antigravity brain path not found. Set antigravity.brainPath in ai-bridge.config.json");
  return p;
}

function getSessionDir(sessionId) {
  return join(getBrainPath(), sessionId);
}

function getTranscriptPath(sessionId) {
  return join(getSessionDir(sessionId), ".system_generated", "logs", "transcript.jsonl");
}

// Returns all sessions sorted by most recently active
export function listSessions(limit = 20) {
  const brain = getBrainPath();
  const dirs = readdirSync(brain, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "tempmediaStorage")
    .map(d => {
      const transcriptPath = getTranscriptPath(d.name);
      if (!existsSync(transcriptPath)) return null;
      const stat = statSync(transcriptPath);
      // Peek at first line for working directory context
      let project = null;
      try {
        const firstLine = readFileSync(transcriptPath, "utf8").split("\n")[0];
        const entry = JSON.parse(firstLine);
        const cwd = entry.content?.match(/Cwd="([^"]+)"/)?.[1] ?? entry.content?.match(/cwd.*?:\s*"([^"]+)"/i)?.[1];
        project = cwd ?? null;
      } catch {}
      return { id: d.name, lastActive: stat.mtime, project };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, limit);

  return dirs.map(s => ({
    id: s.id,
    lastActive: s.lastActive.toISOString(),
    project: s.project,
  }));
}

export function getActiveSessionId() {
  const sessions = listSessions(1);
  if (!sessions.length) throw new Error("No Antigravity sessions found");
  return sessions[0].id;
}

// Parse transcript JSONL into readable messages
export function readSession(sessionId, limit = 30) {
  const id = sessionId ?? getActiveSessionId();
  const path = getTranscriptPath(id);
  if (!existsSync(path)) throw new Error(`Session ${id} not found`);

  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Extract only user messages and model responses, skip tool noise
  const messages = entries
    .filter(e => e.type === "USER_INPUT" || e.type === "PLANNER_RESPONSE" || e.type === "SYSTEM_MESSAGE")
    .map(e => {
      const role = e.source === "USER_EXPLICIT" ? "user"
        : e.source === "MODEL" ? "assistant"
        : "system";

      let content = e.content ?? "";
      // Strip XML wrappers from user messages
      content = content.replace(/<USER_REQUEST>\n?/g, "").replace(/\n?<\/USER_REQUEST>/g, "");
      content = content.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "").trim();
      // For model responses with tool_calls, show just the text if it has thinking
      if (e.thinking) content = `[thinking]\n${e.thinking}\n\n${content}`;
      // Trim long content
      if (content.length > 1000) content = content.slice(0, 1000) + "\n...[truncated]";

      return { role, content, step: e.step_index, time: e.created_at };
    })
    .filter(m => m.content.trim().length > 0);

  const recent = messages.slice(-limit);

  return {
    sessionId: id,
    totalSteps: entries.length,
    showing: recent.length,
    messages: recent,
  };
}

// Search across all session transcripts
export function searchSessions(query, limit = 10) {
  const brain = getBrainPath();
  const sessions = readdirSync(brain, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "tempmediaStorage")
    .map(d => d.name);

  const results = [];
  const q = query.toLowerCase();

  for (const sessionId of sessions) {
    if (results.length >= limit) break;
    const path = getTranscriptPath(sessionId);
    if (!existsSync(path)) continue;
    try {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        if (!entry.content) continue;
        if (entry.content.toLowerCase().includes(q)) {
          results.push({
            sessionId,
            step: entry.step_index,
            time: entry.created_at,
            source: entry.source,
            excerpt: entry.content.slice(0, 300).replace(/<[^>]+>/g, " ").trim(),
          });
          if (results.length >= limit) break;
        }
      }
    } catch {}
  }

  return results;
}

// Inject a message into Antigravity's message bus for the active session
export function injectMessage(content, title = "Claude Code", sessionId) {
  const id = sessionId ?? getActiveSessionId();
  const messagesDir = join(getSessionDir(id), ".system_generated", "messages");
  if (!existsSync(messagesDir)) throw new Error(`Session ${id} messages directory not found — is this session still open in Antigravity?`);

  const msgId = uuidv4();
  const message = {
    id: msgId,
    recipient: id,
    sender: "ai-bridge/claude-code",
    priority: "MESSAGE_PRIORITY_HIGH",
    timestamp: new Date().toISOString(),
    renderDetails: { messageTitle: title },
    content,
  };

  writeFileSync(join(messagesDir, `${msgId}.json`), JSON.stringify(message, null, 2), "utf8");
  return `Message injected into session ${id} (id: ${msgId})`;
}
