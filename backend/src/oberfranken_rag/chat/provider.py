"""OpenRouter client with a persistent spending ledger and a hard per-request deadline.
Nothing here ever stores or logs message text, evidence, keys or upstream bodies."""
import json
import math
import os
import threading
import time
import uuid
from pathlib import Path
import httpx
from . import settings as S

URL = "https://openrouter.ai/api/v1/chat/completions"
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["supported", "answer", "record_ids"],
          "properties": {"supported": {"type": "boolean"}, "answer": {"type": "string"}, "record_ids": {"type": "array", "items": {"type": "string"}}}}
MAX_REPLY_BYTES = 200_000
TOKEN_MARGIN = 512  # room for chat-template and special tokens and any provider-side rendering of the schema

class ProviderError(Exception):
    """A transport/provider failure. Only a short code is kept: upstream details are never stored, so they cannot leak."""
    def __init__(self, code, http_status, detail=None):  # `detail` is accepted and deliberately discarded
        super().__init__(code)
        self.code, self.http_status = code, http_status
    def __str__(self): return self.code

class BudgetError(ProviderError):
    def __init__(self): super().__init__("budget_exhausted", 503)

def serialize(body):
    """The exact bytes that are sent. The cost bound is computed from these same bytes."""
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def worst_case_cost(body_bytes, model, tag, max_output=400):
    """Upper bound for one call. Input tokens <= UTF-8 bytes of the complete serialized request (messages, JSON schema and routing)
    plus a margin, because a byte-level BPE token (the DeepSeek tokenizer is one, to my knowledge) always covers at least one byte.
    Output tokens <= the max_tokens cap. Prices are those approved for this exact model and endpoint. The E5 embedding tokenizer is not used.
    The credit cap on the API key stays the independent hard limit."""
    endpoint = S.endpoint_for(model, tag)
    if endpoint is None: raise ProviderError("provider_not_configured", 503)
    return OpenRouterProvider.token_bound(body_bytes) * endpoint.price_in + max_output * endpoint.price_out

def _money(value):
    """A reported cost counts only if it is a finite, non-negative number; anything else means 'unknown' (reserved at the worst case)."""
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None

_SAFE_NAME = __import__("re").compile(r"[A-Za-z0-9/._:+-]{1,80}")
def _name(value):
    """Provider and model names come from the upstream reply: keep them only if they look like plain identifiers."""
    return value[:80] if isinstance(value, str) and _SAFE_NAME.fullmatch(value[:80]) and len(value) <= 80 else "invalid"

def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0

class Ledger:
    """Cumulative spend across restarts. A reservation is written before the call, so a crash counts as spent."""
    FIELDS = ("spent_usd", "pending_usd", "calls", "prompt_tokens", "completion_tokens", "reasoning_tokens_seen")
    def __init__(self, path, budget):
        self.budget = min(S.positive_finite(budget, "budget"), S.HARD_BUDGET_USD)
        self.path = Path(path); self._lock = threading.Lock()
        self.data = {"spent_usd": 0.0, "pending_usd": 0.0, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens_seen": 0}
        if self.path.is_file():
            try: stored = json.loads(self.path.read_text())
            except ValueError: raise S.ConfigError("the budget ledger is unreadable; refusing to start with an unknown budget") from None
            for name in self.FIELDS:
                if name in stored:
                    if _money(stored[name]) is None: raise S.ConfigError("the budget ledger holds an invalid value; refusing to start")
                    self.data[name] = stored[name]
        self.data["spent_usd"] += self.data["pending_usd"]; self.data["pending_usd"] = 0.0  # a crash between reserve and settle counts as spent
        self._save()
    @property
    def spent(self): return self.data["spent_usd"]
    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + "." + uuid.uuid4().hex + ".tmp")
        tmp.write_text(json.dumps({"budget_usd": self.budget, **self.data}, sort_keys=True)); os.replace(tmp, self.path)
    def reserve(self, worst):
        if _money(worst) is None: raise BudgetError()
        with self._lock:
            if self.data["spent_usd"] + self.data["pending_usd"] + worst > self.budget: raise BudgetError()
            self.data["pending_usd"] += worst; self._save()
    def settle(self, worst, actual, prompt_tokens=0, completion_tokens=0, reasoning_tokens=0, last_call=None):
        actual = _money(actual)
        with self._lock:
            if last_call is not None: self.data["last_call"] = last_call  # numbers and safe identifiers only, never text
            self.data["pending_usd"] = max(0.0, self.data["pending_usd"] - worst)
            self.data["spent_usd"] += worst if actual is None else actual
            self.data["calls"] += 1; self.data["prompt_tokens"] += _count(prompt_tokens)
            self.data["completion_tokens"] += _count(completion_tokens); self.data["reasoning_tokens_seen"] += _count(reasoning_tokens)
            self._save()

# Explicit refusals that happen before the model runs: not billed. Every other failure (408, 5xx, odd statuses) may have run the model and stays charged.
UNBILLED = {400: ("provider_error", 502), 401: ("provider_auth", 502), 402: ("insufficient_credit", 503), 403: ("provider_auth", 502),
            404: ("provider_error", 502), 422: ("provider_error", 502), 429: ("provider_rate_limit", 429)}

