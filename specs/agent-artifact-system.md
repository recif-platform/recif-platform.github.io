# Tech Spec: Agent Artifact System

**Status:** Draft
**Author:** Adham + Claude
**Date:** 2026-03-25

## Problem

Today, agent configuration is scattered across DB (Config JSONB), K8s CRDs, ConfigMaps, and environment variables. Changes are applied via ad-hoc patches with no versioning, no audit trail, no rollback guarantee, and no link between config changes and their impact on quality/governance.

This makes it impossible to:
- Know exactly what config was running when an incident happened
- Rollback reliably to a known-good state
- Compare two versions (diff)
- Run canary deployments (v4 on 10%, v3 on 90%)
- Tie evaluation scores to a specific config version
- Audit who changed what and when

## Solution: Agent Artifact

An **Agent Artifact** is an immutable, versioned, self-contained bundle that fully describes an agent deployment. Nothing outside the artifact influences the agent's behavior.

### Artifact Structure

```yaml
# agent-artifact.yaml
apiVersion: recif.dev/v1
kind: AgentArtifact
metadata:
  name: poe
  version: 4
  previous: 3
  author: adham@recif.dev
  timestamp: "2026-03-25T11:30:00Z"
  changelog: "Added code-review skill, upgraded model to qwen3.5:35b"
  checksum: sha256:abc123def456

# What runs
runtime:
  image: ghcr.io/org/corail@sha256:abc123
  channel: rest
  strategy: agent-react
  replicas: 2
  resources:
    requests: { cpu: 200m, memory: 256Mi }
    limits: { cpu: 1000m, memory: 1Gi }

# How it thinks
agent:
  model:
    provider: ollama
    id: qwen3.5:35b
  system_prompt: |
    You are a helpful assistant.
  skills:
    - agui-render
    - code-review
  tools:
    - calculator
    - web_search
  knowledge_bases:
    - kb_company_docs
  memory:
    backend: pgvector
    connection: postgresql://...

# Safety
governance:
  guards:
    - prompt-injection
    - pii
    - secret
  risk_profile: high
  policies:
    - max_tokens_per_request: 4096
    - max_cost_per_day_usd: 10
    - blocked_topics: [violence, illegal]
  eval_dataset: golden-v2.jsonl
  min_quality_score: 80  # block deploy if eval score < 80

# Where it runs
deployment:
  namespace: team-data
  environment: production
  labels:
    team: data-platform
    tier: production
```

### Properties

| Property | Description |
|----------|-------------|
| **Immutable** | Once created, an artifact never changes. New config = new version. |
| **Self-contained** | Everything needed to deploy is in the artifact. No external state. |
| **Versioned** | Sequential version numbers. Each points to its predecessor. |
| **Checksummed** | SHA256 of the full artifact. Tamper-proof. |
| **Diffable** | Two artifacts can be compared field by field. |
| **Auditable** | Author, timestamp, changelog on every version. |

## Storage: Git Repository (source of truth)

A dedicated Git repo serves as the single source of truth for all agent artifacts,
skills, policies, and platform config. The API commits changes via the GitHub API.

### Repo structure

```
github.com/org/recif-state/              (private repo, managed by Recif)
├── agents/
│   ├── poe/
│   │   ├── releases/
│   │   │   ├── v1.yaml                  artifact v1 (immutable)
│   │   │   ├── v2.yaml                  artifact v2 (immutable)
│   │   │   └── v3.yaml                  artifact v3 (immutable)
│   │   └── current.yaml                 symlink/copy of active version
│   └── infra-bot/
│       ├── releases/
│       │   └── v1.yaml
│       └── current.yaml
├── skills/
│   ├── agui-render/
│   │   └── SKILL.md                     Anthropic format, with scripts/refs
│   ├── code-review/
│   │   └── SKILL.md
│   └── custom-review/
│       ├── SKILL.md
│       └── scripts/
│           └── lint.sh
├── policies/
│   ├── default.yaml                     guardrail policies
│   └── high-risk.yaml
└── platform/
    └── config.yaml                      global platform config
```

### Why Git

| Benefit | How |
|---------|-----|
| **Versioning** | Each artifact = a commit. git log = full history. |
| **Diff** | `git diff v2.yaml v3.yaml` — native, free. |
| **Audit trail** | Who changed what, when, why — in every commit message. |
| **Browsable** | GitHub/GitLab UI — anyone can read the config. |
| **Skills as files** | SKILL.md + scripts/ + references/ live naturally as files. |
| **Rollback** | Deploy v2 = copy v2.yaml to current.yaml + commit. |
| **Multi-cluster** | Each cluster pulls from the same repo. |
| **ArgoCD-ready** | V0.2: ArgoCD watches the repo, syncs to clusters. |
| **No new infra** | Every org already has GitHub/GitLab. |
| **Offline** | Clone the repo, work locally. |

