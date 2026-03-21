---
sidebar_position: 1
---

# Installation

Deploy Récif on a local Kubernetes cluster in minutes.

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| [Docker](https://docs.docker.com/get-docker/) | Container runtime | `brew install docker` |
| [Colima](https://github.com/abiosoft/colima) | Local Docker VM (macOS) | `brew install colima` |
| [Kind](https://kind.sigs.k8s.io/) | Local K8s cluster | `brew install kind` |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | K8s CLI | `brew install kubectl` |
| [Helm](https://helm.sh/docs/intro/install/) | K8s package manager | `brew install helm` |

## Quick start

```bash
git clone https://github.com/recif-platform/recif.git
cd recif

# Start Docker runtime
colima start --cpu 4 --memory 8 --disk 60

# Run the setup (builds images, creates cluster, installs Helm chart)
bash deploy/kind/setup.sh
```

## Step-by-step (manual)

If you prefer to understand each step:

### 1. Start Docker and create the cluster

```bash
colima start --cpu 4 --memory 8 --disk 60

kind create cluster --config deploy/kind/kind-config.yaml
```

### 2. Build the platform images

```bash
# API server (Go + Marée Python sidecar)
docker build -t ghcr.io/recif-platform/recif-api:latest -f recif/Dockerfile .

# Dashboard (Next.js)
docker build -t ghcr.io/recif-platform/recif-dashboard:latest -f recif/dashboard/Dockerfile recif/dashboard

# Operator (Go)
docker build -t ghcr.io/recif-platform/recif-operator:latest -f recif-operator/Dockerfile recif-operator

# Corail agent runtime (Python)
docker build -t ghcr.io/recif-platform/corail:latest -f corail/Dockerfile corail
```

### 3. Load images into Kind

Kind runs K8s inside Docker containers — images must be loaded explicitly:

```bash
for img in recif-api recif-dashboard recif-operator corail; do
  kind load docker-image "ghcr.io/recif-platform/${img}:latest" --name recif
done

# Also load the PostgreSQL image to avoid slow in-cluster pulls
docker pull pgvector/pgvector:pg16
kind load docker-image pgvector/pgvector:pg16 --name recif
```

### 4. Create namespaces and install Helm chart

```bash
kubectl create namespace recif-system
kubectl create namespace team-default

helm upgrade --install recif deploy/helm/recif \
  --namespace recif-system \
  --set ingress.enabled=false
```

### 5. Wait for pods

```bash
kubectl get pods -n recif-system -w
```

Expected output (after 1-2 minutes):

```
NAME                               READY   STATUS    AGE
recif-api-...                      1/1     Running   60s
recif-dashboard-...                1/1     Running   60s
recif-operator-...                 1/1     Running   60s
recif-postgresql-0                 1/1     Running   60s
```

### 6. Access the platform

```bash
kubectl port-forward svc/recif-api 8080:8080 -n recif-system &
kubectl port-forward svc/recif-dashboard 3000:3000 -n recif-system &
kubectl port-forward svc/recif-postgresql 5433:5432 -n recif-system &
```

- **Dashboard**: http://localhost:3000
- **API**: http://localhost:8080
- **PostgreSQL**: `localhost:5433` (user: `recif`, password: `recif_dev`)

## Configure an LLM provider

By default agents use `stub` mode (echo). Connect a real LLM:

### API key providers (OpenAI, Anthropic, Google AI)

```bash
# Example: OpenAI
kubectl create secret generic agent-env \
  -n team-default \
  --from-literal=OPENAI_API_KEY=sk-...
```

### Vertex AI (Google Cloud — service account)

```bash
# 1. Create the secret with your service account key
kubectl create secret generic <agent-name>-gcp-sa \
  -n team-default \
  --from-file=credentials.json=sa-key.json

# 2. Create the agent with modelType: vertex-ai in the dashboard
#    The operator auto-mounts the credentials
```

See [LLM Providers](../corail/llm-providers.md) for all providers and detailed setup.

## Verify

```bash
# Check CRDs are installed
kubectl get crd agents.agents.recif.dev

# Check namespaces
kubectl get ns | grep -E "recif-system|team-default"

# List agents (should be empty initially)
kubectl get agents -n team-default

# Test the API
curl http://localhost:8080/healthz
```

## Teardown

```bash
kind delete cluster --name recif
colima stop
```
