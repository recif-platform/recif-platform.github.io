---
sidebar_position: 6
---

# Secret Management

Récif needs credentials to reach LLM providers (API keys) and cloud services (GCP service accounts). This guide covers three strategies, from the simplest local setup to production-grade external secrets.

## Architecture overview

```
                        ┌──────────────────────────────────────────┐
                        │         Your secret backend              │
                        │  (Vault, GCP SM, AWS SM, Azure KV, ...) │
                        └─────────────────┬────────────────────────┘
                                          │  sync
                        ┌─────────────────▼────────────────────────┐
                        │   External Secrets Operator (ESO)        │
                        │   Watches ExternalSecret CRDs            │
                        │   Creates/refreshes K8s Secrets          │
                        └─────────────────┬────────────────────────┘
                                          │  creates
┌────────────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Secrets                                 │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │   agent-env     │  │    gcp-adc      │  │  recif-platform-gcp-sa   │  │
│  │  (LLM API keys) │  │ (agent GCP SA)  │  │    (API / Maree SA)      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────────┬─────────────┘  │
└───────────┼─────────────────────┼────────────────────────┼───────────────-┘
            │ envFrom             │ volumeMount            │ volumeMount
  ┌─────────▼──────────┐  ┌──────▼─────────┐  ┌───────────▼────────────┐
  │    Agent pods      │  │   Agent pods   │  │     API / Maree pod    │
  │ (team-default ns)  │  │ /var/secrets/  │  │   /var/secrets/gcp/    │
  └────────────────────┘  └────────────────┘  └────────────────────────┘
```

The platform expects three K8s Secrets. How you create them depends on your strategy:

| Secret | Namespace | Contains | Used by |
|--------|-----------|----------|---------|
| `agent-env` | `team-default` | LLM API keys (OPENAI_API_KEY, etc.) | Agent pods (envFrom) |
| `gcp-adc` | `team-default` | GCP service account JSON | Agent pods (volume mount) |
| `recif-platform-gcp-sa` | `recif-system` | GCP service account JSON | API + Maree (volume mount) |

---

## Choosing a strategy

```
                           ┌─────────────────────────┐
                           │  Where do you run?      │
                           └────────────┬────────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                   Local dev        GKE / EKS       Any K8s
                        │               │               │
                        ▼               ▼               ▼
                ┌───────────────┐ ┌───────────┐ ┌───────────────────┐
                │    Inline     │ │  Workload │ │ External Secrets  │
                │ (values.yaml) │ │ Identity  │ │ (Vault, GCP SM,   │
                │               │ │ (no keys) │ │  AWS SM, OpenBao) │
                └───────────────┘ └───────────┘ └───────────────────┘
                secrets.provider:  secrets.provider:  secrets.provider:
                   "inline"           "none"             "external"
```

| Strategy | Best for | Secrets in Git? | Auto-rotation? | Setup effort |
|----------|----------|:---------------:|:--------------:|:------------:|
| **Inline** | Local dev, quickstart | No (gitignored values file) | No | 2 min |
| **External Secrets** | Staging, production | No | Yes | 15 min |
| **Workload Identity** | GKE, EKS | No (no secrets at all) | N/A | 10 min |

---

## 1. Inline (local dev)

The simplest mode. API keys are set in a local values file that is never committed to Git.

### Setup

```bash
# Copy the example file
cp deploy/helm/values-secret.yaml.example deploy/helm/values-secret.yaml

# Edit with your keys
vi deploy/helm/values-secret.yaml
```

Example `values-secret.yaml`:

```yaml
llm:
  googleApiKey: "AIzaSy..."
  openaiApiKey: "sk-proj-..."

  gcp:
    project: "my-project-123"
    location: "us-central1"
    # cat sa-key.json | base64 | tr -d '\n'
    serviceAccountKeyBase64: "eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii..."
```

### Deploy

```bash
# Contributors (from source):
make deploy

# Users (from Helm chart):
helm upgrade recif deploy/helm/recif/ -n recif-system \
  -f deploy/helm/values-secret.yaml
```

