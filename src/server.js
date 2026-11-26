#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "http";
import { readSession, listSessions, injectMessage, searchSessions } from "./antigravity.js";
import { askClaude } from "./claude.js";
import { askAntigravity } from "./antigravity-ask.js";
import { getActivity } from "./activity.js";

const PORT = process.env.AI_BRIDGE_PORT ?? 3099;
const MODE = process.argv[2]; // "http" or undefined (stdio)

const TOOLS = [
  {
    name: "ask_claude",
    description: "Ask Claude Code a question. Automatically includes your current Antigravity session as context. Claude's response is returned directly and optionally injected back into your session.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string", description: "The question or task for Claude" },
        include_session_context: { type: "boolean", description: "Include recent Antigravity context (default: true)" },
        inject_response: { type: "boolean", description: "Also inject Claude's response as a SYSTEM message in your session (default: false)" },
        project_path: { type: "string", description: "Project directory path — routes to the most recent Claude session for that project instead of a fresh instance" },
        model: { type: "string", description: "Claude model to use. Defaults to claude-sonnet-4-6. Use claude-opus-4-5 for deep analysis, claude-haiku-4-5 for quick answers." },
      },
    },
  },
  {
    name: "ag_read_session",
    description: "Read the active Antigravity session transcript — recent conversation history of what you asked and what the AI did.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID (omit for most recent)" },
        limit: { type: "number", description: "Messages to return (default: 30)" },
      },
    },
  },
  {
    name: "ag_list_sessions",
    description: "List all Antigravity sessions with timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max sessions (default: 20)" },
      },
    },
  },
  {
    name: "ag_inject_message",
    description: "Inject a message into the active Antigravity session as a high-priority SYSTEM message.",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string" },
        title: { type: "string", description: "Title shown in Antigravity (default: 'Claude Code')" },
        session_id: { type: "string", description: "Target session (omit for most recent)" },
      },
    },
  },
  {
    name: "ask_antigravity",
    description: "Ask Antigravity (Gemini) a question from Claude Code. Automatically resumes the most recent Gemini session for the project so it has full context. Use this when you want a second opinion from Antigravity's AI without switching tabs.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string", description: "The question or task for Antigravity" },
        project_path: { type: "string", description: "Project directory — Antigravity resumes its most recent session there" },
        model: { type: "string", description: "Gemini model override (e.g. gemini-2.5-pro). Defaults to Antigravity's configured model." },
      },
    },
  },
  {
    name: "get_bridge_activity",
    description: "Show recent cross-AI conversations — questions Antigravity asked Claude and vice versa. Use this in Claude Code to see what Antigravity has been asking while you were away.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent interactions to return (default: 20)" },
      },
    },
  },
  {
    name: "ag_search",
    description: "Search across all Antigravity session transcripts.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
    },
  },
];

function makeServer() {
  const server = new Server(
    { name: "ai-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "ask_claude": {
          const includeCtx = args?.include_session_context !== false;
          let context = null;
          if (includeCtx) { try { context = readSession(null, 20); } catch {} }
          const response = await askClaude(args.question, context, args?.project_path ?? null, args?.model ?? null);
          if (args?.inject_response) injectMessage(response, "Claude Code");
          return { content: [{ type: "text", text: response }] };
        }
        case "ag_read_session":
          return { content: [{ type: "text", text: JSON.stringify(readSession(args?.session_id, args?.limit ?? 30), null, 2) }] };
        case "ag_list_sessions":
          return { content: [{ type: "text", text: JSON.stringify(listSessions(args?.limit ?? 20), null, 2) }] };
        case "ag_inject_message":
          return { content: [{ type: "text", text: injectMessage(args.content, args?.title ?? "Claude Code", args?.session_id) }] };
        case "ask_antigravity": {
          const response = await askAntigravity(args.question, args?.project_path ?? null, args?.model ?? null);
          return { content: [{ type: "text", text: response }] };
        }
        case "get_bridge_activity": {
          const activity = getActivity(args?.limit ?? 20);
          if (!activity.length) return { content: [{ type: "text", text: "No bridge activity logged yet." }] };
          const formatted = activity.map(a => {
            const time = new Date(a.timestamp).toLocaleString();
            const direction = `[${a.from.toUpperCase()} → ${a.to.toUpperCase()}]`;
            const q = `Q: ${a.question}`;
            const r = a.error ? `ERROR: ${a.error}` : `A: ${a.response}`;
            return `${time} ${direction}\n${q}\n${r}`;
          }).join("\n\n---\n\n");
          return { content: [{ type: "text", text: formatted }] };
        }
        case "ag_search":
          return { content: [{ type: "text", text: JSON.stringify(searchSessions(args.query, args?.limit ?? 10), null, 2) }] };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
  });

  return server;
}

if (MODE === "http") {
  // Streamable HTTP mode — for Antigravity (MCP spec 2025)
  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    const parsed = new URL(req.url, "http://localhost");

    if (parsed.pathname === "/mcp") {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = makeServer();
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    if (parsed.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "0.1.0" }));
      return;
    }

    res.writeHead(404); res.end();
  });

  httpServer.listen(PORT, () => {
    console.error(`ai-bridge HTTP server running on port ${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
  });
} else {
  // Stdio mode — for Claude Code
  const transport = new StdioServerTransport();
  await makeServer().connect(transport);
}
