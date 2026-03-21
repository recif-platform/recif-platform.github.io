# Tech Spec: GenAI Lifecycle, Evaluation & Deployment Strategies

**Status:** Phase 1-3 Implemented (2026-03-29)
**Author:** Adham + Claude
**Date:** 2026-03-27

## Problem

We've been implementing deployment strategies (canary, A/B testing) and evaluation piecemeal, reinventing connectors that already exist. The result: buggy Istio resources, broken labels, custom handlers that duplicate what Flagger and MLflow already do.

We need a unified design that:
1. Uses existing tools (MLflow, Flagger, Istio) — don't reinvent
2. Covers the FULL GenAI lifecycle — not just "eval before deploy"
3. Supports all relevant deployment strategies
4. Is clean architecturally

## Core Principle: Don't Reinvent

| Need | Existing Tool | License | What it does |
|------|--------------|---------|--------------|
| Experiment tracking | MLflow | Apache 2.0 | Runs, metrics, params, artifacts |
| Prompt versioning | MLflow Prompt Registry | Apache 2.0 | Immutable prompt versions, diff, aliases |
| Tracing | MLflow Tracing | Apache 2.0 | Span-based traces for every agent call |
| Evaluation | MLflow GenAI Evaluate | Apache 2.0 | Scorers, golden datasets, LLM-as-judge |
| User/expert feedback | MLflow Feedback | Apache 2.0 | Attach ratings to traces |
| Trace exploration | MLflow MCP Server | Apache 2.0 | AI assistant explores traces via MCP |
| Canary deployment | Flagger | Apache 2.0 | Progressive delivery, auto-promote/rollback |
| A/B testing (prod) | Flagger | Apache 2.0 | Header-based routing |
| Traffic management | Istio VirtualService | Apache 2.0 | Weight-based, header-based routing |
| Blue-green | Flagger | Apache 2.0 | Full environment swap |
| Metrics | Prometheus + Istio | Apache 2.0 | Latency, error rate, throughput |

**Récif's role**: Orchestrate these tools, provide the UI, map versions to experiments.
**Récif does NOT**: Create VirtualServices manually, manage canary labels, build custom traffic splitting.

---

## Part 1: MLflow as the GenAI Lifecycle Backbone

### What MLflow manages for us

```
Agent "Poe" = MLflow Experiment "recif/agents/poe"
│
├── Prompt Registry
│   ├── poe/v1 — "Tu es Poe, un assistant..."
│   ├── poe/v2 — "Tu es Poe amélioré..."  (immutable, diffable)
│   └── poe/v3 — "Tu es Poe v3, concis..."
│   └── Aliases: production=v2, staging=v3
│
├── Tracing (every conversation, every tool call)
│   ├── trace-001: user="salut" → agent="Salut! Comment..." [latency=2.3s, tokens=145]
│   ├── trace-002: user="calcule 2+2" → tool_call=calculator → "4" [latency=0.8s]
│   └── trace-003: user="résume ce doc" → rag_retrieval → response [latency=4.1s]
│
├── Evaluation Runs
│   ├── run-001: golden-v1.jsonl against v2 → exact_match=0.87, contains=0.94
│   ├── run-002: golden-v1.jsonl against v3 → exact_match=0.91, contains=0.96
│   └── run-003: comparison v2 vs v3 → v3 wins (+4% exact_match)
│
├── Feedback
│   ├── trace-001: user_rating=4/5, expert_note="Good but verbose"
│   ├── trace-002: user_rating=5/5
│   └── trace-003: expert_label="hallucination detected"
│
└── Metrics over time
    ├── avg_latency, p95_latency
    ├── avg_quality_score
    ├── user_satisfaction_rate
    └── cost_per_request
```

### Integration points (Corail → MLflow)