class OpenRouterProvider:
    def __init__(self, settings, ledger, transport=None, clock=time.monotonic):
        self.s, self.ledger, self.clock = settings, ledger, clock
        self.client = httpx.Client(transport=transport, timeout=httpx.Timeout(settings.provider_timeout_s, connect=5.0))
        self._busy = threading.Lock()  # paid calls run one at a time; a call abandoned by its request keeps this lock until it ends

    token_bound = staticmethod(lambda body_bytes: len(body_bytes) + TOKEN_MARGIN)

    def _body(self, system, user):
        tag = self.s.endpoint_tag
        return {"model": self.s.model, "stream": False, "temperature": 0, "max_tokens": self.s.max_output_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "reasoning": {"enabled": False},
                "response_format": {"type": "json_schema", "json_schema": {"name": "grounded_answer", "strict": True, "schema": SCHEMA}},
                "provider": {"only": [tag], "order": [tag], "allow_fallbacks": False, "require_parameters": True, "data_collection": "deny", "zdr": True},
                "usage": {"include": True}}

    def _timeout(self, deadline):
        left = deadline - self.clock()
        if left < self.s.min_paid_call_s: raise ProviderError("timeout", 504)  # too late to start a paid call
        return left

    def _send(self, body_bytes, deadline, left):
        """One POST, read in pieces so the monotonic deadline is checked while the reply arrives. Returns (status, bytes)."""
        limit = min(self.s.provider_timeout_s, left)
        timeout = httpx.Timeout(limit, connect=min(5.0, limit))
        headers = {"Authorization": f"Bearer {self.s.api_key}", "Content-Type": "application/json"}
        chunks, size = [], 0
        with self.client.stream("POST", URL, content=body_bytes, headers=headers, timeout=timeout) as response:
            if response.status_code >= 400: return response.status_code, b""
            for chunk in response.iter_bytes():
                if self.clock() >= deadline: raise httpx.ReadTimeout("deadline")
                size += len(chunk)
                if size > MAX_REPLY_BYTES: return 200, None  # oversized: refuse, never buffer without limit
                chunks.append(chunk)
            if self.clock() >= deadline: raise httpx.ReadTimeout("deadline")
            return response.status_code, b"".join(chunks)

    def complete(self, system, user, deadline=None):
        if not self.s.api_key or S.endpoint_for(self.s.model, self.s.endpoint_tag) is None: raise ProviderError("provider_not_configured", 503)
        if not self.s.allow_paid: raise ProviderError("paid_calls_disabled", 503)
        deadline = self.clock() + self.s.provider_timeout_s if deadline is None else deadline
        self._timeout(deadline)  # before queueing: no time, no paid call
        body_bytes = serialize(self._body(system, user))
        worst = worst_case_cost(body_bytes, self.s.model, self.s.endpoint_tag, self.s.max_output_tokens)
        if not self._busy.acquire(timeout=max(0.0, min(3.0, deadline - self.clock() - self.s.min_paid_call_s))): raise ProviderError("busy", 429)
        try:
            left = self._timeout(deadline)  # re-check: waiting for the lock used up time
            self.ledger.reserve(worst)
            try:
                status, raw = self._send(body_bytes, deadline, left)
            except httpx.TimeoutException:
                self.ledger.settle(worst, None); raise ProviderError("timeout", 504) from None
            except httpx.HTTPError:
                self.ledger.settle(worst, None); raise ProviderError("network", 502) from None
            if status >= 400:
                self.ledger.settle(worst, 0.0 if status in UNBILLED else None, last_call={"http_status": status})
                code, http = UNBILLED.get(status, ("timeout", 504) if status == 408 else ("provider_error", 502)); raise ProviderError(code, http) from None
            if raw is None:
                self.ledger.settle(worst, None); raise ProviderError("invalid_provider_response", 502) from None
            try: body = json.loads(raw)
            except ValueError:
                self.ledger.settle(worst, None); raise ProviderError("invalid_provider_response", 502) from None
            if not isinstance(body, dict) or "error" in body:
                self.ledger.settle(worst, None); raise ProviderError("provider_error", 502)
            usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
            details = usage.get("completion_tokens_details") if isinstance(usage.get("completion_tokens_details"), dict) else {}
            choices = body.get("choices") if isinstance(body.get("choices"), list) else []
            finish = choices[0].get("finish_reason") if choices and isinstance(choices[0], dict) else None
            last = {"model": _name(body.get("model")), "provider": _name(body.get("provider")), "prompt_tokens": _count(usage.get("prompt_tokens")),
                    "completion_tokens": _count(usage.get("completion_tokens")), "reasoning_tokens": _count(details.get("reasoning_tokens")),
                    "reported_cost_usd": _money(usage.get("cost")), "finish_reason": _name(finish) if finish else None, "http_status": status}
            self.ledger.settle(worst, usage.get("cost"), usage.get("prompt_tokens"), usage.get("completion_tokens"), details.get("reasoning_tokens"), last)
            endpoint = S.endpoint_for(self.s.model, self.s.endpoint_tag)
            if str(body.get("provider", "")).lower() != endpoint.provider_name.lower() or not str(body.get("model", "")).startswith(self.s.model):
                raise ProviderError("provider_mismatch", 502)
            try:
                choice = body["choices"][0]
                content = choice["message"]["content"]
                if choice.get("finish_reason") != "stop" or not isinstance(content, str): raise KeyError
            except (KeyError, IndexError, TypeError):
                raise ProviderError("invalid_provider_response", 502) from None
            return content
        finally:
            self._busy.release()
