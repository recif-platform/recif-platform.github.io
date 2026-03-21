---
sidebar_position: 5
---

# Importing Skills from External Ecosystems

Corail agents gain capabilities through **tools**. Rather than wrapping entire external frameworks (LangChain, CrewAI, Claude Code, etc.) behind adapter layers, Récif takes a different approach: **import their tools** as native Corail tools.

## Why Import, Not Wrap

Wrapping a framework means running its agent loop alongside Corail's own `agent-react` strategy. This creates three problems:

1. **Double configuration** -- You configure the LLM provider once in Corail and again in the wrapped framework. Two sets of API keys, two sets of model parameters, two places to debug when something breaks.
2. **Maintenance burden** -- Every upstream framework release can break the wrapper. You become a permanent adapter maintainer.
3. **No unified observability** -- Tool calls inside the wrapped framework are invisible to Corail's event system, guards, and budget tracking. You lose audit trails and cost control.

The solution: extract the **tools** that make these ecosystems valuable and register them as standard Corail tools. Your `agent-react` strategy already handles planning, self-correction, memory, guards, RAG, budget, and native tool calling. You don't need another framework's agent loop. You need their tools.

## Importing OpenClaw / ClawHub Skills

[OpenClaw](https://github.com/openclaw) skills are standalone CLI binaries with a `SKILL.md` doc describing their capabilities. They map directly to Corail's `cli` tool type.

### Steps

**1. Install the CLI binary in the agent container image**

```dockerfile
FROM recif/corail-base:latest

# Install OpenClaw skills
COPY --from=ghcr.io/openclaw/goplaces:latest /usr/local/bin/goplaces /usr/local/bin/goplaces
COPY --from=ghcr.io/openclaw/himalaya:latest /usr/local/bin/himalaya /usr/local/bin/himalaya
COPY --from=ghcr.io/openclaw/summarize:latest /usr/local/bin/summarize /usr/local/bin/summarize
```

**2. Create a Tool CRD of type `cli`**

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: goplaces
  namespace: team-default
spec:
  name: goplaces
  type: cli
  description: "Search Google Maps for places"
  binary: /usr/local/bin/goplaces
  allowedCommands: ["search", "details", "resolve"]
  parameters:
    - name: command
      type: string
      required: true
    - name: query
      type: string
      required: true
  secretRef: google-places-api-key
```

**3. Assign to agent**

```yaml
spec:
  tools: ["goplaces"]
```

**4. Done** -- the agent can now use it via ReAct.

### More examples

```yaml
# himalaya -- email via IMAP
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: himalaya
  namespace: team-default
spec:
  name: himalaya
  type: cli
  description: "Read, send, and manage emails via IMAP"
  binary: /usr/local/bin/himalaya
  allowedCommands: ["list", "read", "send", "reply", "forward"]
  parameters:
    - name: command
      type: string
      required: true
    - name: account
      type: string
      required: false
  secretRef: imap-credentials
```

```yaml
# summarize -- video/podcast summarizer
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: summarize
  namespace: team-default
spec:
  name: summarize
  type: cli
  description: "Summarize a video or podcast from a URL"
  binary: /usr/local/bin/summarize
  allowedCommands: ["url", "file"]
  parameters:
    - name: command
      type: string
      required: true
    - name: source
      type: string
      required: true
    - name: format
      type: string
      required: false
  timeout: 120
```

## Importing Claude Code Skills

Claude Code uses a small set of powerful tools: `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`. You can give a Corail agent equivalent capabilities using CLI tools pointed at standard Unix binaries.

### File reading

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: file-reader
spec:
  name: file-reader
  type: cli
  binary: /usr/bin/cat
  allowedCommands: []  # cat doesn't have subcommands
  description: "Read file contents"
  risk_level: safe
  parameters:
    - name: path
      type: string
      required: true
```

### File search

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: grep-search
spec:
  name: grep-search
  type: cli
  binary: /usr/bin/grep
  allowedCommands: []
  description: "Search for patterns in files"
  risk_level: safe
  parameters:
    - name: pattern
      type: string
      required: true
    - name: path
      type: string
      required: true
```

### Shell execution (with human-in-the-loop)

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: shell
spec:
  name: shell
  type: cli
  binary: /bin/bash
  allowedCommands: ["-c"]
  description: "Execute shell commands"
  risk_level: confirm  # Agent must ask user confirmation
  parameters:
    - name: command
      type: string
      required: true
```

With `risk_level: confirm`, the agent emits a `ConfirmEvent` before executing. The user must approve the command in the dashboard or chat interface. This is Human-in-the-Loop -- the agent reasons about what to run, but the human decides whether it actually executes.

## Importing LangChain Tools

LangChain tools are Python functions decorated with `@tool`. They cannot be used as CLI binaries, but they can be exposed as HTTP endpoints and consumed as Corail HTTP tools.

### Steps

**1. Create a small FastAPI service that exposes the LangChain tool**

```python
# langchain_tools_service.py
from fastapi import FastAPI
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper

app = FastAPI()
wiki = WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper())

@app.post("/wikipedia/search")
async def search(query: str):
    result = wiki.run(query)
    return {"result": result}
```

**2. Deploy it as a Kubernetes Service**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: langchain-tools
spec:
  selector:
    app: langchain-tools
  ports:
    - port: 8000
```

**3. Create an HTTP Tool CRD pointing to that service**

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: wikipedia
spec:
  name: wikipedia
  type: http
  description: "Search Wikipedia articles"
  endpoint: "http://langchain-tools:8000/wikipedia/search"
  method: POST
  parameters:
    - name: query
      type: string
      required: true
```

The agent calls it like any other HTTP tool. The LangChain dependency is isolated in its own container -- it never touches Corail's runtime.

## Importing MCP Server Tools (future)

When the `MCPExecutor` is implemented, MCP servers will auto-register their tools. Each MCP server runs as a sidecar or standalone service, and the `mcp` tool type handles protocol negotiation automatically.

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: github-mcp
spec:
  name: github-mcp
  type: mcp
  mcpEndpoint: "http://mcp-github:3000"
  description: "GitHub operations via MCP"
```

MCP tools will inherit the same observability, guards, and budget tracking as every other tool type.

## Summary

| Ecosystem | Import method | Tool type | Example |
|-----------|--------------|-----------|---------|
| OpenClaw / ClawHub | Install CLI binary | `cli` | goplaces, himalaya, summarize |
| Claude Code | CLI wrappers around Unix tools | `cli` | cat, grep, bash |
| LangChain | HTTP wrapper service | `http` | Wikipedia, Google Search |
| Custom APIs | Direct HTTP | `http` | Jira, Slack, Datadog |
| MCP Servers | MCP connector (future) | `mcp` | GitHub, databases |

## Best Practice

Don't wrap frameworks. Import their tools. Your `agent-react` already has:

- **Planning** -- breaks down complex tasks into steps
- **Self-correction** -- retries on failure with adjusted parameters
- **Memory** -- remembers context across sessions
- **Guards** -- enforces security policies on every tool call
- **RAG** -- retrieves from knowledge bases before answering
- **Budget** -- tracks and limits token and cost usage
- **Native tool calling** -- Anthropic, Bedrock, and Vertex AI function calling

You don't need another framework's agent loop. You need their tools.