```python
# In Corail agent pipeline — auto-trace every request
import mlflow

mlflow.set_tracking_uri("http://mlflow:5000")
mlflow.set_experiment("recif/agents/poe")

# 1. Auto-tracing (every conversation)
with mlflow.start_span("chat_request") as span:
    span.set_inputs({"user_input": message})
    response = await pipeline.execute(message)
    span.set_outputs({"response": response})
    # Trace is automatically logged

# 2. Prompt from registry
prompt = mlflow.genai.load_prompt("poe", version=3)
# or by alias
prompt = mlflow.genai.load_prompt("poe", alias="production")

# 3. Log user feedback
mlflow.log_feedback(
    trace_id=trace.trace_id,
    name="user_rating",
    value=4,
    source={"type": "user", "id": "user123"}
)

# 4. Run evaluation
results = mlflow.genai.evaluate(
    data=golden_dataset,
    predict_fn=pipeline.execute,
    scorers=[mlflow.genai.scorers.Relevance(), mlflow.genai.scorers.Safety()],
)
```

### What Récif does with MLflow data

Récif READS from MLflow and DISPLAYS in its dashboard. It does NOT duplicate storage.

| Dashboard Section | MLflow Source |
|-------------------|-------------|
| Agent Evaluation tab | `mlflow.search_runs()` → scores, metrics |
| Trace viewer | `mlflow.search_traces()` → conversation history |
| Prompt versions | `mlflow.genai.search_prompt_versions()` → prompt history |
| Feedback stats | `mlflow.search_traces()` with feedback → satisfaction rates |
| Quality trends | `mlflow.get_metric_history()` → charts over time |

### MLflow MCP Server

Deploy the MLflow MCP Server alongside Récif. This allows:
- AI agents to explore their own traces ("find my slowest requests")
- Debugging via Claude Code ("why did trace-003 hallucinate?")
- Auto-analysis of failure patterns

---

## Part 2: Deployment Strategies for AI Agents

### Which strategies apply to AI agents

| Strategy | Applicable? | When | How |
|----------|------------|------|-----|
| **Canary** | Yes | New version to prod gradually | Flagger + Istio progressive traffic shift |
| **A/B Testing** | Yes | Compare two versions with real users | Flagger header-based routing OR direct service routing |
| **Shadow Evaluation** | Yes | Test new version without serving to users | Duplicate requests to shadow pod, compare responses |
| **Blue-Green** | Yes | Zero-downtime full swap | Flagger blue-green mode |
| **Rolling** | Yes (default) | Standard K8s rollout | K8s Deployment rolling update (what we do now) |
| **Feature Flag** | Yes | Enable/disable skills, tools, models | Config-driven, no redeploy needed |
| **Multi-Arm Bandit** | Future | Auto-optimize model selection | Dynamic traffic based on real-time performance |
| **Recreate** | Rarely | Full infrastructure rebuild | K8s Recreate strategy |

### Flagger handles canary, A/B, blue-green

Instead of our custom `canary_handler.go` which manually creates VirtualServices and DestinationRules (and breaks), we use **Flagger**.

Flagger CRD:
```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: poe
  namespace: team-default
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: poe
  service:
    port: 8000
  analysis:
    # Canary analysis configuration
    interval: 30s
    threshold: 5           # max failed checks before rollback
    maxWeight: 50          # max canary traffic weight
    stepWeight: 10         # increment per step (10% → 20% → ... → 50%)
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 30s
      - name: request-duration
        thresholdRange:
          max: 500         # max 500ms p99 latency
        interval: 30s
    # Custom metrics from MLflow (via webhook)
    webhooks:
      - name: mlflow-quality-gate
        url: http://recif-api.recif-system:8080/api/v1/webhooks/flagger
        type: rollout
        metadata:
          type: "quality-gate"
```

