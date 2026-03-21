---
sidebar_position: 1
---

# Corail Runtime

Corail is the autonomous Python agent runtime that powers every agent in the Récif platform. Each agent runs as its own container (Pod), configured entirely via environment variables or CLI flags.

## Entry points

Corail has two entry points depending on the deployment mode:

### CLI mode (legacy pipeline)

```bash
corail --channel rest --strategy agent-react --model-type ollama --model-id qwen3.5:35b
```

The CLI (`corail/cli.py`) builds a pipeline from factory classes:

1. `ModelFactory.create()` -- instantiates the LLM backend
2. `StrategyFactory.create()` -- wraps the model in a strategy
3. `Pipeline` -- connects strategy to channel
4. `ChannelFactory.create()` -- starts the I/O channel (e.g., REST server)

### FastAPI mode (production)

```bash
uvicorn corail.main:app --host 0.0.0.0 --port 8000
```

The FastAPI application (`corail/main.py`) provides:

- `/api/v1/agents/{agent_id}/chat` -- SSE streaming chat endpoint
- `/ws/{agent_id}` -- WebSocket endpoint
- `/healthz` -- Health check (always 200)
- `/readyz` -- Readiness check (includes Récif gRPC connectivity status)

It uses an `AdapterRegistry` to resolve framework adapters (ADK) and LLM adapters (stub) at startup.

## Registry pattern

All pluggable components use the same pattern: a dictionary mapping names to `(module_path, class_name)` tuples, resolved via `importlib.import_module()` at runtime.

```python
# Example: Model registry
_REGISTRY = {
    "stub":      ("corail.models.stub",      "StubModel",      "stub-echo"),
    "ollama":    ("corail.models.ollama",     "OllamaModel",    "qwen3.5:35b"),
    "openai":    ("corail.models.openai",     "OpenAIModel",    "gpt-4"),
    "anthropic": ("corail.models.anthropic",  "AnthropicModel", "claude-sonnet-4-20250514"),
}
```

To add a new model provider, call `register_model()` with the module path and class name. The module is only imported when the model type is first requested.

## Available components

### Channels

| Name | Module | Description |
|------|--------|-------------|
| `rest` | `corail.channels.rest` | HTTP REST API via FastAPI |

### Strategies

| Name | Module | Description |
|------|--------|-------------|
| `agent-react` | `corail.strategies.agent` | Unified strategy -- dynamically adapts: planning, tool calling, RAG, guards, memory, self-correction |

The `agent-react` strategy is the default and recommended choice. It replaces the previous `simple`, `react`, `react_v2`, and `rag` strategies by adapting its behavior based on what is available (tools, knowledge bases, model capabilities). See [Strategies](/docs/corail/strategies) for details.

### Models

| Name | Module | Default model ID |
|------|--------|-----------------|
| `stub` | `corail.models.stub` | `stub-echo` |
| `ollama` | `corail.models.ollama` | `qwen3.5:35b` |
| `openai` | `corail.models.openai` | `gpt-4` |
| `anthropic` | `corail.models.anthropic` | `claude-sonnet-4-20250514` |
| `vertex-ai` | `corail.models.vertex` | `gemini-2.5-flash` |
| `google-ai` | `corail.models.google_ai` | `gemini-2.5-flash` |
| `bedrock` | `corail.models.bedrock` | `anthropic.claude-sonnet-4-20250514-v1:0` |

### Storage

| Name | Module | Description |
|------|--------|-------------|
| `memory` | `corail.storage.memory` | In-memory, ephemeral (default) |
| `postgresql` | `corail.storage.postgresql` | Persistent via asyncpg |

### Adapters

| Type | Name | Module |
|------|------|--------|
| Framework | `adk` | `corail.adapters.frameworks.adk` |
| LLM | `stub` | `corail.adapters.llms.stub` |

## Docker image

```bash
cd corail
docker build -t corail:latest .
```

The image runs the FastAPI server on port 8000 by default. In Kubernetes, the operator injects `CORAIL_*` environment variables via a ConfigMap.
