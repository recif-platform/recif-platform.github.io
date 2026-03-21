---
sidebar_position: 1
---

# Maree

Maree is a standalone document ingestion pipeline for RAG. It extracts documents from various sources, chunks them, generates embeddings, and stores the enriched chunks in a vector database for retrieval by Corail agents.

## Architecture

```mermaid
graph LR
    A["Source<br/><i>FileSource</i><br/>.txt, .md, .pdf via Docling"] --> B["Processor<br/><i>TextChunker</i><br/>fixed-size + overlap"]
    B --> C["Transformer<br/><i>EmbeddingTransformer</i><br/>Ollama"]
    C --> D["Store<br/><i>PgVectorStore</i><br/>pgvector"]
```

Each stage is pluggable via the registry pattern. You can swap any component by registering a custom implementation.

## Installation

```bash
cd maree
pip install -e .

# With PDF support via Docling
pip install -e ".[docling]"
```

## CLI usage

Maree provides a Click-based CLI:

```bash
# Basic ingestion
maree ingest --source ./docs/ --store-url postgresql://localhost:5432/maree

# With options
maree ingest \
  --source ./documents/ \
  --store-url postgresql://user:pass@host:5432/db \
  --model nomic-embed-text \
  --chunk-size 500 \
  --chunk-overlap 50 \
  --kb-id product-docs
```

### CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--source` | (required) | Path to documents (file or directory) |
| `--store-url` | `MAREE_STORE_URL` or `postgresql://localhost:5432/maree` | PostgreSQL connection string |
| `--model` | `nomic-embed-text` | Ollama embedding model |
| `--chunk-size` | `500` | Characters per chunk |
| `--chunk-overlap` | `50` | Overlap between consecutive chunks |
| `--kb-id` | `default` | Knowledge base identifier |

## Configuration

All settings can be provided via `MAREE_*` environment variables:

```bash
MAREE_SOURCE_TYPE=file
MAREE_PROCESSOR_TYPE=text
MAREE_CHUNK_SIZE=500
MAREE_CHUNK_OVERLAP=50
MAREE_TRANSFORMER_TYPE=embedding
MAREE_EMBEDDING_MODEL=nomic-embed-text
MAREE_OLLAMA_BASE_URL=http://localhost:11434
MAREE_STORE_TYPE=pgvector
MAREE_STORE_URL=postgresql://localhost:5432/maree
```

## Integration with Recif

The Recif API triggers Maree ingestion automatically when documents are uploaded via the knowledge base endpoints:

1. User uploads a file to `POST /api/v1/knowledge-bases/{id}/ingest`
2. Recif saves the file to disk and creates a document entry
3. Recif runs `maree ingest` as a subprocess with the appropriate `--store-url` and `--kb-id`
4. Maree processes the document and stores chunks in pgvector
5. The Corail agent's RAG strategy retrieves chunks at query time

## Data models

| Model | Fields | Purpose |
|-------|--------|---------|
| `Document` | id, content, metadata | Raw document extracted from source |
| `Chunk` | id, document_id, content, chunk_index, metadata | A piece of a document |
| `EnrichedChunk` | id, document_id, content, chunk_index, embedding, metadata | Chunk with vector |
| `PipelineResult` | documents, chunks | Summary of a pipeline run |
