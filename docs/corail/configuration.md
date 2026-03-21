---
sidebar_position: 2
---

# Configuration

Corail is configured via `CORAIL_*` environment variables. CLI flags override env vars when using the CLI entry point.

## Environment variables

All variables use the `CORAIL_` prefix and are defined in `corail/config.py` using [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/).

| Variable | Default | Description |
|----------|---------|-------------|
| `CORAIL_CHANNEL` | `rest` | I/O channel: `rest` |
| `CORAIL_STRATEGY` | `simple` | Execution strategy: `simple` |
| `CORAIL_MODEL_TYPE` | `stub` | LLM provider: `stub`, `ollama`, `openai`, `anthropic`, `google-ai`, `vertex-ai`, `bedrock`. See [LLM Providers](./llm-providers.md). |
| `CORAIL_MODEL_ID` | `stub-echo` | Model identifier (e.g., `gpt-4`, `claude-sonnet-4-20250514`, `gemini-2.5-flash`, `qwen3.5:35b`) |
| `CORAIL_SYSTEM_PROMPT` | `You are a helpful assistant.` | System prompt text |
| `CORAIL_STORAGE` | `memory` | Storage backend: `memory`, `postgresql` |
| `CORAIL_DATABASE_URL` | _(empty)_ | PostgreSQL connection string (required when `storage=postgresql`) |
| `CORAIL_PORT` | `8000` | HTTP server port |
| `CORAIL_HOST` | `0.0.0.0` | HTTP server bind address |
| `CORAIL_ENV` | `dev` | Environment name |
| `CORAIL_LOG_LEVEL` | `INFO` | Log level |
| `CORAIL_LOG_FORMAT` | `json` | Log format |
| `CORAIL_TOOLS` | _(empty)_ | JSON array of tool configs (injected by operator from Tool CRDs) |
| `CORAIL_KNOWLEDGE_BASES` | _(empty)_ | JSON array of KB configs (injected by operator from Agent CRD `knowledgeBases`) |
| `CORAIL_BACKGROUND_MODEL` | _(empty)_ | `provider:model_id` URI for cheap background work — memory extraction, follow-up suggestions, auto titles. When empty, background tasks reuse the main chat model. See [Background model](../recif/agent-settings.md#background-model). |
| `CORAIL_OLLAMA_TIMEOUT` | `300` | HTTP timeout (seconds) for calls to Ollama. Bump for large local models on slow hardware. |
| `CORAIL_OLLAMA_KEEP_ALIVE` | `30m` | How long Ollama keeps each model loaded after a request. Needs to be long enough to hold the chat model **and** the background model simultaneously, otherwise every turn pays a reload cost. |
| `CORAIL_SUGGESTIONS_TIMEOUT` | `15` | Hard deadline (seconds) for follow-up suggestion generation. Beyond this, the SSE stream closes without suggestions so proxies don't drop mid-chunk. |
| `CORAIL_RECIF_GRPC_ADDR` | `localhost:50051` | Recif gRPC control plane address |
| `CORAIL_JWT_PUBLIC_KEY` | _(empty)_ | JWT public key for auth (optional, used with Istio trusted headers) |

### CORAIL_TOOLS format

Set automatically by the operator when the Agent CRD has `spec.tools`. Manual example:

```json
[
  {
    "name": "weather",
    "type": "http",
    "endpoint": "https://api.weather.com/v1/{city}",
    "method": "GET",
    "parameters": [
      {"name": "city", "type": "string", "description": "City name", "required": true}
    ]
  },
  {
    "name": "kubectl",
    "type": "cli",
    "binary": "kubectl",
    "allowedCommands": ["get", "describe", "logs"],
    "timeout": 15,
    "parameters": [
      {"name": "command", "type": "string", "description": "Subcommand"}
    ]
  }
]
```

### CORAIL_KNOWLEDGE_BASES format

Set automatically by the operator when the Agent CRD has `spec.knowledgeBases`. Each entry creates a `search_{kb_slug}` tool that the agent calls through its react loop when the question is relevant. Manual example:

```json
[
  {
    "kb_id": "product-docs",
    "name": "product-docs",
    "description": "Documents and knowledge about product-docs",
    "connection_url": "postgresql://user:pass@host:5432/db",
    "embedding_provider": "ollama",
    "embedding_model": "nomic-embed-text"
  }
]
```

The `description` field helps the LLM decide when to call the search tool. If omitted, a default is generated from the KB name.

## CLI flags

When using the CLI entry point (`corail` command), flags override environment variables:

```bash
corail \
  --channel rest \
  --strategy simple \
  --model-type ollama \
  --model-id qwen3.5:35b \
  --system-prompt "You are a marine biologist." \
  --storage postgresql \
  --port 8000
```

Available flags:

| Flag | Env var equivalent |
|------|--------------------|
| `--channel` | `CORAIL_CHANNEL` |
| `--strategy` | `CORAIL_STRATEGY` |
| `--model-type` | `CORAIL_MODEL_TYPE` |
| `--model-id` | `CORAIL_MODEL_ID` |
| `--system-prompt` | `CORAIL_SYSTEM_PROMPT` |
| `--storage` | `CORAIL_STORAGE` |
| `--port` | `CORAIL_PORT` |
| `--tools` | `CORAIL_TOOLS` |
| `--knowledge-bases` | `CORAIL_KNOWLEDGE_BASES` |

## Kubernetes configuration

In Kubernetes, the operator creates a ConfigMap from the Agent CRD spec and injects it into the Pod via `envFrom`. You do not set these variables manually -- they are derived from the Agent resource:

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-agent
  namespace: team-default
spec:
  name: "My Agent"
  framework: adk
  strategy: simple          # -> CORAIL_STRATEGY
  channel: rest             # -> CORAIL_CHANNEL
  modelType: ollama         # -> CORAIL_MODEL_TYPE
  modelId: qwen3.5:35b     # -> CORAIL_MODEL_ID
  systemPrompt: "..."      # -> CORAIL_SYSTEM_PROMPT
  storage: postgresql       # -> CORAIL_STORAGE
  databaseUrl: "postgres://..." # -> CORAIL_DATABASE_URL
```

The operator generates a ConfigMap named `{agent-name}-config` containing:

```
CORAIL_CHANNEL=rest
CORAIL_STRATEGY=simple
CORAIL_MODEL_TYPE=ollama
CORAIL_MODEL_ID=qwen3.5:35b
CORAIL_SYSTEM_PROMPT=...
CORAIL_STORAGE=postgresql
CORAIL_DATABASE_URL=postgres://...
```
