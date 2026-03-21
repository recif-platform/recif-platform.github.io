---
sidebar_position: 8
---

# Event System

Corail includes an in-process event bus for runtime observability. Components emit events as they execute; subscribers react asynchronously. This is a lightweight pub/sub for a single agent Pod, not a distributed message broker.

## EventBus

```python
from corail.events.bus import EventBus
from corail.events.types import Event, EventType

bus = EventBus()

# Subscribe to a specific event type
async def on_tool_called(event: Event):
    print(f"Tool called: {event.data['name']}")

bus.subscribe(EventType.TOOL_CALLED, on_tool_called)

# Subscribe to ALL events (wildcard)
async def audit_log(event: Event):
    print(f"[{event.type.value}] {event.data}")

bus.subscribe("*", audit_log)

# Emit an event
await bus.emit(Event(
    type=EventType.TOOL_CALLED,
    agent_id="my-agent",
    data={"name": "calculator", "args": {"expression": "2+2"}},
))
```

Key behaviors:

- Handlers run concurrently via `asyncio.gather`
- Errors in handlers are logged, never raised to the emitter
- History is kept (last 1000 events), accessible via `bus.history`
- `emit_sync` for fire-and-forget from synchronous code

## Event types

All events are defined in the `EventType` enum:

### Message lifecycle

| Event | Emitted when |
|-------|-------------|
| `message.received` | User input arrives |
| `message.response` | Final response is ready |

### LLM

| Event | Emitted when |
|-------|-------------|
| `thinking.started` | LLM begins reasoning |
| `thinking.completed` | LLM finishes reasoning |
| `llm.call.started` | LLM API call begins (includes round number) |
| `llm.call.completed` | LLM API call returns (includes stop_reason) |
| `llm.token` | A single token is generated |

### Tool execution

| Event | Emitted when |
|-------|-------------|
| `tool.called` | Tool is invoked (includes name and args) |
| `tool.result` | Tool returns successfully (includes output) |
| `tool.error` | Tool fails (includes error and attempt number) |

### Guards

| Event | Emitted when |
|-------|-------------|
| `guard.input.checked` | Input guard passed |
| `guard.output.checked` | Output guard passed |
| `guard.blocked` | A guard blocked content (includes direction and reason) |

### Memory

| Event | Emitted when |
|-------|-------------|
| `memory.retrieved` | Conversation history loaded |
| `memory.updated` | New message stored |

### Retrieval / RAG

| Event | Emitted when |
|-------|-------------|
| `retrieval.searched` | Vector search executed |
| `retrieval.results` | Retrieval results available |

### Budget

| Event | Emitted when |
|-------|-------------|
| `budget.warning` | Approaching budget limit |
| `budget.exceeded` | Max rounds or tokens reached |

### Agent lifecycle

| Event | Emitted when |
|-------|-------------|
| `agent.started` | Agent Pod starts |
| `agent.stopped` | Agent Pod stops |
| `agent.error` | Unrecoverable error |

### Turn lifecycle

Emitted around each round of the agent loop. Useful for observability,
stream UX, and MLflow child spans.

| Event | Emitted when |
|-------|-------------|
| `turn.started` | A new reasoning round begins (includes `round` index) |
| `turn.ended` | The round ends. Only emitted at the terminal exit of the loop, and carries the real `stop_reason` (one of `StopReason`: `end_turn`, `max_rounds`, `token_budget`, `tool_error`, `guard_blocked`, `user_aborted`). |

### Session

| Event | Emitted when |
|-------|-------------|
| `session.created` | New conversation started |
| `session.ended` | Conversation ended |

### Control plane

| Event | Emitted when |
|-------|-------------|
| `control.config.updated` | Configuration changed at runtime |
| `control.tools.reload` | Tool reload requested |
| `control.kbs.reload` | Knowledge base reload requested |
| `control.agent.paused` | Agent paused by platform |
| `control.agent.resumed` | Agent resumed by platform |

## Event dataclass

```python
@dataclass
class Event:
    type: EventType                    # Required
    timestamp: datetime                # Auto-set to UTC now
    agent_id: str = ""                 # Agent that emitted
    user_id: str = ""                  # User context
    session_id: str = ""               # Conversation context
    data: dict[str, Any] = {}          # Arbitrary payload

    def to_dict(self) -> dict:         # JSON-serializable
        ...
```

## Integration with the agent strategy

The `agent-react` strategy creates an `EventBus` automatically via its
initializer. The bus receives events throughout the execution cycle:

1. `MESSAGE_RECEIVED` -- user input accepted
2. `TURN_STARTED` -- each reasoning round (one per LLM call)
3. `LLM_CALL_STARTED` / `LLM_CALL_COMPLETED`
4. `TOOL_CALLED` / `TOOL_RESULT` / `TOOL_ERROR` -- tool execution
5. `GUARD_BLOCKED` -- if a guard rejects content
6. `BUDGET_EXCEEDED` -- if limits are hit
7. `TURN_ENDED` -- one final event carrying the `StopReason`
8. `MESSAGE_RESPONSE` -- final response ready

The MLflow tracing listener (`corail/tracing/mlflow_listener.py`)
subscribes to `TOOL_CALLED` / `TOOL_RESULT` / `TOOL_ERROR` and collects
them into contextvar storage. The channel layer then turns each
collected event into a `tool:<name>` child span inside the
`@mlflow.trace`-decorated chat handler, so every request produces a
full trace tree without requiring strategies to know about MLflow
directly.
