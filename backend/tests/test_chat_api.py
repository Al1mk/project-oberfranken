import json
import logging
import pytest
from fastapi.testclient import TestClient
from oberfranken_rag.chat import settings as S
from oberfranken_rag.chat.api import create_app
from oberfranken_rag.chat.provider import BudgetError, ProviderError
from oberfranken_rag.chat.service import ChatService
from chat_fakes import FakeProvider, FakeRetriever, contract_ok, model_json, record, result

USER_TEXT = "SENTINEL-USER-TEXT Why is Rauchbier special?"
EVIDENCE = "SENTINEL-EVIDENCE-PASSAGE"
GOOD = {"message": "Why is Rauchbier special in Bamberg?", "city": "bamberg", "language": "en"}

def client(provider=None, rate=100, results=None, rec=None, **kw):
    rec = rec or record()
    service = ChatService({rec["id"]: rec}, FakeRetriever(results if results is not None else [result(rec)]), provider or FakeProvider(), {})
    app = create_app(service, S.Settings(rate_limit_per_min=rate), **kw)
    return TestClient(app, raise_server_exceptions=False), service

def test_valid_request_returns_the_contract():
    c, _ = client(); r = c.post("/api/chat", json=GOOD)
    assert r.status_code == 200; contract_ok(r.json()); assert r.json()["kind"] == "answer"

def test_city_may_be_null_and_german_is_accepted():
    c, _ = client(); r = c.post("/api/chat", json={"message": "Was ist Rauchbier?", "city": None, "language": "de"})
    assert r.status_code == 200; contract_ok(r.json())

@pytest.mark.parametrize("payload", [
    {}, {"message": "", "city": "bamberg", "language": "en"}, {"message": "   ", "city": "bamberg", "language": "en"},
    {"message": "x" * 501, "city": "bamberg", "language": "en"}, {"message": "hi", "city": "coburg", "language": "en"},
    {"message": "hi", "city": "bamberg", "language": "fr"}, {"message": "hi", "city": "bamberg"}, {"message": "hi", "language": "en"},
    {"message": 5, "city": "bamberg", "language": "en"}, {**GOOD, "history": []}, {**GOOD, "model": "other"}, [GOOD], "text",
])
def test_invalid_payloads_are_422_without_echoing_input(payload):
    c, service = client(); r = c.post("/api/chat", json=payload)
    assert r.status_code == 422 and r.json() == {"error": {"code": "invalid_request", "message": "The request is not valid."}}

def test_invalid_json_is_422_and_does_not_echo():
    c, _ = client(); r = c.post("/api/chat", content=b"{SENTINEL-BAD-JSON", headers={"content-type": "application/json"})
    assert r.status_code == 422 and "SENTINEL" not in r.text

def test_huge_body_is_413():
    c, _ = client(); r = c.post("/api/chat", content=b"x" * 20000, headers={"content-type": "application/json"})
    assert r.status_code == 413

def test_message_is_trimmed():
    c, service = client(); retriever = FakeRetriever([result(record())]); service.retrieve = retriever
    c.post("/api/chat", json={**GOOD, "message": "  Why is Rauchbier special?  "}); assert retriever.calls[0][0] == "Why is Rauchbier special?"

def test_rate_limit_returns_429_with_retry_after():
    c, _ = client(rate=3)
    codes = [c.post("/api/chat", json=GOOD).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert "retry-after" in c.post("/api/chat", json=GOOD).headers

@pytest.mark.parametrize("error,status,code", [
    (ProviderError("timeout", 504), 504, "timeout"), (ProviderError("provider_rate_limit", 429), 429, "provider_rate_limit"),
    (ProviderError("insufficient_credit", 503), 503, "insufficient_credit"), (ProviderError("provider_not_configured", 503), 503, "provider_not_configured"),
    (ProviderError("network", 502), 502, "network"), (ProviderError("invalid_provider_response", 502), 502, "invalid_provider_response"),
    (BudgetError(), 503, "budget_exhausted"),
])
def test_provider_failures_are_non_2xx_with_sanitized_details(error, status, code):
    c, _ = client(FakeProvider(error=error)); r = c.post("/api/chat", json=GOOD)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert set(r.json()) == {"error"} and "text" not in r.json() and "sources" not in r.json()

def test_unexpected_exceptions_become_a_generic_500_without_details():
    c, _ = client(FakeProvider(error=RuntimeError("SENTINEL-INTERNAL " + EVIDENCE)))
    r = c.post("/api/chat", json=GOOD)
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error" and "SENTINEL" not in r.text

def test_no_cors_headers_are_ever_sent():
    c, _ = client(); r = c.post("/api/chat", json=GOOD, headers={"Origin": "https://evil.example"})
    assert not any(h.lower().startswith("access-control-") for h in r.headers)
    assert c.options("/api/chat", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}).status_code in (400, 405)

