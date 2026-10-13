"""POST /api/chat. Development server only: bind to 127.0.0.1, no CORS, no streaming, no stored history."""
import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from typing import Literal
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool
from .. import config as c
from . import policy, settings as S
from .provider import Ledger, OpenRouterProvider, ProviderError
from .service import ChatService, guarded

log = logging.getLogger("oberfranken.chat")

MESSAGES = {  # fixed texts: upstream bodies and exception messages are never forwarded
    "invalid_request": "The request is not valid.", "payload_too_large": "The request is too large.", "rate_limited": "Too many requests. Please wait a moment.",
    "timeout": "The answer service took too long.", "network": "The answer service could not be reached.",
    "provider_rate_limit": "The answer service is busy. Please try again shortly.", "insufficient_credit": "The answer service has no credit available.",
    "provider_auth": "The answer service rejected the configured credentials.", "provider_error": "The answer service reported an error.",
    "provider_mismatch": "The answer service used an unexpected model or provider.", "invalid_provider_response": "The answer service sent an unusable reply.",
    "provider_not_configured": "The answer service is not configured.", "paid_calls_disabled": "Paid answer calls are switched off.",
    "budget_exhausted": "The test budget for answer calls is used up.", "busy": "The answer service is busy. Please try again shortly.",
    "internal_error": "Something went wrong.",
}

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    message: str
    city: Literal["bamberg", "bayreuth"] | None
    language: Literal["en", "de"]
    selectedCity: Literal["bamberg", "bayreuth"] | None = None  # optional explicit choice; `city` stays the original page context
    @field_validator("message")
    @classmethod
    def _length(cls, value):
        value = value.strip()
        if not 1 <= len(value) <= 500: raise ValueError("message length")
        return value

def error(status, code, headers=None):
    return JSONResponse({"error": {"code": code, "message": MESSAGES[code]}}, status_code=status, headers=headers)

def create_app(service, settings):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)  # no CORS middleware on purpose: the browser stays same-origin via the Vite proxy
    hits, lock = deque(), threading.Lock()

    def limited():
        now = time.monotonic()
        with lock:
            while hits and now - hits[0] > 60: hits.popleft()
            if len(hits) >= settings.rate_limit_per_min: return True
            hits.append(now); return False

    @app.get("/api/health")
    def health(): return {"status": "ok"}

    @app.post("/api/chat")
    async def chat(request: Request):
        started = time.monotonic()
        def done(outcome, sources=0, reason=None):
            # Only a code from the fixed set is ever logged, never a rejected output or any evidence text.
            suffix = f" reason={reason}" if reason in policy.REASONS else ""
            log.info("chat outcome=%s%s sources=%d ms=%d", outcome, suffix, sources, (time.monotonic() - started) * 1000)
        if limited(): done("rate_limited"); return error(429, "rate_limited", {"Retry-After": "60"})
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > S.MAX_BODY_BYTES: done("payload_too_large"); return error(413, "payload_too_large")
        deadline = time.monotonic() + settings.request_deadline_s  # one deadline for queueing, retrieval and generation
        raw = await request.body()
        if len(raw) > S.MAX_BODY_BYTES: done("payload_too_large"); return error(413, "payload_too_large")
        try: payload = ChatRequest.model_validate(json.loads(raw))
        except (ValueError, ValidationError): done("invalid_request"); return error(422, "invalid_request")
        try:
            body = await asyncio.wait_for(run_in_threadpool(service.answer, payload.message, payload.city, payload.language, deadline, selected_city=payload.selectedCity),
                                          timeout=max(0.0, deadline - time.monotonic()))
        except (asyncio.TimeoutError, TimeoutError):
            # The worker thread cannot be killed, but it cannot start a paid call after the deadline either, and an in-flight call stays reserved in the ledger.
            done("error:timeout"); return error(504, "timeout")
        except ProviderError as exc:
            done(f"error:{exc.code}"); return error(exc.http_status, exc.code if exc.code in MESSAGES else "provider_error")
        except Exception as exc:  # never log the exception text: it could contain message or evidence text
            done(f"error:{type(exc).__name__}"); return error(500, "internal_error")
        done(body["kind"], len(body["sources"]), getattr(body, "reason", None))
        return body

    return app

def create_app_from_env():
    """Loads the encoder, index, records and catalog once at startup. Run with: uvicorn --factory oberfranken_rag.chat.api:create_app_from_env --host 127.0.0.1"""
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # the model is cached locally
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    settings = S.load_settings()
    service = build_service(settings, OpenRouterProvider(settings, Ledger(settings.ledger_path, settings.budget_usd)))
    return create_app(service, settings)

def load_catalog(path=c.DATA / "catalog.json"):
    """Read-only: id -> {name, url} of the verified discovery catalog, so sources match what the UI pages show."""
    try: records = json.loads(path.read_text(encoding="utf-8"))["records"]
    except (OSError, ValueError, KeyError): return {}
    return {r["id"]: r["source"] for r in records if isinstance(r, dict) and isinstance(r.get("source"), dict) and "id" in r}

def build_service(settings, provider):
    from ..embeddings import E5Encoder
    from ..index import open_index
    from ..records import load_records
    from ..retrieve import retrieve
    records = load_records(c.SOURCE)
    collection, manifest = open_index(c.STORAGE, c.GOLD, records, c.SOURCE)
    encoder = E5Encoder(c.ROOT / "model_cache")
    if encoder.token_limit != manifest["token_limit"]: raise ValueError("model token limit differs from index")
    guard = threading.Lock()  # one retrieval at a time: encoder and Chroma client are shared
    def retrieve_fn(question, city, deadline=None):
        # Oversample locally for relevance filtering; the provider still sees <= 5 records.
        return guarded(guard, deadline, time.monotonic, retrieve, collection, encoder, question, city, None, 20, records)
    return ChatService({r["id"]: r for r in records}, retrieve_fn, provider, load_catalog(), settings.top_distance, settings.item_distance)
