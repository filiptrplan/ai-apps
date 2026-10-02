// The MCP server for all apps: one McpServer per request, acting as the
// signed-in user. Each app is a module under ./apps exporting `register`
// (adds its tools, prefixed with the app's name) and `instructions`.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as climbing from "./apps/climbing.js";
import * as recipes from "./apps/recipes.js";

const APPS = [climbing, recipes];

// `deps` is { appData, removePhoto?, callFunction? }; see http.js.
export function createMcpServer(deps) {
  const server = new McpServer(
    { name: "ai-apps", title: "AI Apps", version: "1.0.0" },
    {
      instructions: [
        "Tools for the user's personal apps at apps.trplan.si. Every tool acts on the signed-in user's own data.",
        ...APPS.map(app => app.instructions),
      ].join("\n\n"),
    }
  );
  APPS.forEach(app => app.register(server, deps));
  return server;
}