def test_health_reports_no_secrets():
    c, _ = client(); r = c.get("/api/health"); assert r.status_code == 200 and set(r.json()) == {"status"}

def test_secrets_and_user_text_never_reach_logs_responses_or_errors(caplog):
    caplog.set_level(logging.DEBUG)
    rec = record(content=EVIDENCE)
    c, _ = client(FakeProvider(error=ProviderError("provider_error", 502, detail="SENTINEL-UPSTREAM-BODY sk-or-SENTINEL-KEY")), rec=rec)
    bodies = [c.post("/api/chat", json={**GOOD, "message": USER_TEXT}).text,
              c.post("/api/chat", json={"message": USER_TEXT, "city": "nowhere", "language": "en"}).text]
    ok, _ = client(rec=rec); bodies.append(ok.post("/api/chat", json={**GOOD, "message": USER_TEXT}).text)
    everything = "\n".join(bodies) + caplog.text
    for sentinel in ("SENTINEL-USER-TEXT", EVIDENCE, "SENTINEL-UPSTREAM-BODY", "sk-or-SENTINEL-KEY"):
        assert sentinel not in everything, sentinel

def test_log_lines_hold_only_outcome_metadata(caplog):
    caplog.set_level(logging.INFO)
    c, _ = client(); c.post("/api/chat", json={**GOOD, "message": USER_TEXT})
    lines = [r.getMessage() for r in caplog.records if r.name == "oberfranken.chat"]
    assert lines and all("outcome=" in line for line in lines)


# ---------------------------------------------------------------- end-to-end deadline
def test_a_slow_request_is_cut_off_at_the_deadline_with_a_504_and_no_late_paid_call():
    import time, httpx
    from oberfranken_rag.chat.provider import Ledger, OpenRouterProvider
    from chat_fakes import FakeRetriever, record, result
    hits = []
    settings = S.Settings(request_deadline_s=0.4, min_paid_call_s=0.15, api_key="sk-or-x", allow_paid=True, endpoint_tag="deepinfra/fp8", ledger_path=__import__("pathlib").Path(__import__("tempfile").mkdtemp()) / "l.json")
    provider = OpenRouterProvider(settings, Ledger(settings.ledger_path, settings.budget_usd), transport=httpx.MockTransport(lambda r: hits.append(r) or httpx.Response(500)))
    rec = record()
    service = ChatService({rec["id"]: rec}, FakeRetriever([result(rec)], on_call=lambda: time.sleep(0.5)), provider, {})  # retrieval alone outlasts the deadline
    app = create_app(service, settings); c = TestClient(app, raise_server_exceptions=False)
    started = time.monotonic(); r = c.post("/api/chat", json=GOOD); elapsed = time.monotonic() - started
    assert r.status_code == 504 and r.json()["error"]["code"] == "timeout" and elapsed < 0.7
    time.sleep(0.6)  # let the abandoned worker finish
    assert hits == []  # it was not allowed to start a paid request after the deadline

def test_the_api_passes_one_deadline_below_the_ui_timeout_to_the_service():
    class Spy(ChatService):
        def answer(self, message, city, language, deadline=None, *, selected_city=None):
            Spy.deadline = deadline; Spy.selected = selected_city; return super().answer(message, city, language, deadline, selected_city=selected_city)
    import time
    rec = record(); service = Spy({rec["id"]: rec}, FakeRetriever([result(rec)]), FakeProvider(), {})
    c = TestClient(create_app(service, S.Settings()), raise_server_exceptions=False)
    before = time.monotonic(); assert c.post("/api/chat", json=GOOD).status_code == 200
    assert 0 < Spy.deadline - before <= 25.5


# ---------------------------------------------------------------- reason codes in logs
def logged_reasons(caplog):
    import re
    return [m.group(1) for r in caplog.records if r.name == "oberfranken.chat" for m in [re.search(r"reason=(\S+)", r.getMessage())] if m]

@pytest.mark.parametrize("content,expected", [
    (model_json(supported=False, ids=[]), "model_declined"), (model_json(ids=[]), "missing_citations"), (model_json(ids=["nope"]), "invalid_citation"),
    (model_json(answer="SENTINEL-OUTPUT costs 40 Euro."), "volatile_answer"), (model_json(answer="SENTINEL-OUTPUT founded in 1999."), "unsupported_number"),
])
def test_each_fallback_decision_logs_only_its_fixed_reason_code(caplog, content, expected):
    caplog.set_level(logging.INFO)
    rec = record(content="SENTINEL-EVIDENCE-PASSAGE about Rauchbier.", enrichment="")
    c, _ = client(FakeProvider(content), rec=rec)
    r = c.post("/api/chat", json={**GOOD, "message": USER_TEXT}); assert r.status_code == 200 and r.json()["kind"] == "fallback"
    assert logged_reasons(caplog) == [expected]
    everything = caplog.text + r.text
    for sentinel in ("SENTINEL-OUTPUT", "SENTINEL-EVIDENCE-PASSAGE", "SENTINEL-USER-TEXT", "founded in 1999", "40 Euro"): assert sentinel not in everything.replace(r.json()["text"], ""), sentinel
    assert "reason" not in r.json() and set(r.json()) == {"text", "kind", "isSample", "sources"}

