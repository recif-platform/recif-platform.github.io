---
sidebar_position: 1
slug: /intro
---

# What is Récif?

Récif is an open-source, Kubernetes-native platform for deploying, managing, and governing AI agents at scale. It is built around a two-layer architecture:

- **Corail** -- An autonomous Python agent runtime. Each agent runs as its own container with pluggable channels, strategies, models, and storage backends.
- **Récif** -- The platform layer: a Go API server, a Kubernetes operator (reconciling Agent CRDs into Deployments + Services + ConfigMaps), a Next.js dashboard, a CLI, and a Helm chart for installation.

Every agent runs as its own Kubernetes Pod. The operator watches `Agent` custom resources and creates the underlying Deployment, Service, and ConfigMap automatically. The Récif API proxies chat requests from the dashboard to the correct agent Pod via in-cluster DNS.

## Key design principles

- **One agent = one Pod.** Agents are isolated at the container and namespace level.
- **Registry pattern everywhere.** Corail uses `importlib`-based registries for models, strategies, channels, and storage -- add a new backend by registering a module path, no code changes needed.
- **Kubernetes-native.** Agent lifecycle is declared via CRDs and reconciled by the operator. Istio provides mTLS and observability. Namespace-per-team for multi-tenancy.
- **Enterprise governance.** The platform includes agent versioning, status lifecycle (registered, draft, active, archived), risk profiles, and evaluation datasets.

## Components at a glance

| Component | Language | Description |
|-----------|----------|-------------|
| **Corail** | Python (FastAPI) | Agent runtime -- models, strategies, channels, storage |
| **Récif API** | Go (Chi) | Platform API -- agent CRUD, chat proxy, evaluations |
| **Récif Operator** | Go (controller-runtime) | K8s operator -- reconciles Agent CRDs |
| **Dashboard** | TypeScript (Next.js) | Web UI for managing agents and conversations |
| **CLI** | Go (Cobra) | `recif` command-line tool |
| **Helm Chart** | YAML | Single-command installation of the entire platform |