When we update the Deployment (new image, new ConfigMap hash), Flagger:
1. Creates `poe-primary` (stable) and `poe-canary` (new version)
2. Creates VirtualService + DestinationRule with correct labels
3. Gradually shifts traffic: 0% → 10% → 20% → 30% → 40% → 50%
4. At each step, checks Istio metrics + our MLflow quality gate
5. If all checks pass → promotes canary to primary
6. If any check fails → rolls back automatically

We don't write ANY Istio resources manually.

### Compare Versions (admin testing)

This is NOT canary. This is the admin testing two versions side by side before deciding to deploy.

```
Compare mode (what we have in chat):
- Two K8s Services: poe (stable) + poe-v4 (candidate)
- Dashboard sends same prompt to both
- Admin sees responses side by side
- No Istio needed, just direct service routing
- Can also run automated eval (golden dataset) against both
```

This stays as-is — it's simple, it works, it doesn't need Flagger.

### Shadow Evaluation

New strategy — useful for AI agents:

```
Shadow mode:
- Stable agent serves the real response to the user
- Shadow agent receives the same request in parallel (fire-and-forget)
- Shadow response is logged to MLflow but NOT sent to user
- Eval scorers compare shadow vs stable responses
- Zero risk, full evaluation with real traffic
```

Implementation:
- Proxy duplicates the request to `{slug}-shadow` service
- Shadow pod runs, response logged to MLflow trace
- Dashboard shows shadow analysis in eval tab

---

## Part 3: Version = Unit of Everything

Every change creates a new version (release). A version is the immutable unit for:

```
Version v4 of "Poe"
├── Config: model=qwen3.5:35b, skills=[agui-render, code-review], prompt=v4
├── Artifact: agents/poe/releases/v4.yaml (in recif-state Git repo)
├── MLflow prompt: poe/v4 (in Prompt Registry)
├── MLflow experiment run: poe-v4-eval (evaluation results)
├── Deployment: poe Deployment with ConfigMap hash matching v4
└── Flagger: if canary, tracked as canary release of poe
```

### The full workflow

```
┌────────────────────────────────────────────────────────────────┐
│ 1. CREATE / MODIFY                                             │
│                                                                │
│ User changes config (prompt, model, skills, tools)             │
│ → New version v4 committed to recif-state                      │
│ → Prompt v4 registered in MLflow Prompt Registry               │
│ → Version visible in Récif Releases tab                        │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. EVALUATE                                                    │
│                                                                │
│ Option A: Automated eval                                       │
│   Run golden dataset against v4 → scores logged in MLflow      │
│   Compare v3 (current) vs v4 (candidate)                       │
│                                                                │
│ Option B: Admin A/B test                                       │
│   Compare versions in split-screen chat                        │
│   Admin sends same prompts, compares responses                 │
│                                                                │
│ Option C: Shadow evaluation                                    │
│   Deploy v4 as shadow, real traffic duplicated                 │
│   Responses logged but not served to users                     │
│                                                                │
│ All results stored in MLflow. Dashboard reads from MLflow.     │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. DEPLOY                                                      │
│                                                                │
│ Option A: Direct deploy (rolling update)                       │
│   Update Deployment → K8s rolling update                       │
│   Fast, simple, no traffic splitting                           │
│                                                                │
│ Option B: Canary (via Flagger)                                 │
│   Update Deployment → Flagger detects change                   │
│   Progressive: 10% → 20% → 30% → 50% → 100%                  │
│   Metrics check at each step (Istio + MLflow quality gate)     │
│   Auto-promote or auto-rollback                                │
│                                                                │
│ Option C: Blue-green (via Flagger)                             │
│   Full swap, zero downtime                                     │
│                                                                │
│ Option D: Feature flag                                         │
│   Enable/disable via config, no redeploy                       │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. MONITOR (continuous, production)                            │
│                                                                │
│ MLflow Tracing: every conversation traced automatically        │
│ User feedback: ratings attached to traces                      │
│ Expert review: domain experts label traces                     │
│ Quality trends: scores over time in MLflow                     │
│ Istio metrics: latency, error rate, throughput (Prometheus)    │
│ AI Radar: Récif dashboard aggregates all metrics               │
│                                                                │
│ MLflow MCP Server: agents can explore their own traces         │
│                                                                │
│ If quality degrades → alert → evaluate → new version → loop   │
└────────────────────────────────────────────────────────────────┘
```

