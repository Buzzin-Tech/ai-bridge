import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { logActivity } from "./activity.js";

function resolveAgyBinary() {
  if (process.env.AGY_BIN && existsSync(process.env.AGY_BIN)) {
    return process.env.AGY_BIN;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const winBin = join(localAppData, "agy", "bin", "agy.exe");
    if (existsSync(winBin)) return winBin;
  } else {
    const unixBin = join(homedir(), ".local", "bin", "agy");
    if (existsSync(unixBin)) return unixBin;
  }

  return "agy";
}

function parseAgyJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {}
    }
    return null;
  }
}

/**
 * Invoke the Antigravity CLI (agy) headlessly to get a review or second opinion.
 */
export async function askAntigravity(
  question,
  projectPath = null,
  model = null,
  conversationId = null,
  mode = "plan"
) {
  if (Number(process.env.AI_BRIDGE_DEPTH ?? 0) >= 2) {
    throw new Error("Blocked recursive bridge call (depth limit reached).");
  }

  const agyBin = resolveAgyBinary();
  const resolvedMode = mode || "plan";
  const args = ["-p", question, "--output-format", "json", "--mode", resolvedMode];
  if (resolvedMode !== "plan") args.push("--disable-slash-commands");
  if (model) args.push("--model", model);
  if (conversationId) args.push("--conversation", conversationId);

  const cwd = projectPath && existsSync(projectPath) ? projectPath : process.cwd();
  const env = {
    ...process.env,
    AI_BRIDGE_DEPTH: String(Number(process.env.AI_BRIDGE_DEPTH ?? 0) + 1),
  };

  try {
    const raw = execFileSync(agyBin, args, {
      cwd,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true,
      env,
    });

    const parsed = parseAgyJson(raw);
    if (parsed?.status && parsed.status !== "SUCCESS") {
      throw new Error(parsed.error || `Antigravity exited with status ${parsed.status}`);
    }

    const responseText = (parsed?.response ?? raw).trim();
    const returnedConversationId = parsed?.conversation_id ?? conversationId ?? null;
    const output = returnedConversationId
      ? `${responseText}\n\n[Antigravity conversation_id: ${returnedConversationId}]`
      : responseText;

    logActivity({
      from: "claude",
      to: "antigravity",
      question,
      projectPath,
      model: model ?? "antigravity-default",
      conversationId: returnedConversationId,
      response: output,
    });

    return output;
  } catch (err) {
    if (err.code === "ENOENT") {
      const msg = "Antigravity CLI (agy) is not installed. Run in PowerShell: irm https://antigravity.google/cli/install.ps1 | iex";
      logActivity({
        from: "claude",
        to: "antigravity",
        question,
        projectPath,
        model: model ?? "antigravity-default",
        error: msg,
      });
      throw new Error(msg);
    }

    const stdout = err.stdout?.toString().trim() ?? "";
    const stderr = err.stderr?.toString().trim() ?? "";
    const combined = [stdout, stderr, err.message].filter(Boolean).join("\n");

    if (/authentication required|not authenticated|login/i.test(combined)) {
      const msg = "Antigravity CLI is not authenticated. Run `agy` once in a terminal to complete interactive sign-in.";
      logActivity({
        from: "claude",
        to: "antigravity",
        question,
        projectPath,
        model: model ?? "antigravity-default",
        error: msg,
      });
      throw new Error(msg);
    }

    const msg = stdout || stderr || err.message;
    logActivity({
      from: "claude",
      to: "antigravity",
      question,
      projectPath,
      model: model ?? "antigravity-default",
      error: msg,
    });
    throw new Error(`Antigravity CLI error: ${msg}`);
  }
}
