import { execSync } from "child_process";
import { logActivity } from "./activity.js";

// On Windows, gemini is a .cmd file — use shell:true via execSync so it resolves correctly
function runGemini(args, opts) {
  const cmd = `gemini ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`;
  return execSync(cmd, { shell: true, ...opts });
}

export async function askAntigravity(question, projectPath = null, model = null) {
  if (Number(process.env.AI_BRIDGE_DEPTH ?? 0) >= 2) {
    throw new Error("Blocked recursive bridge call (depth limit reached).");
  }

  const resolvedModel = model ?? "gemini-3.8-flash";
  const baseArgs = ["-p", question, "--output-format", "text", "--skip-trust", "--model", resolvedModel];

  const env = {
    ...process.env,
    AI_BRIDGE_DEPTH: String(Number(process.env.AI_BRIDGE_DEPTH ?? 0) + 1),
  };

  const execOpts = {
    cwd: projectPath ?? process.cwd(),
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 10,
    env,
  };

  // Try with --resume latest first; fall back without it if no prior session exists
  for (const args of [[...baseArgs, "--resume", "latest"], baseArgs]) {
    try {
      const result = runGemini(args, execOpts);
      const response = result.trim();
      logActivity({ from: "claude", to: "antigravity", question, projectPath, model: resolvedModel, response });
      return response;
    } catch (err) {
      const stderr = err.stderr?.toString() ?? "";
      const isResumeError = stderr.includes("No session") || stderr.includes("not found") || stderr.includes("resume");
      // If this was the --resume attempt and it failed for session reasons, retry without it
      if (args.includes("--resume") && isResumeError) continue;
      const msg = err.stdout?.toString().trim() || stderr.trim() || err.message;
      logActivity({ from: "claude", to: "antigravity", question, projectPath, model: resolvedModel, error: msg });
      throw new Error(`Gemini CLI error: ${msg}`);
    }
  }
}
