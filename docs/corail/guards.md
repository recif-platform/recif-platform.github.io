---
sidebar_position: 7
---

# Guards

Guards provide input/output security checks for agent conversations. They detect prompt injection, PII leakage, and secret exposure. Guards are used by the `agent-react` strategy via the `GuardPipeline`.

## Guard interface

```python
from corail.guards.base import Guard, GuardDirection, GuardResult

class Guard(ABC):
    @property
    def name(self) -> str: ...

    @property
    def direction(self) -> GuardDirection:
        return GuardDirection.BOTH  # INPUT, OUTPUT, or BOTH

    async def check(self, content: str, direction: GuardDirection) -> GuardResult: ...
```

`GuardResult` carries:

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `bool` | Whether the content passed |
| `reason` | `str` | Why it was blocked (empty if allowed) |
| `sanitized` | `str` | Modified content to use instead (e.g., PII masked) |
| `guard_name` | `str` | Name of the guard that produced this result |
| `details` | `dict` | Additional metadata (pattern matched, PII types, etc.) |

## Built-in guards

### PromptInjectionGuard

**Direction:** `INPUT` only

Detects common prompt injection patterns in user messages. Blocks the request if any pattern matches.

Patterns detected:

- "ignore all previous instructions"
- "disregard previous", "forget previous"
- "you are now", "act as", "pretend to be"
- "new instructions:", "system:"
- "override all rules"
- "jailbreak", "DAN mode"
- XML-style `<system>` tags

```python
from corail.guards.builtins import PromptInjectionGuard

guard = PromptInjectionGuard()
result = await guard.check("ignore all previous instructions and ...", GuardDirection.INPUT)
# result.allowed = False
# result.reason = "Prompt injection detected: 'ignore all previous instructions'"
```

### PIIGuard

**Direction:** `OUTPUT` only

Detects personally identifiable information in agent responses. Two modes:

| Mode | Behavior |
|------|----------|
| `mask=True` (default) | Replaces PII with `[TYPE_REDACTED]` tokens, allows the response |
| `block=True` | Blocks the entire response |

PII types detected:

| Type | Pattern |
|------|---------|
| `email` | Email addresses |
| `phone_fr` | French phone numbers (+33, 0x) |
| `phone_intl` | International phone numbers |
| `ssn` | US Social Security numbers |
| `credit_card` | Credit card numbers (4 groups of 4) |
| `iban` | International Bank Account Numbers |

```python
from corail.guards.builtins import PIIGuard

guard = PIIGuard(mask=True, block=False)
result = await guard.check("Contact john@example.com for details", GuardDirection.OUTPUT)
# result.allowed = True
# result.sanitized = "Contact [EMAIL_REDACTED] for details"
```

### SecretGuard

**Direction:** `BOTH`

Detects API keys, tokens, and credentials. Always blocks (no masking mode).

Patterns detected:

| Type | Example |
|------|---------|
| `api_key` | `api_key=sk_live_abc123...` |
| `bearer_token` | `Bearer eyJhbG...` |
| `aws_key` | `AKIA0123456789ABCDEF` |
| `github_token` | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `generic_secret` | `password="my_secret_value"` |
| `private_key` | `-----BEGIN PRIVATE KEY-----` |

## GuardPipeline

Runs guards in sequence. If any guard blocks, the pipeline stops immediately. If a guard returns sanitized content, the next guard checks the sanitized version.

```python
from corail.guards.pipeline import GuardPipeline
from corail.guards.builtins import PromptInjectionGuard, PIIGuard, SecretGuard

pipeline = GuardPipeline(
    guards=[PromptInjectionGuard(), PIIGuard(), SecretGuard()],
    event_bus=event_bus,  # Optional: emits GUARD_INPUT_CHECKED, GUARD_BLOCKED events
)

# Check user input
input_result = await pipeline.check_input("Hello, can you help me?")

# Check agent output
output_result = await pipeline.check_output("Sure! Contact support@company.com")
# output_result.sanitized = "Sure! Contact [EMAIL_REDACTED]"
```

The pipeline emits events:

| Event | When |
|-------|------|
| `GUARD_INPUT_CHECKED` | Input guard passed |
| `GUARD_OUTPUT_CHECKED` | Output guard passed |
| `GUARD_BLOCKED` | Any guard blocked the content |

## GuardFactory

Guards are resolved via the registry:

```python
from corail.guards.factory import GuardFactory

guard = GuardFactory.create("prompt_injection")
guard = GuardFactory.create("pii", mask=True, block=False)
guard = GuardFactory.create("secrets")

# List available guards
print(GuardFactory.available())  # ['pii', 'prompt_injection', 'secrets']
```

### Adding a custom guard

```python
from corail.guards.factory import register_guard

register_guard("toxicity", "mypackage.guards", "ToxicityGuard")
```

## Configuration

Guards are configured via the `CORAIL_GUARDS` environment variable (used by the `agent-react` strategy initializer):

```bash
CORAIL_GUARDS='["prompt_injection", "pii", "secrets"]'
```

This JSON array of guard names is parsed at startup. Each guard is created via `GuardFactory` and assembled into a `GuardPipeline`.
