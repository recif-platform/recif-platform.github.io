---
sidebar_position: 10
---

# AG-UI (Agent Generated UI)

Corail agents produce rich structured content during streaming, not just text tokens. The AG-UI protocol defines a set of `StreamEvent` types that strategies emit alongside plain text. The channel layer serializes these events into the appropriate wire format (SSE, WebSocket).

## Stream protocol

Strategies yield a union type during streaming:

```python
StreamToken = str | StreamEvent
```

Plain `str` tokens are text fragments. `StreamEvent` subclasses carry structured data that the dashboard renders as interactive UI components.

## Event types

### ToolStartEvent

Emitted when a tool execution begins.

```python
@dataclass
class ToolStartEvent(StreamEvent):
    tool: str                          # Tool name
    args: dict[str, Any] = {}          # Arguments passed
    call_id: str = ""                  # Unique call ID (for native tool_use)
```

SSE payload:

```json
{"type": "tool_start", "tool": "kubectl", "args": {"command": "get pods"}, "call_id": "toolu_01..."}
```

### ToolEndEvent

Emitted when a tool execution completes.

```python
@dataclass
class ToolEndEvent(StreamEvent):
    tool: str                          # Tool name
    output: str = ""                   # Tool output text
    success: bool = True               # Whether execution succeeded
    call_id: str = ""                  # Matching call ID
```

### ConfirmEvent

Emitted when a tool has `risk_level: confirm`. The dashboard shows a confirmation dialog before proceeding.

```python
@dataclass
class ConfirmEvent(StreamEvent):
    call_id: str                       # Unique call ID
    tool: str                          # Tool requesting confirmation
    args: dict[str, Any] = {}          # Arguments to review
    message: str = ""                  # Human-readable prompt
```

SSE payload:

```json
{"type": "confirm", "confirm": {"id": "toolu_01...", "tool": "kubectl", "args": {"command": "delete pod x"}, "message": "Execute kubectl?"}}
```

### ComponentEvent

Emitted when a tool returns structured data that should render as a UI component instead of plain text.

```python
@dataclass
class ComponentEvent(StreamEvent):
    component: str                     # Component type or React component name
    props: dict[str, Any] = {}         # Props passed to the component
```

SSE payload:

```json
{"type": "component", "component": "table", "props": {"columns": [...], "rows": [...]}}
```

## Risk levels

Each tool declares a `risk_level` in its `ToolDefinition`:

| Level | Behavior |
|-------|----------|
| `safe` | Execute immediately, no confirmation needed |
| `confirm` | Emit `ConfirmEvent`, wait for human approval |
| `blocked` | Never execute this tool |

```python
ToolDefinition(
    name="kubectl_delete",
    description="Delete a Kubernetes resource",
    risk_level="confirm",
    parameters=[...],
)
```

## Render hints

Tools return a `ToolResult` with optional render hints that control how the dashboard displays the output:

```python
@dataclass
class ToolResult:
    success: bool
    output: str
    render: str = "text"      # text, table, chart, json, code, react
    component: str = ""       # React component name (when render="react")
    props: dict = {}          # Props for the component
```

| Render | Dashboard behavior |
|--------|-------------------|
| `text` | Display as plain text (default) |
| `table` | Render as a data table |
| `chart` | Render as a chart |
| `json` | Render as formatted JSON |
| `code` | Render as a code block |
| `react` | Render a custom React component by name |

When a tool returns `render != "text"`, the strategy emits a `ComponentEvent` with the component name and props. The dashboard's component registry maps the component name to a React component for rendering.

## SSE wire format

The REST channel serializes `StreamEvent` objects as SSE events:

```
event: message
data: {"type": "tool_start", "tool": "calculator", "args": {"expression": "15*37"}}

event: message
data: {"type": "tool_end", "tool": "calculator", "output": "555", "success": true}

event: message
data: {"type": "component", "component": "json", "props": {"data": 555}}
```

Plain text tokens are sent as:

```
event: message
data: {"type": "token", "content": "The result is "}
```

This separation keeps strategies transport-agnostic while enabling rich structured content on the frontend.
