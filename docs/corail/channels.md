---
sidebar_position: 3
---

# Channels

Channels are the I/O layer that connects users to agents. Each agent runs exactly one channel, configured via `spec.channel` in the Agent CRD (or `CORAIL_CHANNEL` env var).

## Available channels

| Channel | Value | Protocol | Use case |
|---------|-------|----------|----------|
| REST | `rest` | HTTP + SSE | Dashboard chat, API integrations |
| Discord | `discord` | Discord Gateway | Team chat, community support |

## REST (default)

The REST channel starts a FastAPI server on port 8000 with SSE streaming. This is what the Récif dashboard connects to.

No additional configuration is needed — it works out of the box with `helm install`.

See [API Reference](../recif/api.md) for all available endpoints.

## Discord

The Discord channel connects your agent to a Discord server as a bot. Users interact via slash commands, and the agent streams responses by editing its message in real-time.

### Step 1: Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name (e.g. "Récif Agent")
3. Go to the **Bot** tab:
   - Click **Reset Token** and copy the token (you'll need it in step 3)
   - Enable **Message Content Intent** under Privileged Gateway Intents
4. Go to **OAuth2 → URL Generator**:
   - **Scopes**: select `bot` and `applications.commands`
   - **Bot Permissions**: select `Send Messages`, `Read Messages/View Channels`, `Embed Links`
   - Copy the generated URL and open it in your browser to invite the bot to your server

### Step 2: Store the token as a Kubernetes Secret

```bash
kubectl create secret generic discord-bot -n team-default \
  --from-literal=DISCORD_BOT_TOKEN=<your-bot-token>
```

### Step 3: Create the Agent

```yaml
apiVersion: agents.recif.dev/v1
kind: Agent
metadata:
  name: my-discord-agent
  namespace: team-default
spec:
  name: "My Discord Agent"
  framework: corail
  channel: discord                    # ← this is the key setting
  strategy: agent-react
  modelType: ollama
  modelId: "qwen3.5:35b"
  backgroundModel: "ollama:qwen3.5:4b"
  systemPrompt: |
    You are a helpful assistant on Discord.
    Keep responses concise (under 1500 chars when possible).
    Cite source documents when using knowledge base context.
    Respond in the user's language.
  knowledgeBases:
    - kb_01ABC...                     # optional: attach a knowledge base
  tools:
    - web_search                      # optional: give the agent tools
  envSecrets:
    - agent-env                       # default LLM API keys
    - discord-bot                     # the secret from step 2
  image: "ghcr.io/recif-platform/corail:v0.1.0"
  replicas: 1
```

Apply it:

```bash
kubectl apply -f my-discord-agent.yaml
```

### Step 4: Use it

In any channel on your Discord server, type:

```
/chat message:Hello, what can you do?
```

The bot will acknowledge the command, then stream its response by editing the message as tokens arrive (respecting Discord's rate limits).

### Available slash commands

| Command | Description |
|---------|-------------|
| `/chat message:<text>` | Send a message to the agent |
| `/clear` | Clear your conversation history |
| `/status` | Show agent model, strategy, and storage info |

### How it works

```
User types /chat → Discord Gateway → Agent Pod (discord.py)
                                          ↓
                                    Pipeline.execute_stream()
                                          ↓
                                    Edit Discord message every ~1.5s
                                          ↓
                                    Final message with sources footer
```

- Conversations are **persisted per Discord user** (`discord_{user_id}`) in the configured storage backend (PostgreSQL by default). The agent remembers context across messages.
- **RAG sources** are appended as a footer at the end of each response when knowledge bases are attached.
- **Streaming** works by editing the same message repeatedly (Discord caps messages at 2000 characters).
- **Health probes**: the Discord channel starts a lightweight HTTP health endpoint on port 8000 alongside the bot so Kubernetes liveness/readiness probes pass normally.

### Guild-specific command sync

By default, slash commands sync globally which can take up to 1 hour. For instant registration on a specific server, set `DISCORD_GUILD_ID`:

```bash
# Add to your discord-bot secret or agent configmap
kubectl patch secret discord-bot -n team-default --type=merge \
  -p '{"stringData":{"DISCORD_GUILD_ID":"123456789012345678"}}'
```

Replace the value with your Discord server (guild) ID. Commands will appear instantly after the agent pod restarts.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Bot appears offline | Pod is crashing | `kubectl logs -n team-default deploy/my-discord-agent` |
| `/chat` doesn't appear | Commands still syncing | Wait up to 1 hour, or set `DISCORD_GUILD_ID` for instant sync |
| Bot says "Something went wrong" | Pipeline error (model down, DB issue) | Check pod logs for the full traceback |
| "DISCORD_BOT_TOKEN env var not set" | Secret not mounted | Verify `envSecrets` includes `discord-bot` in the Agent CRD |
| Response truncated | Discord 2000 char limit | Agent is told to keep responses concise; long answers are clipped |

### Feedback Reactions

After each response, the bot automatically adds 👍 and 👎 reaction buttons. When a user clicks one:

1. The reaction is captured via Discord's `on_raw_reaction_add` event.
2. The feedback is logged to **MLflow** as a `user_rating` assessment on the conversation trace.
3. You can view feedback scores in the MLflow UI under the agent's experiment.

This works automatically — no configuration needed. The feedback is tied to the MLflow trace ID of the conversation that produced the response.

### MLflow Tracing

All Discord conversations are traced in MLflow. Each message exchange (user input → agent response) is recorded as a span with:

- Input/output text
- Conversation ID
- Channel name (`discord`)
- Tool calls and RAG sources (if any)

Tracing also works for the **dashboard chat** (via ControlServer) and **REST API** channel. This means all three channels produce consistent traces in MLflow regardless of how the user interacts with the agent.

## Adding a new channel

Channels follow the registry pattern. To add a new channel (e.g. Slack, Telegram):

1. Create `corail/channels/myhannel.py` implementing the `Channel` base class (`start()` and `stop()`)
2. Register it in `corail/channels/factory.py`:
   ```python
   _REGISTRY["mychannel"] = ("corail.channels.mychannel", "MyChannel")
   ```
3. The CLI, operator, and dashboard will pick it up automatically.

See `corail/channels/discord.py` as a reference implementation for non-HTTP channels.
