---
sidebar_position: 3
---

# Storage

Corail uses a pluggable storage interface (`StoragePort`) for conversation persistence. Storage backends are resolved at runtime via the registry pattern.

## StoragePort interface

All storage backends implement the `StoragePort` abstract class defined in `corail/storage/port.py`:

```python
class StoragePort(ABC):
    async def get_messages(self, conversation_id: str) -> list[dict[str, str]]: ...
    async def append_message(self, conversation_id: str, role: str, content: str) -> None: ...
    async def create_conversation(self, conversation_id: str, metadata: dict | None = None) -> None: ...
    async def conversation_exists(self, conversation_id: str) -> bool: ...
    async def list_conversations(self) -> list[dict]: ...
    async def update_title(self, conversation_id: str, title: str) -> None: ...
```

## Built-in backends

### Memory (default)

- **Name:** `memory`
- **Class:** `corail.storage.memory.MemoryStorage`
- **Persistence:** None -- data is lost when the Pod restarts.
- **Use case:** Development, testing, stateless agents.

```bash
CORAIL_STORAGE=memory
```

### PostgreSQL

- **Name:** `postgresql`
- **Class:** `corail.storage.postgresql.PostgreSQLStorage`
- **Persistence:** Full -- conversations survive Pod restarts and scale across replicas.
- **Dependency:** Requires `asyncpg` (`uv add asyncpg`).

```bash
CORAIL_STORAGE=postgresql
CORAIL_DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

The PostgreSQL backend auto-creates the required tables on first connection:

- `conversations` -- id, title, metadata (JSONB), created_at
- `messages` -- id, conversation_id (FK), role, content, created_at

An index on `messages.conversation_id` is created automatically.

## Adding a new storage backend

1. Create a new module (e.g., `corail/storage/redis.py`) implementing `StoragePort`.

2. Register it in the factory (`corail/storage/factory.py`):

```python
from corail.storage.factory import register_storage

register_storage("redis", "corail.storage.redis", "RedisStorage")
```

Or add it directly to the `_REGISTRY` dict:

```python
_REGISTRY: dict[str, tuple[str, str]] = {
    "memory":     ("corail.storage.memory",      "MemoryStorage"),
    "postgresql": ("corail.storage.postgresql",   "PostgreSQLStorage"),
    "redis":      ("corail.storage.redis",        "RedisStorage"),  # new
}
```

3. The module is only imported when `CORAIL_STORAGE=redis` is set (lazy loading via `importlib`).

4. Available storage backends can be listed programmatically:

```python
from corail.storage.factory import StorageFactory

print(StorageFactory.available())  # ['memory', 'postgresql', 'redis']
```
