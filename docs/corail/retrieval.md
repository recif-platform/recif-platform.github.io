---
sidebar_position: 9
---

# Retrieval

Corail uses **agentic RAG** — each attached knowledge base becomes a search tool that the agent calls through its react loop only when the question is relevant. The agent decides which KB to search (or whether to search at all), receives chunks with source labels, and cites them naturally.

## How it works

When an agent has knowledge bases configured via `CORAIL_KNOWLEDGE_BASES`, the initializer automatically creates one `KBSearchTool` per KB and registers it in the agent's `ToolRegistry`. Each tool is named `search_{kb_slug}` and has a single `query` parameter.

```
User: "What does the deployment guide say about rollbacks?"
Agent: [calls search_product_docs(query="deployment rollbacks")]
Tool:  [Source: deploy-guide.pdf] Rollbacks are triggered by...
Agent: "According to deploy-guide.pdf, rollbacks are triggered by..."
```

The agent does **not** search when the question is unrelated to any KB:

```
User: "Hello, how are you?"
Agent: "I'm doing well! How can I help you today?"
       (no search tool called, no sources displayed)
```

## KBSearchTool

Each KB search tool wraps a `PgVectorRetriever` and returns results with source attribution:

```python
from corail.tools.kb_search import KBSearchTool

tool = KBSearchTool(
    name="search_product_docs",
    description="Search product documentation",
    retriever=retriever,
    kb_id="product-docs",
    top_k=5,
)

result = await tool.execute(query="How do I deploy?")
# result.output contains [Source: filename] labeled chunks
# result.props["sources"] contains structured source metadata
```

Source attribution flows through two channels:
- **LLM citation**: Tool result text includes `[Source: filename.pdf]` labels — the LLM cites these naturally
- **Dashboard rendering**: `ToolResult.props["sources"]` triggers a `SourcesEvent` so the dashboard shows a Sources table

## Retriever interface

```python
from corail.retrieval.base import Retriever, RetrievalResult

class Retriever(ABC):
    async def search(self, query: str, top_k: int = 5) -> list[RetrievalResult]:
        """Search for relevant chunks given a query string."""
        ...
```

`RetrievalResult` carries:

| Field | Type | Description |
|-------|------|-------------|
| `content` | `str` | The text chunk |
| `score` | `float` | Similarity score (higher = more relevant) |
| `metadata` | `dict` | Source info (filename, kb_id, etc.) |

## PgVectorRetriever

Performs hybrid BM25 + semantic search with Reciprocal Rank Fusion (RRF) against a `chunks` table in PostgreSQL with the `pgvector` extension.

```python
from corail.embeddings.ollama import OllamaEmbeddingProvider
from corail.retrieval.pgvector import PgVectorRetriever

retriever = PgVectorRetriever(
    connection_url="postgresql://user:pass@host:5432/db",
    embedding_provider=OllamaEmbeddingProvider(model="nomic-embed-text"),
    kb_id="product-docs",
)

results = await retriever.search("How do I deploy an agent?", top_k=5)
for r in results:
    print(f"[{r.score:.4f}] {r.content[:100]}...")
```

The retriever uses a connection pool (`asyncpg.Pool`) created lazily on first search. Call `await retriever.close()` to release connections.

## RetrieverFactory

```python
from corail.retrieval.factory import RetrieverFactory

retriever = RetrieverFactory.create(
    "pgvector",
    connection_url="postgresql://...",
    embedding_provider=provider,
    kb_id="my-kb",
)

print(RetrieverFactory.available())  # ['pgvector']
```

## Configuration via CORAIL_KNOWLEDGE_BASES

The agent initializer creates per-KB search tools from `CORAIL_KNOWLEDGE_BASES`:

```bash
CORAIL_KNOWLEDGE_BASES='[
  {
    "kb_id": "product-docs",
    "name": "product-docs",
    "description": "Documents and knowledge about product-docs",
    "connection_url": "postgresql://...",
    "embedding_provider": "ollama",
    "embedding_model": "nomic-embed-text"
  }
]'
```

Each KB entry creates a `search_{slug}` tool registered in the agent's `ToolRegistry`. The `description` field helps the LLM decide when to call the tool. If omitted, a default description is generated from the KB name.

## Migration from pipeline RAG

The old `strategy: rag` and pipeline-based retrieval (where every message triggered a vector search) is deprecated. Use `strategy: agent-react` with `knowledgeBases` instead — the agent decides when to search.

| Old (deprecated) | New |
|---|---|
| `strategy: rag` | `strategy: agent-react` with KB tools |
| Always-on retrieval every message | Agent calls search only when relevant |
| `use_rag` / `active_kbs` chat options | Agent decides via tool selection |
| Sources before first token | Sources when tool executes (mid-stream) |

`strategy: rag` still works but logs a deprecation warning and delegates to `agent-react`.
