# manifold-triage-mcp

A local MCP (Model Context Protocol) server that triages support tickets using the Claude API. Built as a demonstration of AI-powered support tooling for life sciences platforms.

---

## What This Is

Support teams at technical companies deal with a high volume of incoming tickets that vary wildly in severity: from a researcher who can't find an export button to a pipeline that's down and blocking an entire team. Triaging those tickets manually takes time and introduces inconsistency.

This tool automates the first pass. Given the text of a support ticket, it returns structured output: what kind of issue it is, how urgent it is, a draft response to send to the customer, and a recommendation on whether a human needs to get involved.

It's built as an MCP server rather than a standalone script, which means it's discoverable and callable directly from Claude Desktop. No terminal commands, no copy-pasting between tools: you hand it a ticket in conversation and it hands back structured triage data.

---

## How It Works

There are three actors in the system:

**Claude Desktop** is the host, the interface the user talks to. It manages the conversation and decides when to call a tool.

**This MCP server** is the capability layer. It tells Claude Desktop: here is a tool called `triage_ticket`, here is what it accepts as input, here is what it returns. The server runs as a local child process that Claude Desktop launches and communicates with over stdio.

**The `triage_ticket` tool** is the function inside the server. When called, it takes the ticket text, sends it to the Claude API with a structured prompt, parses the response, and returns JSON.

The flow:

```
User pastes a ticket into Claude Desktop
    ↓
Claude Desktop calls triage_ticket with the ticket text
    ↓
MCP server sends the ticket to the Claude API (claude-sonnet-4-6)
    ↓
Claude returns structured JSON analysis
    ↓
MCP server returns the result to Claude Desktop
    ↓
Claude Desktop presents the triage output in conversation
```

---

## Project Structure

```
manifold-triage-mcp/
│
├── src/
│   └── index.js       ← The entire MCP server: imports, server setup, tool registration, startup
│
├── .env               ← Your Anthropic API key (never committed to GitHub)
├── .gitignore         ← Excludes .env and node_modules from version control
├── package.json       ← Project metadata, dependencies, and start script
├── package-lock.json  ← Exact dependency version lock (auto-generated)
└── README.md          ← This file
```

---

## Tech Stack

**`@modelcontextprotocol/sdk`** - Anthropic's official SDK for building MCP servers. Handles the protocol layer, the handshake between this server and Claude Desktop, so the implementation focuses on tool logic rather than protocol mechanics.

**`@anthropic-ai/sdk`** - The official Anthropic SDK for calling the Claude API. Used inside the tool handler to send the ticket and receive structured JSON back.

**`zod`** - Schema validation library. Defines and enforces the input contract for the tool: in this case, that `ticket_text` must be a string. If something invalid is passed in, Zod catches it before it reaches the handler.

**`dotenv`** - Loads the `.env` file into `process.env` at startup so the API key is available in memory without ever being hardcoded in the source.

---

## Design Decisions

**Why MCP instead of a standalone script?**

A standalone script requires the user to know it exists, know how to invoke it, and manually pipe inputs and outputs. An MCP server is discoverable: Claude Desktop can call it based on context, combine it with other tools in the same conversation, and use it without the user needing to touch a terminal. The server also follows a typed contract (inputs and outputs are validated), which makes it predictable and auditable. In a regulated environment like life sciences, those properties matter.

**Why `claude-sonnet-4-6` and not Haiku or Opus?**

This tool has two jobs: classify the ticket and draft a customer-facing response. Haiku handles classification well but produces flatter prose. For a customer-facing reply, especially on a high-stakes ticket like a data loss incident, response quality matters. Opus would be overkill and expensive at scale. Sonnet hits the right balance: strong writing quality for a professional response, fast enough and cost-effective enough for production volume. At scale, a reasonable optimization would be to use Haiku for classification and Sonnet only when drafting the response.

**Why these five output fields?**

`issue_type` and `urgency` drive routing and prioritization. `suggested_response` reduces the time to first reply and ensures consistent tone. `escalate_to_human` and `escalation_reason` make the handoff decision explicit and documented rather than implicit: important in any environment where accountability matters.

