import json
import httpx
import pytest
from oberfranken_rag.chat import settings as S
from oberfranken_rag.chat.provider import BudgetError, Ledger, OpenRouterProvider, ProviderError, serialize, worst_case_cost
from chat_fakes import FakeClock

KEY = "sk-or-SENTINEL-KEY-123"
TAG = "deepinfra/fp8"
MODEL = "deepseek/deepseek-v4.1-flash"
UPSTREAM = "SENTINEL-UPSTREAM-BODY"

def cfg(tmp_path, **over):
    base = dict(api_key=KEY, allow_paid=True, budget_usd=1.0, ledger_path=tmp_path / "ledger.json", endpoint_tag=TAG)
    base.update(over); return S.Settings(**base)

def ok_body(content='{"supported":true,"answer":"x","record_ids":[]}', cost=0.0002, provider="DeepInfra", finish="stop", extra=None):
    body = {"id": "gen-1", "model": MODEL, "provider": provider,
            "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 900, "completion_tokens": 80, "cost": cost}}
    body.update(extra or {}); return body

def provider(tmp_path, handler, **over):
    s = cfg(tmp_path, **over)
    return OpenRouterProvider(s, Ledger(s.ledger_path, s.budget_usd), transport=httpx.MockTransport(handler)), s

def test_request_is_pinned_to_the_approved_model_and_endpoint(tmp_path):
    seen = {}
    def handler(request):
        seen["raw"] = request.content; seen["body"] = json.loads(request.content); seen["auth"] = request.headers["authorization"]; seen["url"] = str(request.url)
        return httpx.Response(200, json=ok_body())
    p, _ = provider(tmp_path, handler); p.complete("sys", "user")
    b = seen["body"]
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions" and seen["auth"] == f"Bearer {KEY}"
    assert b["model"] == MODEL and "models" not in b
    assert b["provider"] == {"only": [TAG], "order": [TAG], "allow_fallbacks": False,
                             "require_parameters": True, "data_collection": "deny", "zdr": True}
    assert b["reasoning"] == {"enabled": False}
    assert b["response_format"]["type"] == "json_schema" and b["response_format"]["json_schema"]["strict"] is True
    assert set(b["response_format"]["json_schema"]["schema"]["properties"]) == {"supported", "answer", "record_ids"}
    assert b["max_tokens"] == 400 and b["temperature"] == 0 and b.get("stream") is False
    assert json.loads(seen["raw"]) == b

def test_returns_content_and_records_the_actual_cost(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(cost=0.0007)))
    assert json.loads(p.complete("s", "u"))["supported"] is True
    ledger = json.loads(s.ledger_path.read_text())
    assert ledger["calls"] == 1 and ledger["pending_usd"] == 0 and ledger["spent_usd"] == pytest.approx(0.0007)

def test_missing_cost_is_settled_at_the_worst_case(tmp_path):
    body = ok_body(); del body["usage"]["cost"]
    seen = {}
    def handler(request): seen["raw"] = request.content; return httpx.Response(200, json=body)
    p, s = provider(tmp_path, handler); p.complete("sys", "user")
    assert json.loads(s.ledger_path.read_text())["spent_usd"] == pytest.approx(worst_case_cost(seen["raw"], MODEL, TAG))

def test_no_key_means_no_request(tmp_path):
    hits = []
    p, _ = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), api_key=None)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_not_configured" and e.value.http_status == 503 and hits == []

def test_paid_calls_are_off_until_explicitly_enabled(tmp_path):
    hits = []
    p, _ = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), allow_paid=False)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "paid_calls_disabled" and hits == []

UNBILLED = {429, 402, 401, 403}
@pytest.mark.parametrize("status,code,http", [(429, "provider_rate_limit", 429), (402, "insufficient_credit", 503), (401, "provider_auth", 502),
                                              (403, "provider_auth", 502), (500, "provider_error", 502), (503, "provider_error", 502), (408, "timeout", 504)])
