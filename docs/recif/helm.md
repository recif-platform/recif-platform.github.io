---
sidebar_position: 3
---

# Helm Chart

The Récif Helm chart installs the entire platform in a single command. It is located at `charts/recif/` in the Récif repository.

## Install

```bash
helm install recif charts/recif/
```

## Upgrade

```bash
helm upgrade recif charts/recif/ -f my-values.yaml
```

## Chart metadata

| Field | Value |
|-------|-------|
| Chart name | `recif` |
| Version | `0.1.0` |
| App version | `0.1.0` |
| Type | `application` |

## values.yaml reference

### Operator

```yaml
operator:
  image: ghcr.io/recif-platform/recif-operator:latest
  replicas: 1
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi
```

The operator deployment runs in the `recif-system` namespace and watches all namespaces for `Agent` CRDs.

### Corail (default agent image)

```yaml
corail:
  image: ghcr.io/recif-platform/corail:latest
```

This is the default image used when an Agent CRD does not specify `spec.image`.

### PostgreSQL

```yaml
postgresql:
  enabled: true
  image: pgvector/pgvector:pg16
  auth:
    postgresPassword: recif-dev
    database: recif
  persistence:
    size: 10Gi
```

Set `postgresql.enabled: false` to use an external database:

```yaml
postgresql:
  enabled: false

externalDatabase:
  host: "my-rds-instance.example.com"
  port: 5432
  user: "recif"
  password: "secret"
  database: "recif"
```

### Ollama (optional LLM runtime)

By default Récif agents can use any cloud LLM provider (OpenAI, Anthropic, Vertex AI, …) and you do not need Ollama at all. Set `ollama.enabled: true` to run Ollama inside the cluster, or use `ollama.baseUrl` to point at an Ollama you already run elsewhere (your laptop, a GPU node, a managed endpoint).

```yaml
ollama:
  # Option A: run Ollama in-cluster
  enabled: false
  image: ollama/ollama:latest
  storage: 20Gi
  port: 11434
  gpu: false
  models:
    - qwen3.5:4b
    - nomic-embed-text

  # Option B: point at an external Ollama you already run
  # Leave baseUrl empty if you only use cloud LLMs.
  baseUrl: ""
  # Examples:
  #   colima / docker-desktop on macOS: http://host.docker.internal:11434
  #   k3s on the same host            : http://<host-ip>:11434
  #   managed endpoint                : https://ollama.mycompany.ai
```

When either `enabled: true` or `baseUrl` is set, the chart injects `OLLAMA_BASE_URL` into the Récif API, the operator, and all agent pods. Marée also uses it for embedding generation during knowledge base ingestion.

If your chat agents run large local models (35B+) **and** you also set a `backgroundModel` on them, bump Ollama's `OLLAMA_MAX_LOADED_MODELS` to `2` so it can keep the chat model and the background model resident at the same time. See [Agent Settings → Background model](./agent-settings.md#background-model) for details.

### Knowledge Bases (corail_storage)

Knowledge base ingestion requires a second PostgreSQL database called `corail_storage`. The Helm chart automatically derives `KB_DATABASE_URL` from the main PostgreSQL credentials, pointing to the `corail_storage` database.

The database is created automatically if the PostgreSQL instance is managed by the chart. For external databases, create the `corail_storage` database manually:

```sql
CREATE DATABASE corail_storage;
```

To override the KB database URL explicitly:

```yaml
api:
  env:
    KB_DATABASE_URL: "postgres://user:pass@host:5432/corail_storage?sslmode=disable"
```

The KB schema (tables `knowledge_bases`, `kb_documents`, `chunks` with pgvector) is migrated automatically on API startup.

### Authentication

See the dedicated [Authentication](/docs/recif/authentication) page for full setup.

```yaml
api:
  env:
    AUTH_ENABLED: "true"    # Require JWT on all API calls
```

Create the admin credentials secret before deploying:

```bash
kubectl create secret generic recif-api-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=ADMIN_EMAIL="you@example.com" \
  --from-literal=ADMIN_PASSWORD="your-password" \
  --from-literal=ADMIN_NAME="Your Name" \
  -n recif-system
```

### Observability

```yaml
observability:
  metrics:
    backend: prometheus        # prometheus | datadog
  tracing:
    backend: jaeger            # jaeger | zipkin | tempo
  kiali:
    enabled: true
```

### Namespaces

```yaml
namespaces:
  createDefault: true          # Create the team-default namespace
  defaultTeam: team-default
```

The chart creates the default team namespace with `istio-injection=enabled` label.

## Included templates

The chart installs the following resources:

| Template | Resource |
|----------|----------|
| `operator-deployment.yaml` | Operator Deployment in `recif-system` |
| `rbac.yaml` | ClusterRole + ClusterRoleBinding for the operator |
| `postgresql.yaml` | StatefulSet + Service for PostgreSQL (if enabled) |
| `namespace.yaml` | Team namespace creation |
| `network-policy.yaml` | NetworkPolicy for pod isolation |
| `istio-auth.yaml` | Istio AuthorizationPolicy for mTLS enforcement |
| `istio-gateway.yaml` | Istio Gateway for external access |

## CRDs

The Agent CRD is installed from `crds/agents.recif.dev_agents.yaml`. Helm installs CRDs before other resources. See the [Operator docs](/docs/recif/operator) for the full CRD spec.
