# AI Bridge

A local MCP server that connects Claude Code and Antigravity — both AIs can ask each other questions, share session context, and exchange findings without you switching tabs or copy-pasting anything.

## Why use it

Working across Claude Code and Antigravity means each AI only knows what happened in its own sessions. If Antigravity is debugging something and you want Claude's take, you copy the context, switch tools, explain everything again, bring the answer back. AI Bridge cuts that loop out.

From Antigravity you can call `ask_claude` and get a real Claude response — not a fresh blank instance, but the most recent Claude session for that project, with all its context already loaded. The answer comes back in your Antigravity conversation. From Claude Code you can call `ask_antigravity` and get Gemini's read on the same codebase. A shared activity log lets either AI see what the other has been asked.

## How it works

### Antigravity message bus

Antigravity stores transcripts and a live message bus on disk:

```
~/.gemini/antigravity/brain/{session-id}/.system_generated/logs/transcript.jsonl
~/.gemini/antigravity/brain/{session-id}/.system_generated/messages/
```

Writing a JSON file to the messages folder injects a `MESSAGE_PRIORITY_HIGH` SYSTEM message into the live Antigravity session — the AI sees it mid-conversation. AI Bridge wraps this as an MCP tool so Claude Code can push messages directly.

### Session routing

When Antigravity calls `ask_claude`, the bridge runs:

```
claude --continue --fork-session --cwd <project_path>
```

This forks the most recent Claude session for that project — Claude already knows the codebase and conversation history. The live session is untouched. Same in reverse: `ask_antigravity` runs `gemini --resume latest` to pick up Antigravity's most recent session.

If neither AI has worked in that project before, both fall back to a fresh instance in the right directory.

### Two transports, one server

```
node src/server.js        → stdio (Claude Code)
node src/server.js http   → Streamable HTTP on :3099 (Antigravity)
```

Claude Code connects via stdio as usual. Antigravity, which requires HTTP-based MCP servers, connects to `http://localhost:3099/mcp`.

## MCP tools

### `ask_claude`
Ask Claude from Antigravity. Passes your current Antigravity session as context and routes to the most recent Claude session for the project.
```json
{
  "question": "Is this error handling correct?",
  "project_path": "C:/dev/my-project",
  "inject_response": true,
  "model": "claude-sonnet-4-6"
}
```
- `project_path` — picks up the most recent Claude session for that path instead of starting fresh
- `inject_response` — also pushes the reply as a SYSTEM message into your Antigravity session
- `model` — defaults to `claude-sonnet-4-6`; use `claude-opus-4-5` for deeper work

### `ask_antigravity`
Ask Antigravity from Claude Code. Resumes the most recent Gemini session for the project.
```json
{
  "question": "Review this approach and flag any risks",
  "project_path": "C:/dev/my-project",
  "model": "gemini-2.5-pro"
}
```

### `ag_inject_message`
Push a message directly into a live Antigravity session. The AI sees it immediately as a SYSTEM message.
```json
{ "content": "Claude says: the race condition is on line 42", "title": "Claude Code" }
```

### `ag_read_session`
Read the transcript of the active (or any) Antigravity session.
```json
{ "session_id": "optional-uuid", "limit": 30 }
```

### `ag_list_sessions`
List all Antigravity sessions sorted by most recent activity.

### `ag_search`
Full-text search across all Antigravity session transcripts.
```json
{ "query": "auth bug", "limit": 10 }
```

### `get_bridge_activity`
See all recent cross-AI conversations — questions, answers, errors — from either side.
```json
{ "limit": 20 }
```
Useful when you want to catch up on what Antigravity asked while you were working in Claude Code, or vice versa.

## Installation

**Requirements:** Node.js 18+, Claude Code CLI, Antigravity, Gemini CLI (bundled with Antigravity)

### 1. Clone and install

```bash
git clone https://github.com/SheikhMustehsan/ai-bridge
cd ai-bridge
npm install
```

### 2. Register with both tools

```bash
npm run install-mcp
```

This registers the bridge with Claude Code (stdio) and writes the HTTP server URL to Antigravity's MCP config.

Manual setup if you prefer:

**Claude Code:**
```bash
claude mcp add ai-bridge node "/path/to/ai-bridge/src/server.js"
```

**Antigravity** (`~/.gemini/antigravity/mcp_config.json`):
```json
{
  "mcpServers": {
    "ai-bridge": {
      "url": "http://localhost:3099/mcp"
    }
  }
}
```

### 3. Start the HTTP server

Antigravity needs the bridge running before it connects:

```bash
node src/server.js http
```

**Auto-start on Windows (no terminal window):** run this once in PowerShell to create a startup shortcut that launches the included `start-server.vbs` silently:

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\AI Bridge.lnk")
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = '"C:\path\to\ai-bridge\start-server.vbs"'
$shortcut.Save()
```

### 4. Config (optional)

Copy `ai-bridge.config.example.json` to `ai-bridge.config.json` and set your Antigravity brain path if it differs from the default (`~/.gemini/antigravity/brain`).

## Usage

### Ask Claude for a code review from inside Antigravity

Call `ask_claude` from your Antigravity session:
```json
{
  "question": "Review the error handling in the payment flow",
  "project_path": "C:/dev/my-app",
  "inject_response": true
}
```
The bridge forks Claude's most recent session for `my-app`. Claude has the codebase context. The response comes back as text and, with `inject_response: true`, appears as a SYSTEM message in your current Antigravity conversation.

### Get a second opinion from Antigravity while in Claude Code

```
"Ask Antigravity to review the cache layer approach"
```
Claude calls `ask_antigravity`, Gemini resumes its most recent session for the project, and the response comes back for Claude to compare against its own analysis.

### Catch up on cross-AI activity

```
"Show me the bridge activity"
```
Returns a timestamped log of every question either AI asked the other and every answer returned.

## Recursion guard

If Antigravity calls `ask_claude` and Claude then calls `ask_antigravity`, the bridge tracks depth via `AI_BRIDGE_DEPTH` and blocks a third hop. Neither AI can create an infinite loop regardless of what it decides to do.

## Works with OmniContext

AI Bridge pairs with [OmniContext](https://github.com/SheikhMustehsan/omni-context):

- **OmniContext** runs in the background and indexes file edits, tool calls, errors, and solutions from both AIs into a shared searchable database — passive memory that neither AI needs to manage
- **AI Bridge** is the active layer — both AIs can ask each other questions and get answers in real time

OmniContext gives both AIs shared history. AI Bridge gives them a way to talk.

## License

MIT