---

## Part 4: What to Refactor

### Remove (our custom implementations)
- `canary_handler.go` — Flagger handles this
- Manual VirtualService/DestinationRule creation in `k8s_writer.go` — Flagger handles this
- Manual canary Service creation — Flagger handles this
- Mock eval data in `eval/handler.go` — MLflow is the source

### Keep
- Release pipeline (Git-backed artifacts) — this is our version system
- Compare mode in chat (A/B test) — simple, works, no Istio needed
- EvaluationProvider interface — but wire it to real MLflow, not mocks
- K8sReader/K8sWriter — but remove canary methods from Writer

### Add
- MLflow integration in Corail (auto-tracing, prompt registry)
- MLflow Prompt Registry sync (release → prompt version)
- Flagger Canary CRD management (create/delete Flagger Canary resource)
- Shadow evaluation proxy mode
- Webhook endpoint for Flagger quality gate (`/api/v1/webhooks/flagger`)
- User feedback API (attach ratings to traces via MLflow)
- Dashboard: read eval/traces/feedback from MLflow instead of mocks

### Infrastructure to deploy
- MLflow server (Docker, in-cluster or external)
- Flagger controller (Helm install, one-time)
- Prometheus (for Flagger metrics analysis)

---

## Part 5: Implementation Plan

### Phase 1: MLflow Foundation -- DONE (2026-03-29)
1. ~~Deploy MLflow server in K8s~~ -- PostgreSQL backend, PVC, health probes
2. ~~Wire Corail auto-tracing~~ -- `@mlflow.trace`, `set_active_model()`, real token counts via autolog
3. Sync releases to MLflow Prompt Registry -- planned v0.2
4. ~~Wire EvalRunner to real MLflow~~ -- `mlflow.genai.evaluate()` with 14 LLM-judge scorers, registry pattern
5. ~~Dashboard reads from MLflow API~~ -- governance scorecard queries MLflow, fallback to mock

### Phase 2: Flagger for Deployments -- PARTIAL
1. Install Flagger in K8s (`helm install flagger`)
2. Create Flagger Canary CRD for agents
3. ~~Webhook quality gate~~ -- `POST /api/v1/webhooks/flagger` endpoint implemented
4. Custom canary_handler.go kept for non-Flagger environments
5. Dashboard shows Flagger status -- planned

### Phase 3: Full Lifecycle -- DONE (2026-03-29)
1. ~~User feedback API~~ -- `POST /api/v1/feedback`, proxied to MLflow assessments, negative feedback flagged
2. Shadow evaluation mode -- planned v0.2
3. MLflow MCP Server deployment -- planned v0.2
4. ~~Quality trends~~ -- governance scorecard reads real MLflow data
5. Feature flags -- planned v0.2

### Phase 4: Advanced
1. Multi-Arm Bandit (dynamic model selection)
2. Auto-evaluation triggers (on every N conversations)
3. Quality regression alerts
4. Prompt optimization (MLflow's auto-improve prompts)

---

## Open Questions

1. **MLflow deployment**: In-cluster (StatefulSet + PG backend) or external (Databricks managed)?
2. **Flagger + our operator**: Do they conflict? Our operator creates Deployments, Flagger manages them. Need to test coexistence.
3. **Shadow mode latency**: Duplicating requests doubles LLM costs. Make it configurable (sample rate).
4. **Feedback UX**: Thumbs up/down in chat? Star rating? Expert annotation interface?
5. **Prompt Registry vs recif-state**: Are these redundant? Or does recif-state store the full artifact and MLflow just the prompt text?