def test_http_errors_are_mapped_and_sanitized(tmp_path, status, code, http):
    p, s = provider(tmp_path, lambda r: httpx.Response(status, text=UPSTREAM + KEY))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert (e.value.code, e.value.http_status) == (code, http)
    assert UPSTREAM not in str(e.value) and KEY not in str(e.value) and KEY not in repr(e.value)
    assert UPSTREAM not in s.ledger_path.read_text()
    spent = json.loads(s.ledger_path.read_text())["spent_usd"]
    # Only explicit client-side refusals are known to be unbilled; 5xx and 408 may have run the model, so they stay reserved at the worst case.
    assert (spent == 0) if status in UNBILLED else (spent > 0)

def test_timeout_maps_to_504_and_is_charged_conservatively(tmp_path):
    def handler(request): raise httpx.ReadTimeout("slow " + KEY)
    p, s = provider(tmp_path, handler)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert (e.value.code, e.value.http_status) == ("timeout", 504) and KEY not in str(e.value)
    assert json.loads(s.ledger_path.read_text())["spent_usd"] > 0

def test_network_failure_maps_to_502(tmp_path):
    def handler(request): raise httpx.ConnectError("down " + KEY)
    p, _ = provider(tmp_path, handler)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert (e.value.code, e.value.http_status) == ("network", 502) and KEY not in str(e.value)

def test_200_with_an_error_object_is_a_failure(tmp_path):
    p, _ = provider(tmp_path, lambda r: httpx.Response(200, json={"error": {"message": UPSTREAM, "code": 502}}))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_error" and UPSTREAM not in str(e.value)

def test_another_provider_serving_the_call_is_rejected_but_charged(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(provider="SomeoneElse", cost=0.001)))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_mismatch" and json.loads(s.ledger_path.read_text())["spent_usd"] == pytest.approx(0.001)

def test_truncated_output_is_rejected(tmp_path):
    p, _ = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(finish="length")))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "invalid_provider_response"

def test_non_json_200_is_rejected(tmp_path):
    p, _ = provider(tmp_path, lambda r: httpx.Response(200, text="<html>" + UPSTREAM))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "invalid_provider_response" and UPSTREAM not in str(e.value)

def test_billable_reasoning_is_detected_and_counted(tmp_path):
    body = ok_body(cost=0.002); body["usage"]["completion_tokens_details"] = {"reasoning_tokens": 50}
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=body)); p.complete("s", "u")
    assert json.loads(s.ledger_path.read_text())["reasoning_tokens_seen"] == 50

def test_budget_stops_the_next_call_before_any_request(tmp_path):
    hits = []
    p, s = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), budget_usd=0.0001)
    with pytest.raises(BudgetError): p.complete("s" * 5000, "u" * 5000)
    assert hits == []

def test_budget_accumulates_across_restarts(tmp_path):
    s = cfg(tmp_path, budget_usd=0.0012)
    def run():
        p = OpenRouterProvider(s, Ledger(s.ledger_path, s.budget_usd), transport=httpx.MockTransport(lambda r: httpx.Response(200, json=ok_body(cost=0.0006))))
        return p.complete("s", "u")
    run(); run()
    with pytest.raises(BudgetError): run()
    assert json.loads(s.ledger_path.read_text())["spent_usd"] == pytest.approx(0.0012)

def test_a_crash_between_reserve_and_settle_is_counted_as_spent(tmp_path):
    ledger = Ledger(tmp_path / "l.json", 1.0); ledger.reserve(0.05)
    assert Ledger(tmp_path / "l.json", 1.0).spent == pytest.approx(0.05)

def test_budget_can_never_exceed_one_dollar(tmp_path):
    assert Ledger(tmp_path / "l.json", 50.0).budget == 1.0

def test_the_estimate_is_a_conservative_upper_bound():
    prompt = "x" * 10_000
    body = serialize({"model": MODEL, "messages": [{"role": "user", "content": prompt}]})
    assert worst_case_cost(body, MODEL, TAG) >= len(body) * 0.14e-6 + 400 * 0.42e-6

