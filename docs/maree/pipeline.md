---
sidebar_position: 2
---

# Pipeline Components

The Maree pipeline has four stages, each with a pluggable interface and a registry-based factory.

## Pipeline

The `Pipeline` class orchestrates the four stages:

```python
from maree.pipeline import Pipeline

pipeline = Pipeline(
    source=source,
    processor=processor,
    transformer=transformer,
    store=store,
)

result = await pipeline.run("/path/to/documents")
print(f"Ingested {result.documents} documents, {result.chunks} chunks")
```

Execution flow:

1. **Extract** -- `source.extract(path)` returns `list[Document]`
2. **Process** -- `processor.process(documents)` returns `list[Chunk]`
3. **Transform** -- `transformer.transform(chunks)` returns `list[EnrichedChunk]`
4. **Store** -- `store.upsert(enriched)` writes to the vector database

## Sources

Sources extract raw documents from an input path.

### FileSource

Reads files from the local filesystem. Supports directories (recursive) and single files.

| Extension | Method |
|-----------|--------|
| `.txt`, `.md` | Read as UTF-8 text |
| `.pdf` | Docling extraction (falls back to raw text if Docling is not installed) |

```python
from maree.sources.file_source import FileSource

source = FileSource()
documents = await source.extract("/path/to/docs/")
```

Each document gets:
- `id`: SHA-256 hash of the file path (first 16 chars)
- `metadata`: filename, extension, size_bytes, modified_at

### Factory

```python
from maree.sources.factory import create_source, register_source

source = create_source("file")

# Add a custom source
register_source("s3", "mypackage.sources", "S3Source")
```

## Processors

Processors split documents into chunks.

### TextChunker

Fixed-size character chunking with configurable overlap.

```python
from maree.processors.text_chunker import TextChunker

processor = TextChunker(
    chunk_size=500,    # Characters per chunk
    overlap=50,        # Overlap between consecutive chunks
)

chunks = await processor.process(documents)
```

Each chunk gets:
- `id`: SHA-256 hash of `{document_id}:{chunk_index}` (first 16 chars)
- `chunk_index`: Sequential index within the document

Validation:
- `chunk_size` must be positive
- `overlap` must be non-negative
- `overlap` must be smaller than `chunk_size`

### Factory

```python
from maree.processors.factory import create_processor, register_processor

processor = create_processor("text", chunk_size=500, overlap=50)

register_processor("sentence", "mypackage.processors", "SentenceChunker")
```

## Transformers

Transformers enrich chunks with embeddings or other computed fields.

### EmbeddingTransformer (Ollama)

Generates vector embeddings via the Ollama `/api/embed` endpoint. Requires Ollama running with an embedding model pulled.

```python
from maree.transformers.embedding import EmbeddingTransformer

transformer = EmbeddingTransformer(
    model="nomic-embed-text",                  # Ollama model
    base_url="http://localhost:11434",          # Ollama endpoint
    batch_size=32,                              # Texts per API call
)
```

### VertexEmbeddingTransformer (Google Cloud)

Generates embeddings via Vertex AI. No local model needed — uses Google's hosted embedding models. Requires a GCP service account with `roles/aiplatform.user`.

```python
from maree.transformers.vertex_embedding import VertexEmbeddingTransformer

transformer = VertexEmbeddingTransformer(
    model="text-embedding-005",                # Vertex AI embedding model
    batch_size=32,
)
```

Auth is handled automatically via `GOOGLE_APPLICATION_CREDENTIALS` (service account key file) or GCP metadata server.

#### Kubernetes setup

```bash
# 1. Create a platform service account (one-time)
gcloud iam service-accounts create recif-platform \
  --display-name="Récif Platform (embeddings)"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:recif-platform@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create platform-sa.json \
  --iam-account=recif-platform@${PROJECT_ID}.iam.gserviceaccount.com

# 2. Create the K8s secret in recif-system
kubectl create secret generic recif-platform-gcp-sa \
  -n recif-system \
  --from-file=credentials.json=platform-sa.json

# 3. Configure Helm to use Vertex AI embeddings
helm upgrade recif deploy/helm/recif \
  --set llm.gcp.project=$PROJECT_ID
```

This automatically sets `MAREE_TRANSFORMER_TYPE=vertex-embedding` and mounts the credentials in the API pod.

### Factory

```python
from maree.transformers.factory import create_transformer, register_transformer

# Ollama (default)
transformer = create_transformer("embedding", model="nomic-embed-text")

# Vertex AI
transformer = create_transformer("vertex-embedding", model="text-embedding-005")

# Custom
register_transformer("openai_embedding", "mypackage.transformers", "OpenAITransformer")
```

## Stores

Stores persist enriched chunks for vector similarity search.

### PgVectorStore

PostgreSQL with the `pgvector` extension. Supports upsert (insert or update), similarity search, and document deletion.

```python
from maree.stores.pgvector import PgVectorStore

store = PgVectorStore(
    dsn="postgresql://user:pass@host:5432/db",
    kb_id="product-docs",
)

# Upsert chunks
await store.upsert(enriched_chunks)

# Search (requires a pre-computed query embedding)
results = await store.search(query_embedding, top_k=5)

# Delete all chunks for a document
await store.delete_by_document(document_id)

# Clean up
await store.close()
```

The store also manages document status tracking in a `kb_documents` table:
- Creates entries with status `processing` on upsert
- Updates to `ready` with chunk count after all chunks are written

### Factory

```python
from maree.stores.factory import create_store, register_store

store = create_store("pgvector", dsn="postgresql://...", kb_id="my-kb")

register_store("qdrant", "mypackage.stores", "QdrantStore")
```

## Adding a custom component

All four stages follow the same pattern:

1. Implement the abstract base class (`Source`, `Processor`, `Transformer`, or `Store`)
2. Register it in the corresponding factory
3. Reference it by name in the CLI or configuration
