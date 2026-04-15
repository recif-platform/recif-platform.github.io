---
sidebar_position: 1
---

# Installation

Deploy Récif on a local Kubernetes cluster in minutes.

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| [Docker](https://docs.docker.com/get-docker/) | Container runtime | `brew install docker` |
| [Colima](https://github.com/abiosoft/colima) | Local Docker + K8s (macOS) | `brew install colima` |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | K8s CLI | `brew install kubectl` |
| [Helm](https://helm.sh/docs/intro/install/) | K8s package manager | `brew install helm` |
| [istioctl](https://istio.io/latest/docs/setup/getting-started/) | Service mesh (for canary) | `brew install istioctl` |

## 1. Start the cluster

```bash
colima start --cpu 4 --memory 8 --disk 60 --kubernetes
```

Verify:

```bash
kubectl get nodes
# NAME     STATUS   ROLES           AGE   VERSION
# colima   Ready    control-plane   10s   v1.35.0+k3s1
```

## 2. Build the platform images

```bash
# From the repo root:
docker build -t ghcr.io/recif-platform/recif-api:latest -f recif/Dockerfile .
docker build -t ghcr.io/recif-platform/recif-operator:latest -f recif-operator/Dockerfile recif-operator/
docker build -t ghcr.io/recif-platform/recif-dashboard:latest -f recif/dashboard/Dockerfile recif/dashboard/
docker build -t ghcr.io/recif-platform/corail:latest -f corail/Dockerfile corail/
```

## 3. Install with Helm

```bash
helm install recif deploy/helm/recif/ \
  --namespace recif-system --create-namespace \
  --set global.imagePullPolicy=Never
```

Wait for pods:

```bash
kubectl get pods -n recif-system -w
```

Expected (after 1-2 minutes):

```
recif-api-...          1/1   Running
recif-dashboard-...    1/1   Running
recif-operator-...     1/1   Running
recif-postgresql-0     1/1   Running
```

## 4. Install Istio + Kiali (local dev)

Istio enables canary deployments and the Kiali service mesh dashboard. For local development, install it with the provided script:

```bash
bash deploy/scripts/setup-istio.sh
```

This installs Istio (demo profile), Kiali, Prometheus, and enables sidecar injection on the `team-default` namespace.

> **Production note**: In production, Istio is typically already installed by your ops team. Récif detects Istio automatically and enables canary features when the mesh is present. If Istio is not yet installed in your production cluster, install it separately following the [official Istio docs](https://istio.io/latest/docs/setup/install/) — do not use the demo profile in production. Then simply deploy Récif; it will detect the mesh and work with it.

## 5. Access the platform

```bash
kubectl port-forward -n recif-system svc/recif-api 8080:8080 &
kubectl port-forward -n recif-system svc/recif-dashboard 3000:3000 &
kubectl port-forward -n mlflow-system svc/mlflow 5000:5000 &
kubectl port-forward -n istio-system svc/kiali 20001:20001 &
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8080 |
| MLflow | http://localhost:5000 |
| Kiali | http://localhost:20001 |

## 6. Configure an LLM provider

By default, agents use `stub` mode (echo). Connect a real LLM:

### Local models (Ollama)

If you have Ollama running locally:

```bash
helm upgrade recif deploy/helm/recif/ -n recif-system \
  --set ollama.baseUrl=http://host.docker.internal:11434 \
  --reuse-values
```

### API key providers (OpenAI, Anthropic, Google AI)

```bash
# Create a secret values file (gitignored)
cp deploy/helm/values-secret.yaml.example deploy/helm/values-secret.yaml
# Edit with your keys, then:
helm upgrade recif deploy/helm/recif/ -n recif-system \
  -f deploy/helm/values-secret.yaml --reuse-values
```

See [LLM Providers](../corail/llm-providers.md) for all 7 providers and detailed setup.
See [Secret Management](../recif/secret-management.md) for production secret strategies (Vault, GCP SM, Workload Identity).

## 7. Verify

```bash
# CRDs installed
kubectl get crd agents.agents.recif.dev

# Namespaces
kubectl get ns | grep -E "recif|team|mlflow|istio"

# API healthy
curl http://localhost:8080/healthz

# Create your first agent (via dashboard or API)
curl -X POST http://localhost:8080/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent","framework":"corail","modelType":"stub","modelId":"stub-echo","channel":"rest","version":"0.1.0"}'
```

## Teardown

```bash
colima delete --force
```
