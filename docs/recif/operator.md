---
sidebar_position: 2
---

# Récif Operator

The Récif Operator is a Kubernetes controller built with [Kubebuilder](https://kubebuilder.io/) and [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime). It watches `Agent` custom resources and reconciles them into running Pods.

## Agent CRD

The Agent CRD is defined at `agents.recif.dev/v1` and installed via the Helm chart at `charts/recif/crds/agents.recif.dev_agents.yaml`.

### Full spec

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-agent
  namespace: team-default
spec:
  # Required fields
  name: "My Agent"                          # Display name (minLength: 1)
  framework: adk                            # adk | langchain | crewai | autogen | custom

  # Optional fields (with defaults)
  strategy: simple                          # Execution strategy (default: simple)
  channel: rest                             # I/O channel (default: rest)
  modelType: stub                           # LLM provider (default: stub)
  modelId: stub-echo                        # Model identifier (default: stub-echo)
  backgroundModel: ""                       # provider:model_id URI for cheap background work (memory/suggestions/auto-titles).
                                            # Falls back to the main chat model when empty. See agent-settings.md#background-model.
  systemPrompt: "You are a helpful assistant."
  storage: ""                               # memory | postgresql. When empty the operator picks postgresql
                                            # if a DATABASE_URL is configured on the cluster, otherwise memory.
  databaseUrl: ""                           # Override the operator's DATABASE_URL for this agent only (rarely needed)
  tools:                                    # Tool CRD names assigned to this agent
    - weather-api
    - kubectl-reader
  knowledgeBases:                           # Knowledge base IDs for RAG strategy
    - product-docs
    - faq
  image: "corail:latest"                    # Docker image (default: corail:latest)
  replicas: 1                               # Pod replicas, 0-10 (default: 1)
```

## Tool CRD

Tools are declared as separate CRDs at `agents.recif.dev/v1` and referenced by name from Agent CRDs.

```yaml
apiVersion: agents.recif.dev/v1
kind: Tool
metadata:
  name: weather-api
  namespace: team-default
spec:
  name: weather                              # Tool name visible to the LLM
  type: http                                 # http | cli | mcp | builtin
  category: general                          # Organizational category (default: general)
  description: "Get current weather"
  endpoint: "https://api.weather.com/v1/{city}"
  method: GET
  headers:
    Authorization: "Bearer $KEY"
  parameters:
    - name: city
      type: string                           # string | integer | number | boolean
      description: "City name"
      required: true
  timeout: 30                                # Seconds (default: 30)
  enabled: true                              # Disable without deleting (default: true)
```

### Type-specific fields

| Type | Required fields |
|------|----------------|
| `http` | `endpoint` (plus optional `method`, `headers`) |
| `cli` | `binary` (plus optional `allowedCommands`) |
| `mcp` | `mcpEndpoint` |
| `builtin` | _(none)_ |

### Tool status

The Tool controller validates the spec and sets the phase:

| Phase | Meaning |
|-------|---------|
| `Available` | Tool spec is valid |
| `Error` | Validation failed (missing endpoint, binary, etc.) |

`kubectl get tools` displays: Name, Type, Category, Phase, Age.

### Status fields

The operator updates these fields after reconciliation:

```yaml
status:
  phase: Running          # Pending | Running | Failed | Terminated
  replicas: 1             # Current ready replica count
  endpoint: "http://my-agent.team-default.svc.cluster.local:8000"
  conditions:             # Standard K8s conditions
    - type: Available
      status: "True"
      reason: DeploymentReady
      message: "Agent deployment is ready"
      lastTransitionTime: "2026-03-16T10:00:00Z"
```

### Printer columns

`kubectl get agents` displays:

| Column | JSON Path |
|--------|-----------|
| Phase | `.status.phase` |
| Replicas | `.status.replicas` |
| Endpoint | `.status.endpoint` |
| Age | `.metadata.creationTimestamp` |

## Reconciliation loop

When an `Agent` resource is created or updated, the reconciler executes three steps in order:

### 1. Ensure ConfigMap

Creates or updates `{agent-name}-config` with `CORAIL_*` environment variables:

```
CORAIL_CHANNEL          = spec.channel
CORAIL_STRATEGY         = spec.strategy
CORAIL_MODEL_TYPE       = spec.modelType
CORAIL_MODEL_ID         = spec.modelId
CORAIL_BACKGROUND_MODEL = spec.backgroundModel  (if set)
CORAIL_SYSTEM_PROMPT    = spec.systemPrompt
CORAIL_STORAGE          = spec.storage OR postgresql if operator has DATABASE_URL, else memory
CORAIL_DATABASE_URL     = spec.databaseUrl OR operator DATABASE_URL (rewritten with an FQDN host)
CORAIL_TOOLS            = resolved Tool CRDs     (if spec.tools is set)
CORAIL_KNOWLEDGE_BASES  = resolved KB configs    (if spec.knowledgeBases is set)
OLLAMA_BASE_URL         = from operator env, FQDN-expanded for cross-namespace
```

The storage and database URL are auto-filled from the operator's own environment when the Agent CR doesn't set them explicitly, so conversations persist by default without each user having to remember to configure it. Short hostnames like `recif-postgresql` are rewritten to the fully-qualified `recif-postgresql.recif-system.svc.cluster.local` form so agents in `team-*` namespaces can reach them.

#### Tool resolution

When `spec.tools` contains Tool CRD names, the reconciler reads each Tool CRD from the same namespace. Disabled tools (`enabled: false`) are skipped. The result is serialized as a JSON array and set as `CORAIL_TOOLS`.

#### Knowledge base resolution

When `spec.knowledgeBases` contains KB IDs, the reconciler builds a JSON array with pgvector connection details and Ollama embedding configuration. This is set as `CORAIL_KNOWLEDGE_BASES`.

The connection URL is derived from the operator's own `DATABASE_URL` — it is **not** hardcoded. The operator:

1. Parses the lib/pq-style DSN the recif-api uses (`postgres://…/recif?sslmode=disable`)
2. Rewrites the database path to `/corail_storage` — that's the sibling database where Marée stores chunks (see [API → Ingest document](./api.md#ingest-document))
3. Normalises the scheme to `postgresql://` and drops `sslmode` so asyncpg accepts it
4. Expands the host to an FQDN for cross-namespace resolution

As a result the retriever, recif-api, and Marée all read/write the same database without any operator-level credential pinning.

### 2. Ensure Deployment

Creates or updates a Deployment:

- **Image:** `spec.image` (defaults to `corail:latest`)
- **Replicas:** `spec.replicas` (defaults to 1)
- **Image pull policy:** `Never` for local images (no `/` in image name), `IfNotPresent` otherwise.
- **envFrom:** References the ConfigMap for all `CORAIL_*` vars.
- **Probes:**
  - Liveness: `GET /healthz` on port 8000, initial delay 5s, period 10s.
  - Readiness: `GET /healthz` on port 8000, initial delay 3s, period 5s.
- **Labels:** `app.kubernetes.io/name`, `app.kubernetes.io/part-of=recif`, `app.kubernetes.io/managed-by=recif-operator`, `recif.dev/agent`.
- **Config hash annotation:** `recif.dev/config-hash` on the Pod template. Computed as SHA-256 of the ConfigMap data. When the ConfigMap changes (e.g., new tools or updated system prompt), the hash changes, triggering a rolling restart of the Pods.

### 3. Ensure Service

Creates a ClusterIP Service on port 8000, enabling in-cluster DNS at:

```
http://{agent-name}.{namespace}.svc.cluster.local:8000
```

## Owner references

All child resources (ConfigMap, Deployment, Service) have `ownerReferences` pointing to the Agent resource. When an Agent is deleted, Kubernetes garbage-collects all child resources automatically.

## RBAC

The operator requires these permissions (configured via Helm RBAC templates):

```
agents.recif.dev (agents): get, list, watch, create, update, patch, delete
agents.recif.dev/agents/status: get, update, patch
agents.recif.dev/agents/finalizers: update
agents.recif.dev (tools): get, list, watch, create, update, patch, delete
agents.recif.dev/tools/status: get, update, patch
agents.recif.dev/tools/finalizers: update
apps/deployments: get, list, watch, create, update, patch, delete
core/services, core/configmaps: get, list, watch, create, update, patch, delete
```

## Building

```bash
cd recif-operator
make manifests    # Generate CRD YAML
make generate     # Generate deepcopy methods
make docker-build # Build operator image
```
