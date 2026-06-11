import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const server = new McpServer({
  name: "manifold-triage-mcp",
  version: "1.0.0",
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});


server.tool(
  "triage_ticket",
  "Analyzes a support ticket and returns structured triage data including issue type, urgency, suggested response, and escalation recommendation.",
  {
    ticket_text: z.string().describe("The full text of the support ticket to analyze"),
  },
  async ({ ticket_text }) => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a support triage assistant for Manifold, an AI platform for life sciences research.

Analyze the following support ticket and respond ONLY with a JSON object. No explanation, no markdown, just raw JSON.

The JSON must have exactly these fields:
- issue_type: a short category label (e.g. "API Error", "Documentation Gap", "Data Loss", "Model Accuracy", "Billing", "Access/Permissions")
- urgency: one of "low", "medium", "high", or "critical"
- suggested_response: a professional, empathetic draft reply to send to the customer
- escalate_to_human: true or false
- escalation_reason: a brief explanation if escalate_to_human is true, otherwise null

Ticket:
${ticket_text}`,
        },
      ],
    });

    const rawText = response.content[0].text;
    const parsed = JSON.parse(rawText);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(parsed, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Manifold Triage MCP server running");
}

main();