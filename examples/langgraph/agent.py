"""
LangGraph + OpenThreads Integration Example.

This example shows a LangGraph agent that:
  1. Receives a task envelope from OpenThreads (via its own HTTP server)
  2. Processes the task autonomously
  3. Sends an A2H AUTHORIZE intent to the human via OpenThreads
  4. Waits for the human's approval before completing the task
  5. Replies with the result

Requirements:
  pip install langgraph langchain-openai httpx fastapi uvicorn

Run:
  python agent.py
"""

import asyncio
import json
import os
from typing import TypedDict, Annotated

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

try:
    from langgraph.graph import StateGraph, END
    from langgraph.graph.message import add_messages
    from langchain_core.messages import HumanMessage, AIMessage
    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False
    print("LangGraph not installed. Install with: pip install langgraph langchain-openai")

# ─── Agent state ──────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    # OpenThreads envelope fields
    thread_id: str
    turn_id: str
    reply_to: str
    sender_name: str
    # Task state
    task: str
    plan: str
    approved: bool
    result: str


# ─── A2H helper ───────────────────────────────────────────────────────────────

async def send_a2h_intent(reply_to: str, intent: dict, timeout: float = 300) -> dict:
    """
    POST an A2H intent to OpenThreads' replyTo URL and return the response.

    OpenThreads renders the intent to the human (buttons, form, etc.) and
    blocks the HTTP request until the human responds. The response contains
    the human's answer (approved/denied, collected data, etc.).

    Args:
        reply_to: The replyTo URL from the OpenThreads envelope.
        intent:   An A2H message dict (must contain 'intent' key).
        timeout:  Seconds to wait for the human response (default: 5 min).

    Returns:
        The JSON response from OpenThreads, e.g.:
        {"responses": [{"intent": "AUTHORIZE", "response": true, "respondedAt": "..."}]}
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            reply_to,
            json={"message": [intent]},
            headers={"Content-Type": "application/json"},
        )
        response.raise_for_status()
        return response.json()


async def send_text(reply_to: str, text: str) -> None:
    """Send a simple text message via OpenThreads."""
    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(
            reply_to,
            json={"message": {"text": text}},
            headers={"Content-Type": "application/json"},
        )


# ─── LangGraph agent ──────────────────────────────────────────────────────────

async def plan_task(state: AgentState) -> dict:
    """Generate a plan for the task (runs autonomously)."""
    task = state["task"]
    # In a real agent, call an LLM here
    plan = f"Plan for '{task}': Step 1 → analyse, Step 2 → execute, Step 3 → report"
    print(f"[agent] planned: {plan}")
    return {"plan": plan}


async def request_approval(state: AgentState) -> dict:
    """Send an AUTHORIZE intent to the human and wait for approval."""
    print(f"[agent] requesting approval via OpenThreads...")

    try:
        result = await send_a2h_intent(
            reply_to=state["reply_to"],
            intent={
                "intent": "AUTHORIZE",
                "context": {
                    "action": "execute-plan",
                    "details": state["plan"],
                    "requestedBy": "LangGraph agent",
                },
                "description": "Please review and approve the plan before execution.",
            },
        )

        responses = result.get("responses", [])
        approved = bool(responses[0].get("response", False)) if responses else False
        print(f"[agent] human {'approved' if approved else 'denied'}")
        return {"approved": approved}

    except httpx.TimeoutException:
        print("[agent] approval request timed out")
        return {"approved": False}


async def execute_task(state: AgentState) -> dict:
    """Execute the task (only runs if approved)."""
    if not state["approved"]:
        return {"result": "Task was not approved by the human."}

    # Simulate task execution
    await asyncio.sleep(1)
    result = f"Task completed successfully. Plan executed: {state['plan']}"
    print(f"[agent] {result}")
    return {"result": result}


async def send_result(state: AgentState) -> dict:
    """Send the final result back to the human via OpenThreads."""
    await send_text(state["reply_to"], state["result"])
    print("[agent] result sent to human")
    return {}


def should_execute(state: AgentState) -> str:
    return "execute" if state.get("approved") else "send_result"


def build_graph():
    """Build and compile the LangGraph state machine."""
    graph = StateGraph(AgentState)

    graph.add_node("plan", plan_task)
    graph.add_node("request_approval", request_approval)
    graph.add_node("execute", execute_task)
    graph.add_node("send_result", send_result)

    graph.set_entry_point("plan")
    graph.add_edge("plan", "request_approval")
    graph.add_conditional_edges(
        "request_approval",
        should_execute,
        {"execute": "execute", "send_result": "send_result"},
    )
    graph.add_edge("execute", "send_result")
    graph.add_edge("send_result", END)

    return graph.compile()


# ─── HTTP server (receives OpenThreads envelopes) ────────────────────────────

app = FastAPI(title="LangGraph + OpenThreads Agent")

@app.post("/inbound")
async def inbound(request: Request):
    """Receive an OpenThreads envelope and kick off the LangGraph agent."""
    envelope = await request.json()

    thread_id = envelope.get("threadId", "")
    turn_id = envelope.get("turnId", "")
    reply_to = envelope.get("replyTo", "")
    source = envelope.get("source", {})
    sender_name = source.get("sender", {}).get("name", "unknown")

    # Extract the task text from the message
    message = envelope.get("message", [])
    if isinstance(message, dict):
        message = [message]
    task = " ".join(
        m.get("text", "") for m in message if isinstance(m, dict) and "text" in m
    ).strip() or "Do something useful"

    print(f"[inbound] task='{task}' from={sender_name} thread={thread_id}")

    # Acknowledge immediately
    asyncio.create_task(run_agent(thread_id, turn_id, reply_to, sender_name, task))
    return JSONResponse({"ok": True})


@app.get("/health")
async def health():
    return {"status": "ok"}


async def run_agent(
    thread_id: str,
    turn_id: str,
    reply_to: str,
    sender_name: str,
    task: str,
) -> None:
    if not LANGGRAPH_AVAILABLE:
        print("[agent] LangGraph not available — sending error reply")
        await send_text(reply_to, "Error: LangGraph is not installed.")
        return

    graph = build_graph()
    initial_state: AgentState = {
        "thread_id": thread_id,
        "turn_id": turn_id,
        "reply_to": reply_to,
        "sender_name": sender_name,
        "task": task,
        "plan": "",
        "approved": False,
        "result": "",
    }
    try:
        await graph.ainvoke(initial_state)
    except Exception as exc:
        print(f"[agent] error: {exc}")
        await send_text(reply_to, f"Error processing task: {exc}")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 4001))
    print(f"[server] LangGraph agent listening on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