def test_ledger_never_stores_text(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body()))
    p.complete("SENTINEL-SYSTEM", "SENTINEL-USER-TEXT")
    text = s.ledger_path.read_text(); assert "SENTINEL" not in text and KEY not in text


def test_the_model_is_configurable_and_sent_explicitly(tmp_path, monkeypatch):
    monkeypatch.setitem(S.APPROVED, "other/model-x", {TAG: S.Endpoint("DeepInfra", 0.1e-6, 0.2e-6)})  # an approved pair for this test only
    seen = {}
    def handler(request):
        seen["model"] = json.loads(request.content)["model"]; return httpx.Response(200, json=ok_body(extra={"model": "other/model-x"}))
    p, _ = provider(tmp_path, handler, model="other/model-x"); p.complete("s", "u")
    assert seen["model"] == "other/model-x"

def test_a_reply_from_a_different_model_is_rejected(tmp_path):
    # the request names the approved Flash model; the reply claims another one
    p, _ = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(extra={"model": "someone/else"})))
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_mismatch"

def test_default_model_and_no_default_endpoint():
    s = S.Settings()
    assert s.model == "deepseek/deepseek-v4.1-flash" and s.endpoint_tag is None

@pytest.mark.parametrize("tag", [None, "", "deepinfra/fp4", "unknown/fp8"])
def test_an_unlisted_or_missing_endpoint_means_no_request(tmp_path, tag):
    hits = []
    p, _ = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), endpoint_tag=tag)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_not_configured" and hits == []

def test_settings_are_read_from_env_and_dotenv(tmp_path):
    dotenv = tmp_path / ".env"; dotenv.write_text("# c\nOPENROUTER_API_KEY='sk-or-FILE'\nOPENROUTER_MODEL=file/model\nOPENROUTER_PROVIDER_ENDPOINT=decart/fp4\n")
    s = S.load_settings({}, dotenv)
    assert (s.api_key, s.model, s.endpoint_tag, s.allow_paid) == ("sk-or-FILE", "file/model", "decart/fp4", False)
    s = S.load_settings({"OPENROUTER_MODEL": "env/model", "OPENROUTER_ALLOW_PAID_CALLS": "1", "OPENROUTER_BUDGET_USD": "0.5"}, dotenv)
    assert (s.model, s.allow_paid, s.budget_usd) == ("env/model", True, 0.5)
    assert S.load_settings({}, tmp_path / "missing.env").model == "deepseek/deepseek-v4.1-flash"

def test_the_key_never_appears_in_settings_repr(tmp_path):
    assert KEY not in repr(cfg(tmp_path))

def test_env_example_documents_the_variables_and_holds_no_secret():
    from pathlib import Path
    text = (Path(__file__).resolve().parents[1] / ".env.example").read_text()
    for name in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_PROVIDER_ENDPOINT", "OPENROUTER_ALLOW_PAID_CALLS", "OPENROUTER_BUDGET_USD"):
        assert name in text
    assert "sk-or-" not in text.replace("sk-or-...", "")


# ---------------------------------------------------------------- budget: token bound, validation, model-bound pricing
@pytest.mark.parametrize("text", ["plain english text " * 50, "Schöne Grüße aus Bamberg, Fränkische Küche ß ä ö ü " * 50, "日本語のテキスト" * 50, "emoji 😀🍺🏰 " * 50, '{"a":"\\u00e4"}' * 50])
def test_the_token_bound_covers_any_byte_level_tokenization_of_the_full_serialized_request(text):
    body = serialize({"messages": [{"role": "user", "content": text}]})
    assert OpenRouterProvider.token_bound(body) >= len(body)  # a byte-level BPE token covers at least one byte
    assert OpenRouterProvider.token_bound(body) >= len(text.encode("utf-8"))