**Why stdio instead of HTTP?**

Claude Desktop communicates with local MCP servers by launching them as child processes and reading their output directly, not by making HTTP requests. Stdio is simpler, requires no port configuration, and avoids network-related failure modes for local tooling.

---

## Setup

### Prerequisites

- Node.js v18 or higher
- An Anthropic API key ([get one here](https://console.anthropic.com))
- Claude Desktop installed

### Installation

```bash
# Clone the repo
git clone https://github.com/ToddLGarrison/manifold-triage-mcp.git
cd manifold-triage-mcp

# Install dependencies
npm install
```

### Configuration

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your_api_key_here
```

### Connect to Claude Desktop

Open your Claude Desktop config file:

```bash
# macOS
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add the following entry inside the `mcpServers` object:

```json
"manifold-triage-mcp": {
  "command": "/path/to/your/node",
  "args": ["/path/to/manifold-triage-mcp/src/index.js"],
  "env": {
    "ANTHROPIC_API_KEY": "your_api_key_here"
  }
}
```

To find your exact Node path:

```bash
which node
```

Fully quit and relaunch Claude Desktop after saving the config. To confirm the server is running, go to **Settings > Local MCP Servers**: you should see `manifold-triage-mcp` with a green **running** badge.

### Run manually (optional)

```bash
npm start
```

You should see: `Manifold Triage MCP server running`

---

## Sample Output

**Input ticket:**
> Our API is returning a 500 error when we call the /analyze endpoint with a FASTQ file larger than 2GB. This started happening this morning and is blocking our entire research pipeline.

**Output:**
```json
{
  "issue_type": "API Error",
  "urgency": "critical",
  "suggested_response": "Thank you for reaching out. We've received your report on the 500 error hitting /analyze with FASTQ files over 2GB and are treating this as high priority. Since it started this morning, a recent change may have introduced a regression in large file handling. To investigate quickly, could you provide your API key or org ID, a sample request ID or timestamp of a failed call, and any error message body returned with the 500? As a short-term workaround, consider splitting the FASTQ file into chunks under 2GB while we work on a fix. Engineering has been alerted and we'll keep you updated.",
  "escalate_to_human": true,
  "escalation_reason": "Active 500 error on a core API endpoint blocking the customer's entire research pipeline, with same-day onset suggesting a potential recent regression: requires immediate engineering investigation."
}
```

---

## Test Tickets

Four tickets designed to test meaningful distinctions in urgency and escalation logic:

**API Error - Critical**
> Our API is returning a 500 error when we call the /analyze endpoint with a FASTQ file larger than 2GB. This started happening this morning and is blocking our entire research pipeline.

**Documentation Gap - Medium**
> We can't figure out how to export our results to CSV. The docs mention it but don't show the actual steps. We've been trying for two days.

**Data Loss - Critical**
> One of our researchers accidentally deleted an entire project with three months of genomics analysis. Is there any way to recover it? This is catastrophic for our team.

**Model Accuracy - High**
> The model returned a confidence score of 0.97 on our sample but our lead biologist says the result looks completely wrong. We're starting to question whether we can trust the platform for our research. Should we be concerned?

---

## What's Next

**`identify_documentation_gaps` tool:** A second tool that accepts a batch of tickets and returns suggested knowledge base articles based on recurring themes. If multiple tickets ask the same question, that's a documentation gap that needs to be resolved.

**Ticket system integration:** In production, this would connect to Zendesk, Jira Service Management, or a similar platform via API rather than accepting raw text. The tool interface stays the same; the data source changes.

**Routing rules:** `urgency` and `issue_type` could drive automatic assignment to the right queue or team rather than just flagging for human review.

**Confidence scoring:** Adding a confidence field to the output would let downstream systems decide whether to auto-send the suggested response or hold it for human review based on how certain the model is.

**Audit logging:** In a regulated environment, every triage decision should be logged with the input, output, model version, and timestamp. That's a thin layer on top of what's already here.

---

## Author

Todd Garrison · [GitHub](https://github.com/ToddLGarrison) · [LinkedIn](https://linkedin.com/in/toddgarrison)