def test_weak_evidence_logs_its_reason_without_a_paid_call(caplog):
    caplog.set_level(logging.INFO)
    rec = record(); provider = FakeProvider()
    c, _ = client(provider, results=[result(rec, 0.3)], rec=rec)
    assert c.post("/api/chat", json=GOOD).json()["kind"] == "fallback" and provider.calls == [] and logged_reasons(caplog) == ["weak_evidence"]

def test_answers_and_pre_checks_log_no_reason(caplog):
    caplog.set_level(logging.INFO)
    c, _ = client(); c.post("/api/chat", json=GOOD); c.post("/api/chat", json={**GOOD, "message": "Hello!"})
    assert logged_reasons(caplog) == []
    lines = [r.getMessage() for r in caplog.records if r.name == "oberfranken.chat"]
    assert all(("outcome=answer" in l or "outcome=fallback" in l) for l in lines) and not any("reason=" in l for l in lines)

def test_a_reason_that_is_not_in_the_fixed_set_is_never_logged(caplog):
    from oberfranken_rag.chat.service import Reply
    caplog.set_level(logging.INFO)
    class Odd(ChatService):
        def answer(self, *a, **k):
            r = Reply({"text": "x", "kind": "fallback", "isSample": False, "sources": []}); r.reason = "SENTINEL free text from somewhere"; return r
    rec = record(); c = TestClient(create_app(Odd({rec["id"]: rec}, FakeRetriever([result(rec)]), FakeProvider(), {}), S.Settings()), raise_server_exceptions=False)
    c.post("/api/chat", json=GOOD); assert "SENTINEL" not in caplog.text and logged_reasons(caplog) == []


# ---------------------------------------------------------------- optional selectedCity (Task 4)
@pytest.mark.parametrize("extra", [{}, {"selectedCity": None}, {"selectedCity": "bamberg"}, {"selectedCity": "bayreuth"}])
def test_selected_city_is_optional_and_accepts_the_two_pilot_cities(extra):
    c, _ = client(); r = c.post("/api/chat", json={**GOOD, **extra})
    assert r.status_code == 200; contract_ok(r.json())

@pytest.mark.parametrize("bad", ["Bamberg", "munich", "", 1, True, [], {}])
def test_invalid_selected_city_is_422(bad):
    c, _ = client(); r = c.post("/api/chat", json={**GOOD, "selectedCity": bad})
    assert r.status_code == 422 and r.json() == {"error": {"code": "invalid_request", "message": "The request is not valid."}}

def test_selected_city_is_forwarded_by_keyword_and_the_deadline_stays_positional():
    seen = []
    class Rec(ChatService):
        def answer(self, message, city, language, deadline=None, *, selected_city=None):
            seen.append((city, deadline, selected_city)); return super().answer(message, city, language, deadline, selected_city=selected_city)
    rec = record(); c = TestClient(create_app(Rec({rec["id"]: rec}, FakeRetriever([result(rec)]), FakeProvider(), {}), S.Settings()), raise_server_exceptions=False)
    c.post("/api/chat", json={**GOOD, "selectedCity": "bayreuth"}); c.post("/api/chat", json=GOOD)
    assert seen[0][2] == "bayreuth" and isinstance(seen[0][1], float) and seen[0][0] == "bamberg"
    assert seen[1][2] is None and isinstance(seen[1][1], float)

def test_a_clarification_reply_passes_through_with_four_fields_and_no_sources():
    c, _ = client(); r = c.post("/api/chat", json={"message": "Restaurants in Bamberg or Bayreuth?", "city": None, "language": "en"})
    body = r.json()
    assert r.status_code == 200 and body["kind"] == "clarification" and body["sources"] == [] and body["isSample"] is False
    assert set(body) == {"text", "kind", "isSample", "sources"} and body["text"].strip(); contract_ok(body)
    r2 = c.post("/api/chat", json={**GOOD, "selectedCity": "bayreuth"})  # a mismatched selection is a fallback, not a clarification
    assert r2.status_code == 200 and r2.json()["kind"] == "fallback"
