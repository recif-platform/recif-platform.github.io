---
sidebar_position: 3
---

# LLM Providers

Corail connects to any LLM through a **provider adapter**. Each adapter speaks the provider's native REST API — no vendor SDK is installed, keeping the image lightweight.

## Supported providers

| Type | Provider | Default model | Auth | Tool calling |
|------|----------|---------------|------|:------------:|
| `ollama` | Ollama (local) | `qwen3.5:35b` | None | Prompt-based |
| `openai` | OpenAI | `gpt-4` | API key | Prompt-based |
| `anthropic` | Anthropic | `claude-sonnet-4-20250514` | API key | Native |
| `google-ai` | Google AI Studio | `gemini-2.5-flash` | API key | Prompt-based |
| `vertex-ai` | Google Cloud Vertex AI | `gemini-2.5-flash` | Service account | Native |
| `bedrock` | AWS Bedrock | `anthropic.claude-sonnet-4-20250514-v1:0` | IAM keys | Prompt-based |

Providers marked **Native** expose tool schemas as first-class objects
to the model instead of injecting them as text instructions. This
generally produces more reliable tool use, especially for Gemini which
would otherwise emit its own `tool_code` Python-style blocks that
Corail's regex parser cannot understand.

The Vertex AI adapter translates Corail's Anthropic-style tool schemas
to Gemini `functionDeclarations` on the way in, and converts the
returned `functionCall` parts back to Corail `ToolCall` objects on the
way out. It also resolves Corail's `tool_use_id` back to the Gemini
function name via a one-pass id→name map (Gemini's `functionResponse`
needs the name, while Anthropic's `tool_result` only carries an id).

---

## Setup

All providers follow the same pattern:

1. **Create a K8s Secret** with credentials
2. **Set `modelType` and `modelId`** in the Agent CRD (or via the dashboard)

### API key providers (OpenAI, Anthropic, Google AI)

Create a Secret with your API key:

```bash
# OpenAI
kubectl create secret generic agent-env -n team-default \
  --from-literal=OPENAI_API_KEY=sk-...

# Anthropic
kubectl create secret generic agent-env -n team-default \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

# Google AI Studio
kubectl create secret generic agent-env -n team-default \
  --from-literal=GOOGLE_API_KEY=AIza... \
  --from-literal=GOOGLE_AI_API_KEY=AIza...
```

The operator injects `agent-env` into every agent pod via `envFrom`.

Then set the model in your Agent CRD:

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-agent
  namespace: team-default
spec:
  name: "My Agent"
  framework: adk
  strategy: agent-react
  modelType: openai          # or anthropic, google-ai
  modelId: gpt-4o-mini       # or claude-sonnet-4-20250514, gemini-2.5-flash
```

Or do it via `values.yaml` for cluster-wide defaults:

```yaml
llm:
  openaiApiKey: "sk-..."
  # or:
  anthropicApiKey: "sk-ant-..."
  # or:
  googleApiKey: "AIza..."
```

### Ollama (local models)

No API key needed. Enable Ollama in Helm values:

```yaml
ollama:
  enabled: true
  models:
    - qwen3.5:35b
```

Then set `modelType: ollama` in your Agent CRD. The operator configures `OLLAMA_BASE_URL` automatically.

### AWS Bedrock

```bash
kubectl create secret generic agent-env -n team-default \
  --from-literal=AWS_ACCESS_KEY_ID=AKIA... \
  --from-literal=AWS_SECRET_ACCESS_KEY=... \
  --from-literal=AWS_REGION=us-east-1
```

Or via Helm values:

```yaml
llm:
  aws:
    region: us-east-1
    accessKeyId: "AKIA..."
    secretAccessKey: "..."
```

---

## Vertex AI (Google Cloud) — step by step {#vertex-ai}

Vertex AI uses IAM-based authentication (service account) instead of API keys. This gives fine-grained access control and audit logging.

### Step 1 — Enable the API

```bash
gcloud services enable aiplatform.googleapis.com --project=$PROJECT_ID
```

### Step 2 — Create a service account and download the key

```bash
PROJECT_ID=my-project-123

# Create the service account
gcloud iam service-accounts create corail-agent \
  --project=$PROJECT_ID \
  --display-name="Corail Agent Runtime"

# Grant Vertex AI access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:corail-agent@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Download the key
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=corail-agent@${PROJECT_ID}.iam.gserviceaccount.com
```

### Step 3 — Load the key into the cluster

```bash
./deploy/scripts/setup-credentials.sh --provider vertex-ai
# → choose (a) Service Account key
# → enter your agent name and the path to sa-key.json
```

Or manually:

```bash
kubectl create secret generic <agent-name>-gcp-sa \
  -n team-default \
  --from-file=credentials.json=sa-key.json
```

### Step 4 — Create the agent

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-agent
  namespace: team-default
spec:
  name: "My Agent"
  framework: adk
  strategy: agent-react
  modelType: vertex-ai
  modelId: gemini-2.5-flash
  gcpServiceAccount: corail-agent@my-project-123.iam.gserviceaccount.com
```

```bash
kubectl apply -f my-agent.yaml
```

When `gcpServiceAccount` is set, the operator automatically:
1. Mounts the Secret `my-agent-gcp-sa` (key: `credentials.json`) into the pod
2. Sets `GOOGLE_APPLICATION_CREDENTIALS` to the mount path
3. The runtime auto-detects `project_id` from the key file

### Step 5 — Verify

```bash
# Check the pod is running
kubectl get pods -n team-default

# Check the logs for successful model connection
kubectl logs -n team-default deployment/my-agent
```

### Per-agent isolation

Each agent can use a **different service account** (different projects, different quotas). Just create a separate Secret per agent:

```bash
kubectl create secret generic agent-a-gcp-sa -n team-default --from-file=credentials.json=sa-project-a.json
kubectl create secret generic agent-b-gcp-sa -n team-default --from-file=credentials.json=sa-project-b.json
```

### Shared credentials (all agents, same project)

If all agents share the same GCP project:

```bash
./deploy/scripts/setup-credentials.sh --provider vertex-ai
# → choose (b) Application Default Credentials
```

Or via Helm:

```yaml
llm:
  gcp:
    project: my-project-123
    location: europe-west1
```

### GKE Workload Identity (zero keys)

On GKE, use [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) to avoid storing keys entirely:

```bash
# Bind KSA to GSA
gcloud iam service-accounts add-iam-policy-binding \
  corail-agent@${PROJECT_ID}.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[team-default/default]"

# Annotate the Kubernetes service account
kubectl annotate sa default -n team-default \
  iam.gke.io/gcp-service-account=corail-agent@${PROJECT_ID}.iam.gserviceaccount.com
```

No Secret needed — the metadata server handles auth automatically.

:::tip Available regions
Use a location close to your users for lower latency. Common choices: `us-central1`, `europe-west1`, `europe-west4`, `asia-northeast1`. See [Vertex AI regions](https://cloud.google.com/vertex-ai/docs/general/locations).
:::

---

## Embeddings (knowledge base ingestion)

By default, document ingestion uses **Ollama** for embeddings (`nomic-embed-text`). To use **Vertex AI** embeddings instead (no local model needed):

```bash
# 1. Create the platform SA secret (same SA as for LLM, or a dedicated one)
kubectl create secret generic recif-platform-gcp-sa \
  -n recif-system \
  --from-file=credentials.json=sa-key.json

# 2. Enable in Helm
helm upgrade recif deploy/helm/recif \
  --set llm.gcp.project=my-project-123
```

This switches the embedding model to `text-embedding-005` (Vertex AI). See [Marée Pipeline](../maree/pipeline.md#vertexembeddingtransformer-google-cloud) for details.

---

## Background model

Use a cheaper/faster model for background tasks (memory extraction, follow-up suggestions, auto-titles):

```yaml
spec:
  modelType: anthropic
  modelId: claude-sonnet-4-20250514
  backgroundModel: google-ai:gemini-2.5-flash
```

URI format: `provider:model_id`. The background model must have its own credentials in the same `agent-env` Secret.

---

## Custom providers

Register a custom provider at import time:

```python
from corail.models.factory import register_model

register_model(
    "my-llm",              # CORAIL_MODEL_TYPE value
    "my_package.models",   # Python module path
    "MyModel",             # Class name (must extend corail.models.base.Model)
    "default-v1",          # Default model ID
)
```

The class must implement at minimum:

```python
from corail.models.base import Model

class MyModel(Model):
    async def generate(self, messages: list[dict], **kwargs) -> str:
        ...
```

Optional: `generate_stream` for streaming, `generate_with_tools` + `supports_tool_use` for native tool calling.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `GOOGLE_CLOUD_PROJECT not set` | No project in env or key file | Use a service account key (project auto-detected) or set `GOOGLE_CLOUD_PROJECT` in the Secret |
| `No Vertex AI credentials found` | Secret not mounted or wrong path | Check `kubectl describe pod` for volume mounts, verify the Secret exists |
| `403 Permission denied` | SA missing `aiplatform.user` role | `gcloud projects add-iam-policy-binding ...` (step 2) |
| `Could not deserialize key data` | Corrupted key file | Re-download: `gcloud iam service-accounts keys create ...` |
| `ImportError: PyJWT[crypto]` | Missing dependency | The Docker image includes it by default. If running outside Docker: `pip install 'corail[vertex]'` |
| `API has not been enabled` | Vertex AI API not activated | `gcloud services enable aiplatform.googleapis.com` (step 1) |
| `Connection refused` (Ollama) | Ollama not running | Check `ollama.enabled: true` in Helm values |
| `401 Unauthorized` (OpenAI/Anthropic) | Invalid API key | Regenerate from provider console, update the `agent-env` Secret |
