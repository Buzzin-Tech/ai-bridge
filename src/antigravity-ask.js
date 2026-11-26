import { execFileSync } from "child_process";
import { logActivity } from "./activity.js";

export async function askAntigravity(question, projectPath = null, model = null) {
  // Guard against infinite loops (Antigravity → Claude → Antigravity → ...)
  if (Number(process.env.AI_BRIDGE_DEPTH ?? 0) >= 2) {
    throw new Error("Blocked recursive bridge call (depth limit reached).");
  }

  const args = ["-p", question, "--output-format", "text", "--skip-trust"];
  if (model) args.push("--model", model);
  // Resume the most recent Gemini session for this project if one exists
  args.push("--resume", "latest");

  const env = {
    ...process.env,
    AI_BRIDGE_DEPTH: String(Number(process.env.AI_BRIDGE_DEPTH ?? 0) + 1),
  };

  try {
    const result = execFileSync("gemini", args, {
      cwd: projectPath ?? process.cwd(),
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 10,
      env,
    });
    const response = result.trim();
    logActivity({ from: "claude", to: "antigravity", question, projectPath, model: model ?? "gemini-default", response });
    return response;
  } catch (err) {
    // If --resume latest fails (no prior session), retry without it
    const stderr = err.stderr?.toString() ?? "";
    if (stderr.includes("No session") || stderr.includes("not found") || stderr.includes("resume")) {
      const argsNoResume = args.filter(a => a !== "--resume" && a !== "latest");
      const fallback = execFileSync("gemini", argsNoResume, {
        cwd: projectPath ?? process.cwd(),
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 10,
        env,
      });
      const response = fallback.trim();
      logActivity({ from: "claude", to: "antigravity", question, projectPath, model: model ?? "gemini-default", response });
      return response;
    }
    const msg = err.stdout?.toString().trim() || stderr.trim() || err.message;
    logActivity({ from: "claude", to: "antigravity", question, projectPath, error: msg });
    throw new Error(`Gemini CLI error: ${msg}`);
  }
}