def test_the_estimate_covers_the_whole_request_including_the_schema_and_routing(tmp_path):
    seen = {}
    def handler(request): seen["raw"] = request.content; return httpx.Response(200, json=ok_body())
    p, _ = provider(tmp_path, handler); p.complete("s", "u")
    schema_bytes = len(json.dumps(json.loads(seen["raw"])["response_format"]).encode())
    assert OpenRouterProvider.token_bound(seen["raw"]) >= len(seen["raw"]) and len(seen["raw"]) > schema_bytes
    assert worst_case_cost(seen["raw"], MODEL, TAG) >= len(seen["raw"]) * 0.14e-6 + 400 * 0.42e-6

def test_the_bound_does_not_use_the_embedding_tokenizer():
    import inspect, oberfranken_rag.chat.provider as mod
    source = inspect.getsource(mod)
    assert "E5Encoder" not in source and "sentence_transformers" not in source and "token_count" not in source

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1.0, 0.0])
def test_a_non_finite_or_non_positive_budget_is_refused(tmp_path, bad):
    with pytest.raises(S.ConfigError): S.Settings(budget_usd=bad)
    with pytest.raises(S.ConfigError): Ledger(tmp_path / "l.json", bad)

@pytest.mark.parametrize("raw", ["nan", "inf", "-1", "0", "abc", "1e999"])
def test_a_bad_budget_in_the_environment_fails_loudly_instead_of_defaulting(raw):
    with pytest.raises(S.ConfigError): S.load_settings({"OPENROUTER_BUDGET_USD": raw}, Path("/nonexistent/.env"))

def test_a_budget_above_the_hard_cap_is_capped_at_one_dollar():
    assert S.load_settings({"OPENROUTER_BUDGET_USD": "5"}, Path("/nonexistent/.env")).budget_usd == 1.0

@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity", "-0.5", '"0.1"', "true", "null", "[]"])
def test_a_reported_cost_that_is_not_finite_and_non_negative_is_settled_at_the_worst_case(tmp_path, bad):
    seen = {}
    raw = '{"model":"%s","provider":"DeepInfra","choices":[{"finish_reason":"stop","message":{"content":"{\\"supported\\":true,\\"answer\\":\\"x\\",\\"record_ids\\":[]}"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":%s}}' % (MODEL, bad)
    def handler(request): seen["raw"] = request.content; return httpx.Response(200, content=raw.encode())
    p, s = provider(tmp_path, handler); p.complete("s", "u")
    spent = json.loads(s.ledger_path.read_text())["spent_usd"]
    assert spent == pytest.approx(worst_case_cost(seen["raw"], MODEL, TAG)) and spent > 0 and spent == spent

def test_negative_or_absurd_token_counts_are_ignored(tmp_path):
    body = ok_body(); body["usage"]["prompt_tokens"] = -5; body["usage"]["completion_tokens"] = "many"
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=body)); p.complete("s", "u")
    data = json.loads(s.ledger_path.read_text()); assert data["prompt_tokens"] == 0 and data["completion_tokens"] == 0

@pytest.mark.parametrize("field,value", [("spent_usd", float("nan")), ("spent_usd", -1), ("pending_usd", float("inf")), ("calls", -3)])
def test_a_corrupt_ledger_stops_the_backend_instead_of_resetting_the_budget(tmp_path, field, value):
    path = tmp_path / "l.json"; path.write_text(json.dumps({"budget_usd": 1.0, field: value}))
    with pytest.raises(S.ConfigError): Ledger(path, 1.0)

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.01])
def test_a_reservation_must_be_finite_and_non_negative(tmp_path, bad):
    with pytest.raises(BudgetError): Ledger(tmp_path / "l.json", 1.0).reserve(bad)

