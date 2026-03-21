---
sidebar_position: 6
---

# Embeddings

Corail provides a pluggable embedding interface for converting text into vectors. Embeddings are used by the retrieval system for RAG and by Maree for document ingestion.

## EmbeddingProvider interface

All embedding providers implement three methods:

```python
from corail.embeddings.base import EmbeddingProvider

class EmbeddingProvider(ABC):
    async def embed(self, text: str) -> list[float]:
        """Embed a single text into a vector."""
        ...

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in one call."""
        ...

    @property
    def dimension(self) -> int:
        """Return the embedding vector dimension."""
        ...
```

## Ollama provider

The built-in provider generates embeddings via the Ollama `/api/embed` endpoint.

```python
from corail.embeddings.ollama import OllamaEmbeddingProvider

provider = OllamaEmbeddingProvider(
    model="nomic-embed-text",                          # Default model
    base_url="http://host.docker.internal:11434",      # Default URL
)

vec = await provider.embed("What is Kubernetes?")
# vec: list[float] with 768 dimensions (nomic-embed-text default)
```

Configuration:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | `nomic-embed-text` | Ollama embedding model name |
| `base_url` | `OLLAMA_BASE_URL` env or `http://host.docker.internal:11434` | Ollama API endpoint |

The `embed_batch` method sends all texts in a single API call for efficiency.

## Factory

Providers are resolved via the registry:

```python
from corail.embeddings.factory import EmbeddingProviderFactory

provider = EmbeddingProviderFactory.create("ollama", model="nomic-embed-text")

# List available providers
print(EmbeddingProviderFactory.available())  # ['ollama']
```

### Adding a custom provider

```python
from corail.embeddings.factory import register_embedding_provider

register_embedding_provider("openai", "mypackage.embeddings", "OpenAIEmbeddingProvider")
```

The module is only imported when `EmbeddingProviderFactory.create("openai")` is called.
