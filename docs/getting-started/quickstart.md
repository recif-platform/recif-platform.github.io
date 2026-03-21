---
sidebar_position: 2
---

# Quickstart

Deploy your first agent on Récif in under five minutes.

## 1. Create an Agent manifest

Save this as `my-agent.yaml`:

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-first-agent
  namespace: team-default
spec:
  name: "My First Agent"
  framework: adk
  strategy: simple
  channel: rest
  modelType: stub
  modelId: stub-echo
  systemPrompt: "You are a helpful assistant."
  image: corail:latest
  replicas: 1
```

This defines an agent using the `stub` model (echo mode -- no LLM required) with the `simple` strategy and `rest` channel.

## 2. Apply it

```bash
kubectl apply -f my-agent.yaml
```

The operator detects the new `Agent` resource and creates:

- A **ConfigMap** (`my-first-agent-config`) with all `CORAIL_*` environment variables
- A **Deployment** running the `corail:latest` image with liveness/readiness probes
- A **Service** (`my-first-agent`) on port 8000

## 3. Check status

```bash
kubectl get agents -n team-default
```

Expected output:

```
NAME             PHASE     REPLICAS   ENDPOINT                                                    AGE
my-first-agent   Running   1          http://my-first-agent.team-default.svc.cluster.local:8000   30s
```

You can also inspect the created resources:

```bash
kubectl get pods -n team-default
kubectl get svc -n team-default
kubectl get configmap my-first-agent-config -n team-default -o yaml
```

## 4. Talk to the agent

Port-forward to access the agent locally:

```bash
kubectl port-forward -n team-default svc/my-first-agent 8000:8000
```

Then send a chat request:

```bash
curl -X POST http://localhost:8000/api/v1/agents/ag_TESTAGENTSTUB00000000000/chat \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello, agent!", "conversation_id": "conv-001"}'
```

The response is an SSE stream with execution events.

## 5. Open the dashboard

If you have the dashboard running locally:

```bash
cd recif/dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your agents, start conversations, and view chat history.

## Next steps

- Use a real LLM by setting `modelType: ollama` and `modelId: qwen3.5:35b` (requires Ollama running)
- Explore the [Agent CRD spec](/docs/recif/operator) for all available fields
- Read about [Corail configuration](/docs/corail/configuration) for environment variables
- Learn how the [architecture](/docs/architecture/overview) fits together