def test_pricing_belongs_to_the_exact_model_and_endpoint_pair():
    flash = S.endpoint_for("deepseek/deepseek-v4.1-flash", "deepinfra/fp8")
    assert flash and (flash.price_in, flash.price_out) == (0.14e-6, 0.42e-6)
    for other in ("deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-pro", "deepseek/deepseek-v3.2", "deepseek/deepseek-v4.1-flash:batch", ""):
        assert S.endpoint_for(other, "deepinfra/fp8") is None, other
    assert S.endpoint_for("deepseek/deepseek-v4.1-flash", "deepinfra/fp4") is None

@pytest.mark.parametrize("model", ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-pro", "someone/else"])
def test_switching_the_model_never_reuses_flash_prices_it_refuses_instead(tmp_path, model):
    hits = []
    p, s = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body(extra={"model": model})), model=model)
    with pytest.raises(ProviderError) as e: p.complete("s", "u")
    assert e.value.code == "provider_not_configured" and hits == [] and json.loads(s.ledger_path.read_text())["calls"] == 0

def test_settlement_after_a_rejected_provider_still_uses_the_reported_cost(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(provider="Other", cost=0.002)))
    with pytest.raises(ProviderError): p.complete("s", "u")
    assert json.loads(s.ledger_path.read_text())["spent_usd"] == pytest.approx(0.002)

# ---------------------------------------------------------------- deadline
class SlowBody(httpx.SyncByteStream):
    """A response body that takes (fake) time between chunks."""
    def __init__(self, clock, chunks, step): self.clock, self.chunks, self.step = clock, chunks, step
    def __iter__(self):
        for chunk in self.chunks:
            self.clock.advance(self.step); yield chunk

def clocked(tmp_path, handler, clock, **over):
    s = cfg(tmp_path, **over)
    return OpenRouterProvider(s, Ledger(s.ledger_path, s.budget_usd), transport=httpx.MockTransport(handler), clock=clock), s

def test_the_defaults_leave_headroom_below_the_ui_timeout():
    s = S.Settings()
    assert 0 < s.request_deadline_s <= 25 < 30 and s.provider_timeout_s <= s.request_deadline_s and 0 < s.min_paid_call_s < s.request_deadline_s

def test_no_paid_request_starts_after_the_deadline(tmp_path):
    clock, hits = FakeClock(), []
    p, s = clocked(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), clock)
    with pytest.raises(ProviderError) as e: p.complete("s", "u", deadline=clock() - 0.001)
    assert (e.value.code, e.value.http_status) == ("timeout", 504) and hits == []
    assert json.loads(s.ledger_path.read_text())["calls"] == 0 and json.loads(s.ledger_path.read_text())["pending_usd"] == 0

def test_no_paid_request_starts_when_too_little_time_is_left(tmp_path):
    clock, hits = FakeClock(), []
    p, _ = clocked(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), clock)
    with pytest.raises(ProviderError) as e: p.complete("s", "u", deadline=clock() + 1)  # less than min_paid_call_s
    assert e.value.code == "timeout" and hits == []

def test_a_call_with_enough_time_goes_through(tmp_path):
    clock = FakeClock(); p, _ = clocked(tmp_path, lambda r: httpx.Response(200, json=ok_body()), clock)
    assert p.complete("s", "u", deadline=clock() + 20)

def test_the_deadline_is_enforced_while_the_reply_body_is_arriving(tmp_path):
    clock = FakeClock(); payload = json.dumps(ok_body()).encode()
    def handler(request): return httpx.Response(200, stream=SlowBody(clock, [payload[:20], payload[20:40], payload[40:]], 8))
    p, s = clocked(tmp_path, handler, clock)
    with pytest.raises(ProviderError) as e: p.complete("s", "u", deadline=clock() + 20)
    assert e.value.code == "timeout"
    data = json.loads(s.ledger_path.read_text()); assert data["spent_usd"] > 0 and data["pending_usd"] == 0  # billing unknown: charged at the worst case

def test_an_oversized_reply_is_cut_off(tmp_path):
    clock = FakeClock(); big = b"x" * 400_000
    p, _ = clocked(tmp_path, lambda r: httpx.Response(200, content=big), clock)
    with pytest.raises(ProviderError) as e: p.complete("s", "u", deadline=clock() + 20)
    assert e.value.code == "invalid_provider_response"