### Deploy flow

```
User modifies agent config (dashboard or CLI)
       |
       v
API Go builds artifact YAML from the new config
       |
       v
API Go commits to recif-state repo via GitHub API
  commit message: "poe: v4 — Added code-review skill (by adham)"
  file: agents/poe/releases/v4.yaml
  file: agents/poe/current.yaml (updated to v4 content)
       |
       v
API Go reads the committed artifact and applies the K8s CRD
       |
       v
Operator detects CRD change -> ConfigMap -> config hash -> pod restart
       |
       v
Agent pod starts with new config
```

### Dual-track: ready-to-use vs custom dev

| | Ready-to-use | Custom dev |
|---|---|---|
| **Image** | `corail:latest` (shared, provided by Recif) | `ghcr.io/user/my-agent:v2` (user-built) |
| **Artifact** | Config YAML only (model, skills, tools, prompt) | Image ref + Config YAML |
| **Stored in** | recif-state repo (agents/{slug}/releases/) | recif-state repo + OCI registry for image |
| **Build** | No build needed — just config | User builds image, pushes to registry |

For ready-to-use agents, the image never changes — only the config artifact does.
For custom dev agents, the artifact also references the custom image digest.

### Configuration

The recif-state repo is configured once at platform setup:

```yaml
# platform/config.yaml or env var
RECIF_STATE_REPO: "org/recif-state"       # GitHub repo
RECIF_STATE_TOKEN: "ghp_xxx"               # GitHub token (write access)
RECIF_STATE_BRANCH: "main"                 # branch to commit to
```

### Future evolution

**V0.1:** API commits directly to GitHub via REST API. Simple, no new components.
**V0.2:** ArgoCD watches the repo and auto-syncs CRDs. The API only commits to Git,
ArgoCD handles the apply. Full GitOps.
**V0.3:** OCI Registry for custom dev images. Cosign signing. Multi-cluster promotion
(dev repo -> staging repo -> prod repo via PR).

## Lifecycle

```
                    ┌──────────┐
                    │  Draft   │  config being edited, not deployed
                    └────┬─────┘
                         │ user clicks "Deploy"
                         ▼
                    ┌──────────┐
                    │  Built   │  artifact created, checksummed, stored
                    └────┬─────┘
                         │ validation passes
                         ▼
                    ┌──────────┐
                    │Validating│  eval run against golden dataset
                    └────┬─────┘
                         │ score >= min_quality_score
                         ▼
                    ┌──────────┐
                    │Deploying │  CRD updated, operator rolling out
                    └────┬─────┘
                         │ pod healthy, health check passes
                         ▼
                    ┌──────────┐
                    │  Active  │  serving traffic
                    └──────────┘
                         │ new version deployed
                         ▼
                    ┌──────────┐
                    │ Archived │  kept for rollback/audit
                    └──────────┘
```

### Quality Gate (optional, governance-driven)

If the agent has a risk_profile and eval_dataset, the deploy pipeline runs evaluation BEFORE deploying:

1. Build artifact
2. Spin up ephemeral agent with artifact config
3. Run eval dataset against it
4. Score >= threshold → deploy
5. Score < threshold → block deploy, notify user

This is the "quality gate" from the governance system.

## API

### Create/Update Config (triggers new artifact)

```
POST /api/v1/agents/{id}/releases
Body: {
  "changelog": "Added code-review skill",
  "config": {
    "model": { "provider": "ollama", "id": "qwen3.5:35b" },
    "skills": ["agui-render", "code-review"],
    "tools": ["calculator", "web_search"],
    ...
  }
}

Response: {
  "version": 4,
  "checksum": "sha256:abc123",
  "status": "built",
  "artifact_url": "ghcr.io/org/recif-agents/poe:v4"  // v0.2
}
```

### List versions

```
GET /api/v1/agents/{id}/releases

Response: {
  "releases": [
    { "version": 4, "status": "active", "author": "adham", "timestamp": "...", "changelog": "..." },
    { "version": 3, "status": "archived", ... },
    { "version": 2, "status": "archived", ... },
    { "version": 1, "status": "archived", ... }
  ]
}
```

### Deploy a specific version

