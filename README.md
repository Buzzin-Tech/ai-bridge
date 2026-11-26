# AI Bridge

A local MCP server that bridges **Claude Code** and **Antigravity** — letting both AIs share context and communicate without you switching tabs or copy-pasting.

## What it does

| From | To | How |
|------|-----|-----|
| Claude Code | Antigravity | Inject a message directly into the active Antigravity session (shows as a SYSTEM message) |
| Claude Code | Antigravity | Read the full conversation transcript of any session |
| Antigravity | Claude Code | Call Claude tools from within Antigravity via MCP |
| Either | Either | Search across all sessions for past discussions |

## How it works

Antigravity stores full conversation transcripts on disk at:
```
~/.gemini/antigravity/brain/{session-id}/.system_generated/logs/transcript.jsonl
```

It also has a message bus at:
```
~/.gemini/antigravity/brain/{session-id}/.system_generated/messages/
```

Writing a JSON file there injects a `MESSAGE_PRIORITY_HIGH` SYSTEM message directly into the live session — Antigravity's AI sees it mid-conversation.

This bridge exposes that mechanism as standard MCP tools, so Claude Code (or any MCP client) can read and write to Antigravity sessions seamlessly.

## Setup

### 1. Install dependencies

```bash
cd "Ai Bridge"
npm install
```

### 2. Auto-install (registers with both Claude Code and Antigravity)

```bash
npm run install-mcp
```

Or manually:

**Claude Code:**
```bash
claude mcp add ai-bridge node "/path/to/Ai Bridge/src/server.js"
```

**Antigravity** — add to `~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "ai-bridge": {
      "serverUrl": "http://localhost:3099/sse"
    }
  }
}
```

> **Note:** Antigravity requires HTTP-based MCP servers. The bridge must be running before you open Antigravity.

### 3. Start the HTTP server

The bridge runs as an HTTP server on port 3099 for Antigravity to connect to:

```bash
node src/server.js http
```

To start it automatically with Windows, create a startup shortcut to `start-server.vbs`:

**PowerShell (run once):**
```powershell
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AI Bridge.lnk")
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"C:\Mustehsan\buzzintech\My Projects\Ai Bridge\start-server.vbs"'
$shortcut.Save()
```

### 4. Optional config

Copy `ai-bridge.config.example.json` to `ai-bridge.config.json` in the project root (or `~/.config/ai-bridge/config.json`) and fill in your paths. The bridge auto-detects `~/.gemini/antigravity/brain` on most systems.

## MCP Tools

### `ask_claude`
Ask Claude Code a question from within Antigravity. Automatically includes your current session as context.
```json
{ "question": "Review this logic", "inject_response": true }
```

### `ag_read_session`
Read the active Antigravity session transcript.
```json
{ "session_id": "optional", "limit": 30 }
```

### `ag_list_sessions`
List all sessions with timestamps and working directories.

### `ag_inject_message`
Inject a message into the active Antigravity session.
```json
{ "content": "Here is what I think...", "title": "Claude Code" }
```

### `ag_search`
Search across all session transcripts.
```json
{ "query": "ledger fix", "limit": 10 }
```

## Usage example

You are in Antigravity working on a bug. You want Claude Code's input:

> **In Antigravity:** Use the `ask_claude` tool with `"Review this logic and suggest improvements"`
>
> The bridge calls Claude Code, passes your session context automatically, and returns Claude's response.
>
> With `inject_response: true`, Claude's answer also appears as a SYSTEM message in your Antigravity conversation.

Or from Claude Code:

> **You:** "What is Antigravity working on right now?"
>
> Claude calls `ag_read_session` → reads your active Antigravity transcript → answers in full context.

## Cross-project bridging

If both AIs have context on the same project, you can connect them:

1. From Claude Code: use `ag_read_session` to pull Antigravity's view of the project
2. From Antigravity: use `ask_claude` to ask Claude Code about the project — the bridge automatically includes your Antigravity session context in Claude's prompt
3. Claude Code can inject findings back via `ag_inject_message`

Both AIs see each other's work. No manual copy-pasting.

## Works with Omni

If you use [OmniContext](https://github.com/SheikhMustehsan/omni-context), the bridge complements it: Omni tracks *what files* both AIs touched and indexes tool calls, errors and solutions into a searchable local database; this bridge exposes the *full conversation* of each session and lets both AIs talk to each other directly.

## Requirements

- Node.js 18+
- Claude Code CLI
- Antigravity editor
- Windows / macOS / Linux

## License

MIT