def test_an_in_flight_call_stays_reserved_and_blocks_other_paid_calls(tmp_path):
    import threading, time
    entered, release = threading.Event(), threading.Event()
    def handler(request): entered.set(); release.wait(5); return httpx.Response(200, json=ok_body(cost=0.0004))
    s = cfg(tmp_path, min_paid_call_s=0.05)
    p = OpenRouterProvider(s, Ledger(s.ledger_path, s.budget_usd), transport=httpx.MockTransport(handler))
    results = {}
    def first():
        try: results["first"] = p.complete("s", "u", deadline=time.monotonic() + 10)
        except Exception as exc: results["first"] = exc
    t = threading.Thread(target=first); t.start()
    assert entered.wait(3)
    reserved = json.loads(s.ledger_path.read_text())
    assert reserved["pending_usd"] > 0 and reserved["spent_usd"] == 0  # in flight: counted as at risk
    with pytest.raises(ProviderError) as e: p.complete("s", "u", deadline=time.monotonic() + 0.4)
    assert e.value.code in ("busy", "timeout")
    release.set(); t.join(5)
    done = json.loads(s.ledger_path.read_text()); assert done["pending_usd"] == 0 and done["spent_usd"] == pytest.approx(0.0004) and "first" in results

def test_a_late_background_call_cannot_start_after_its_request_gave_up(tmp_path):
    import time
    hits = []
    p, _ = provider(tmp_path, lambda r: hits.append(r) or httpx.Response(200, json=ok_body()), min_paid_call_s=0.05)
    time.sleep(0.12)
    with pytest.raises(ProviderError): p.complete("s", "u", deadline=time.monotonic() - 0.1)
    assert hits == []

from pathlib import Path


# ---------------------------------------------------------------- last-call record (for the live smoke test report)
def test_the_ledger_records_the_actual_model_provider_tokens_reasoning_and_cost_of_the_last_call(tmp_path):
    body = ok_body(cost=0.00031); body["usage"]["completion_tokens_details"] = {"reasoning_tokens": 0}
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=body)); p.complete("SENTINEL-SYSTEM", "SENTINEL-USER")
    last = json.loads(s.ledger_path.read_text())["last_call"]
    assert last == {"model": MODEL, "provider": "DeepInfra", "prompt_tokens": 900, "completion_tokens": 80, "reasoning_tokens": 0,
                    "reported_cost_usd": 0.00031, "finish_reason": "stop", "http_status": 200}
    assert "SENTINEL" not in s.ledger_path.read_text() and KEY not in s.ledger_path.read_text()

def test_the_last_call_record_shows_reasoning_tokens_and_unknown_cost(tmp_path):
    body = ok_body(); del body["usage"]["cost"]; body["usage"]["completion_tokens_details"] = {"reasoning_tokens": 7}
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=body)); p.complete("s", "u")
    last = json.loads(s.ledger_path.read_text())["last_call"]
    assert last["reasoning_tokens"] == 7 and last["reported_cost_usd"] is None

def test_upstream_names_in_the_record_are_restricted_to_safe_characters(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(200, json=ok_body(provider="Evil <script> SENTINEL-UPSTREAM-BODY " + KEY, extra={"model": "x" * 500})))
    with pytest.raises(ProviderError): p.complete("s", "u")
    text = s.ledger_path.read_text()
    assert "SENTINEL" not in text and KEY not in text and "<script>" not in text and len(json.loads(text)["last_call"]["model"]) <= 80

def test_failed_calls_record_only_the_status(tmp_path):
    p, s = provider(tmp_path, lambda r: httpx.Response(429, text=UPSTREAM))
    with pytest.raises(ProviderError): p.complete("s", "u")
    assert json.loads(s.ledger_path.read_text())["last_call"] == {"http_status": 429}