```
POST /api/v1/agents/{id}/releases/{version}/deploy

Response: {
  "status": "deploying",
  "version": 3,
  "message": "Rolling back to v3"
}
```

### Diff two versions

```
GET /api/v1/agents/{id}/releases/diff?from=2&to=4

Response: {
  "changes": [
    { "path": "agent.model.id", "from": "qwen3.5:4b", "to": "qwen3.5:35b" },
    { "path": "agent.skills", "added": ["code-review"], "removed": [] },
    { "path": "runtime.replicas", "from": 1, "to": 2 }
  ]
}
```

### Get artifact detail

```
GET /api/v1/agents/{id}/releases/{version}

Response: {
  "version": 4,
  "status": "active",
  "checksum": "sha256:abc123",
  "author": "adham",
  "timestamp": "2026-03-25T11:30:00Z",
  "changelog": "Added code-review skill",
  "artifact": { ... full artifact YAML as JSON ... }
}
```

## Dashboard UX

### Agent Detail Page - Releases Tab

```
┌─────────────────────────────────────────────────────┐
│ Releases                                    [Deploy] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  v4  ● Active    "Added code-review skill"          │
│      adham · 2 min ago · sha256:abc1...             │
│      [Diff with v3] [Stop]                          │
│                                                     │
│  v3  ○ Archived  "Upgraded model to 35b"            │
│      adham · yesterday · sha256:def4...             │
│      [Diff with v4] [Rollback to v3]                │
│                                                     │
│  v2  ○ Archived  "Added web_search tool"            │
│      adham · 3 days ago · sha256:789a...            │
│      [Diff with v3] [Rollback to v2]                │
│                                                     │
│  v1  ○ Archived  "Initial creation"                 │
│      adham · 1 week ago · sha256:012b...            │
│      [Diff with v2] [Rollback to v1]                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Diff View

```
┌─────────────────────────────────────────────────────┐
│ Diff: v3 → v4                                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  agent.model.id                                     │
│  - qwen3.5:4b                                       │
│  + qwen3.5:35b                                      │
│                                                     │
│  agent.skills                                       │
│  + code-review                                      │
│                                                     │
│  runtime.replicas                                   │
│  - 1                                                │
│  + 2                                                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: V0.1 (DB-backed, minimal)

1. Define `AgentArtifact` Go struct matching the YAML format
2. Create `agent_releases` table in PostgreSQL:
   - id, agent_id, version (auto-increment), artifact (JSONB), checksum, author, changelog, status, created_at
3. `POST /agents/{id}/releases` — build artifact from current config, store in DB, apply CRD
4. `GET /agents/{id}/releases` — list versions
5. `POST /agents/{id}/releases/{v}/deploy` — set version active, update CRD
6. `GET /agents/{id}/releases/diff` — compare two versions
7. Dashboard Releases tab with diff view
8. Every config change goes through the release pipeline (no more direct patches)

### Phase 2: V0.2 (OCI Registry)

1. Push artifact to OCI registry via ORAS
2. Operator pulls artifact from registry (ref in CRD: `spec.artifactRef`)
3. Cosign signing for supply chain security
4. Multi-cluster: each cluster pulls from same registry

### Phase 3: V0.3 (GitOps + Quality Gates)

1. ArgoCD watches Git repo with artifact refs
2. Quality gate: eval before deploy
3. Canary deployments (two artifact versions, traffic split)
4. Promotion pipeline: dev → staging → prod

## Impact on Existing Code

### What changes
- `PATCH /agents/{id}/config` → replaced by `POST /agents/{id}/releases`
- `PUT /agents/{id}/skills` → part of release config
- `POST /agents/{id}/deploy` → becomes `POST /agents/{id}/releases/{v}/deploy`
- Agent detail page: Config tab becomes Releases tab

### What stays
- Operator reconciliation (CRD → ConfigMap → Deployment)
- Agent CRD format (mostly unchanged, adds `spec.releaseVersion`)
- Dashboard chat, memory, skills pages (unchanged)
- Corail runtime (reads ConfigMap, unchanged)

## Open Questions

1. **Naming:** "Release" vs "Artifact" vs "Revision" — which term for the UI?
2. **Auto-deploy:** Should creating a release auto-deploy, or require explicit deploy action?
3. **Draft mode:** Should users be able to edit config without creating a release (draft state)?
4. **Secrets:** How to handle secrets in artifacts (DB connection strings, API keys)? Reference K8s Secrets, never inline.
5. **Image versioning:** Should image changes (new Corail build) also go through the release pipeline?