The `values-secret.yaml` file is in `.gitignore` — it never leaves your machine.

### How it works

```
values-secret.yaml ──▶ Helm ──▶ K8s Secrets (agent-env, gcp-adc, ...)
                                      │
                                      ▼
                               Agent/API pods mount secrets
```

Helm creates the Secrets directly from the values. If a pod restarts, the Secret is still there because it's a Helm-managed resource.

---

## 2. External Secrets (production)

The **External Secrets Operator (ESO)** syncs secrets from an external backend into K8s Secrets. ESO is [Apache 2.0 licensed](https://github.com/external-secrets/external-secrets) and supports all major backends.

### Supported backends

| Backend | License | Notes |
|---------|---------|-------|
| [HashiCorp Vault](https://www.vaultproject.io/) | BSL | Most widely adopted in enterprise |
| [OpenBao](https://openbao.org/) | MPL 2.0 | Apache-compatible Vault fork (Linux Foundation) |
| [GCP Secret Manager](https://cloud.google.com/secret-manager) | GCP service | Best for Google Cloud users |
| [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/) | AWS service | Best for AWS users |
| [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/) | Azure service | Best for Azure users |
| [Doppler](https://www.doppler.com/) | SaaS | Simple, no self-hosting |

### How it works

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│ Secret Store │     │  ESO controller   │     │   K8s Secret    │
│ (Vault, GCP  │◀────│  watches          │────▶│  (agent-env,    │
│  SM, AWS SM) │     │  ExternalSecret   │     │   gcp-adc)      │
└──────────────┘     │  CRDs in cluster  │     └────────┬────────┘
                     └───────────────────┘              │
                                                        ▼
                                               Agent / API pods
```

1. You store secrets in your backend (Vault path, GCP SM secret, etc.)
2. ESO watches `ExternalSecret` CRDs in the cluster
3. ESO pulls values from the backend and creates real K8s Secrets
4. Pods mount those Secrets as usual — zero code changes
5. ESO auto-refreshes on the configured interval

### Step 1: Install ESO

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace
```

### Step 2: Create a SecretStore

Choose your backend below.

#### Vault / OpenBao

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: recif-secret-store
spec:
  provider:
    vault:
      server: "https://vault.example.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "recif"
          serviceAccountRef:
            name: "recif-operator"
            namespace: "recif-system"
```

Store your secrets in Vault:

```bash
# LLM API keys
vault kv put secret/recif/agent-env \
  GOOGLE_API_KEY="AIzaSy..." \
  OPENAI_API_KEY="sk-proj-..."

# GCP service account (raw JSON content)
vault kv put secret/recif/gcp-sa \
  value=@sa-key.json
```

#### GCP Secret Manager

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: recif-secret-store
spec:
  provider:
    gcpsm:
      projectID: "my-project-123"
      auth:
        workloadIdentity:
          clusterLocation: "us-central1"
          clusterName: "my-cluster"
          clusterProjectID: "my-project-123"
          serviceAccountRef:
            name: "recif-operator"
            namespace: "recif-system"
```

Store your secrets in GCP:

```bash
# LLM API keys (JSON payload)
echo '{"GOOGLE_API_KEY":"AIzaSy...","OPENAI_API_KEY":"sk-proj-..."}' | \
  gcloud secrets create recif-agent-env --data-file=-

# GCP service account
gcloud secrets create recif-gcp-sa --data-file=sa-key.json
```

#### AWS Secrets Manager

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: recif-secret-store
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: "recif-operator"
            namespace: "recif-system"
```

### Step 3: Configure Récif values

```yaml
secrets:
  provider: "external"
  external:
    storeName: "recif-secret-store"
    storeKind: "ClusterSecretStore"
    refreshInterval: "1h"
    keys:
      agentEnv: "recif/agent-env"           # Vault path or secret name
      gcpServiceAccount: "recif/gcp-sa"     # Vault path or secret name
```

### Step 4: Deploy

```bash
helm upgrade recif deploy/helm/recif/ -n recif-system \
  -f my-values.yaml
```

Helm creates `ExternalSecret` CRDs. ESO detects them, pulls from your backend, and creates the K8s Secrets. Verify:

```bash
# Check ExternalSecret sync status
kubectl get externalsecret -n team-default
kubectl get externalsecret -n recif-system

# Expected output:
# NAME                    STORE                REFRESH   STATUS
# agent-env               recif-secret-store   1h        SecretSynced
# gcp-adc                 recif-secret-store   1h        SecretSynced
# recif-platform-gcp-sa   recif-secret-store   1h        SecretSynced
```

---

## 3. Workload Identity (GKE / EKS)

The most secure option: pods authenticate using their Kubernetes service account identity, with no secrets stored anywhere.

### How it works

```
┌────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   GKE / EKS    │     │  Workload Identity  │     │  Cloud APIs      │
│  K8s Service   │────▶│  maps K8s SA to     │────▶│  (Vertex AI,     │
│  Account       │     │  Cloud IAM role     │     │   Secret Mgr)    │
└────────────────┘     └─────────────────────┘     └──────────────────┘
```

No secrets, no rotation, no files. The pod's K8s service account is bound to a cloud IAM role.

### GKE setup

```bash
# 1. Enable Workload Identity on the cluster
gcloud container clusters update my-cluster \
  --workload-pool=my-project-123.svc.id.goog

# 2. Create a GCP service account
gcloud iam service-accounts create recif-sa \
  --display-name="Recif Platform"

# 3. Grant it the roles your agents need
gcloud projects add-iam-policy-binding my-project-123 \
  --member="serviceAccount:recif-sa@my-project-123.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# 4. Bind the K8s SA to the GCP SA
gcloud iam service-accounts add-iam-policy-binding \
  recif-sa@my-project-123.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:my-project-123.svc.id.goog[recif-system/recif-api]"

# 5. Annotate the K8s service account
kubectl annotate serviceaccount recif-api -n recif-system \
  iam.gke.io/gcp-service-account=recif-sa@my-project-123.iam.gserviceaccount.com
```

### Helm values

```yaml
secrets:
  provider: "none"     # No secrets needed — WI handles auth

llm:
  gcp:
    project: "my-project-123"
    location: "us-central1"
    # No serviceAccountKeyBase64 needed
```

LLM API keys (OpenAI, Anthropic) can still be stored via External Secrets alongside Workload Identity for GCP.

---

## Secret lifecycle

### Rotation

| Strategy | How to rotate |
|----------|--------------|
| Inline | Update `values-secret.yaml`, run `helm upgrade` |
| External Secrets | Update the secret in your backend — ESO auto-syncs on `refreshInterval` |
| Workload Identity | Rotate the cloud IAM key (automatic for GCP/AWS managed keys) |

### Adding a new LLM provider

1. **Inline**: add the key to `values-secret.yaml`
2. **External Secrets**: add the key to your backend (e.g. `vault kv patch secret/recif/agent-env ANTHROPIC_API_KEY="sk-ant-..."`)
3. **Workload Identity**: grant the cloud SA the required IAM role

No Helm chart changes needed — `agent-env` is loaded as `envFrom`, so any new key in the Secret is automatically available to agent pods.

---

## Troubleshooting

### Secret not syncing (ESO)

```bash
# Check ESO controller logs
kubectl logs -n external-secrets deploy/external-secrets

# Check ExternalSecret status
kubectl describe externalsecret agent-env -n team-default
```

Common issues:
- **SecretStore auth failed**: check RBAC / service account bindings
- **Key not found**: verify the remote key path matches your backend
- **Stale data**: reduce `refreshInterval` or delete the Secret to force re-sync

### Pod can't read credentials

```bash
# Check if the Secret exists
kubectl get secret agent-env -n team-default
kubectl get secret gcp-adc -n team-default

# Check the pod's env
kubectl exec -n team-default deploy/my-agent -- env | grep -E "GOOGLE|OPENAI"

# Check the mounted credential file
kubectl exec -n team-default deploy/my-agent -- cat /var/secrets/gcp/adc.json
```
