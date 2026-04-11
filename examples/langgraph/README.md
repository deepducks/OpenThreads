# Example: LangGraph Integration

Use OpenThreads as the human-in-the-loop channel for a LangGraph agent. When
the agent needs human input (approval, data collection, escalation), it sends
an A2H intent to OpenThreads via the `replyTo` URL and blocks until the human
responds.

## Architecture

```
Human (Slack/Telegram/Discord)
     │ inbound message
     ▼
OpenThreads  ──envelope──►  LangGraph agent
                              │  (processes, may interrupt)
                              │  POST replyTo  A2H intent
                              ▼
OpenThreads  ──renders──►  Human (approve/deny buttons, form, etc.)
                              │  human responds
                              ▼
OpenThreads  ──response──►  LangGraph agent (interrupt resolves)
```

## Prerequisites

```bash
pip install langgraph langchain-openai httpx
```

## Example agent

See `agent.py` for a complete example of a LangGraph agent that:
1. Receives a task from OpenThreads
2. Runs an autonomous sub-task
3. Sends an `AUTHORIZE` intent to OpenThreads when it needs human approval
4. Resumes after the human responds

## Key pattern

```python
import httpx

async def ask_human(reply_to: str, intent: dict) -> dict:
    """
    Send an A2H intent to OpenThreads and wait for the human's response.
    OpenThreads blocks the POST until the human responds (or the token expires).
    """
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(
            reply_to,
            json={"message": [intent]},
        )
        response.raise_for_status()
        return response.json()

# In your LangGraph node:
result = await ask_human(
    reply_to=state["replyTo"],
    intent={
        "intent": "AUTHORIZE",
        "context": {
            "action": "send-email",
            "details": f"Send report to {recipient} (150KB attachment)"
        }
    }
)

approved = result.get("responses", [{}])[0].get("response", False)
```
