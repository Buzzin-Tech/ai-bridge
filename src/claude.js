import { execSync } from "child_process";
import { logActivity } from "./activity.js";

export async function askClaude(question, sessionContext = null, projectPath = null, model = null) {
  if (Number(process.env.AI_BRIDGE_DEPTH ?? 0) >= 2) {
    throw new Error("Blocked recursive bridge call (depth limit reached).");
  }
  let prompt = question;

  if (sessionContext?.messages?.length) {
    const ctxText = sessionContext.messages
      .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n");
    prompt =
      `Context from my current Antigravity session (${sessionContext.totalSteps} steps):\n\n${ctxText}\n\n---\n\n${question}`;
  }

  const escaped = prompt.replace(/"/g, '\\"');

  // If a project path is given, fork the most recent Claude session for that project.
  // --continue picks the latest session in that cwd; --fork-session keeps the live session untouched.
  // Falls back gracefully to a fresh instance if no prior session exists.
  let cmd;
  const modelFlag = model ? `--model ${model}` : "";
  if (projectPath) {
    cmd = `claude --continue --fork-session --cwd "${projectPath}" ${modelFlag} -p "${escaped}" --output-format text`;
  } else {
    cmd = `claude ${modelFlag} -p "${escaped}" --output-format text`;
  }

  const env = {
    ...process.env,
    AI_BRIDGE_DEPTH: String(Number(process.env.AI_BRIDGE_DEPTH ?? 0) + 1),
  };

  try {
    const result = execSync(cmd, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
      env,
    });
    const response = result.trim();
    logActivity({ from: "antigravity", to: "claude", question, projectPath, model: model ?? "claude-sonnet-4-6", response });
    return response;
  } catch (err) {
    // If --continue fails (no prior session), retry without it
    if (projectPath && (err.stderr?.includes("No session") || err.stderr?.includes("not found"))) {
      const fallback = execSync(
        `claude --cwd "${projectPath}" -p "${escaped}" --output-format text`,
        { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 * 10, env }
      );
      const response = fallback.trim();
      logActivity({ from: "antigravity", to: "claude", question, projectPath, model: model ?? "claude-sonnet-4-6", response });
      return response;
    }
    const msg = err.stdout?.trim() || err.stderr?.trim() || err.message;
    logActivity({ from: "antigravity", to: "claude", question, projectPath, error: msg });
    throw new Error(`Claude CLI error: ${msg}`);
  }
}
