"""Shared fakes for the /api/chat tests. No network, no real model."""
import json
from oberfranken_rag.retrieve import RetrievalResult

def record(rid="BA-REST-01", **over):
    base = dict(
        id=rid, title="Schlenkerla", city="bamberg", topic="regional-food", record_type="restaurant",
        status="verified", answer_policy="normal", temporal="static", retrieved_at="2026-10-08",
        source_urls=["https://example.org/a", "https://www.schlenkerla.de/schlenkerla/karte/speisen.html"],
        metadata={"source_name": "Bamberg Tourismus"},
        content="Schlenkerla ist ein historischer Rauchbierausschank in Bamberg.",
        enrichment="Das Rauchbier wird aus Eichenfässern ausgeschenkt.",
        practical_details="Die Bamberger Zwiebel gehört zur Karte.",
        freshness_note="- Stand heute: täglich ab 9:30 Uhr geöffnet.",
        scope_note="", research_limits="",
        display={"title": {"de": "Schlenkerla", "en": "Schlenkerla (EN)"}, "summary": {"de": "s", "en": "s"}, "whyNotable": {"de": "w", "en": "w"}, "details": {}},
    )
    base.update(over)
    return base

def result(rec, distance=0.12, rank=1):
    return RetrievalResult(rec["id"], rec["title"], rec["city"], rec["topic"], rec["status"], rec["answer_policy"], "mixed",
                           rec["source_urls"], [rec["id"]], [], rec["retrieved_at"], rec["temporal"], rec["content"], distance, rank)

def model_json(answer="Schlenkerla serves smoked beer.", ids=("BA-REST-01",), supported=True):
    return json.dumps({"supported": supported, "answer": answer, "record_ids": list(ids)})

class FakeProvider:
    def __init__(self, content=None, error=None):
        self.content = content if content is not None else model_json()
        self.error = error
        self.calls = []
    def complete(self, system, user, deadline=None):
        self.calls.append((system, user)); self.deadlines = getattr(self, "deadlines", []) + [deadline]
        if self.error: raise self.error
        return self.content

class FakeRetriever:
    def __init__(self, results, on_call=None):
        self.results = results
        self.on_call = on_call
        self.calls = []
    def __call__(self, question, city, deadline=None):
        self.calls.append((question, city))
        if self.on_call: self.on_call()
        return list(self.results)

class CityRetriever:
    """Per-city results {city: [results]} (None = the city-less pilot search); records (question, city, deadline)."""
    def __init__(self, by_city, on_call=None):
        self.by_city, self.on_call, self.calls = by_city, on_call, []
    def __call__(self, question, city, deadline=None):
        self.calls.append((question, city, deadline))
        if self.on_call: self.on_call()
        return list(self.by_city.get(city, []))

def contract_ok(body):
    """The UI's response contract (ui/src/features/chat/assistantContract.ts), restated."""
    import re
    assert set(body) == {"text", "kind", "isSample", "sources"}
    assert isinstance(body["text"], str) and body["text"].strip()
    assert body["kind"] in ("answer", "out-of-scope", "fallback", "clarification")  # clarification: fixed city choice, never sources
    assert body["isSample"] is False
    assert isinstance(body["sources"], list)
    if body["kind"] == "answer": assert len(body["sources"]) >= 1
    else: assert body["sources"] == []
    for s in body["sources"]:
        assert set(s) == {"recordId", "title", "sourceName", "sourceUrl", "topic", "retrievedAt", "recordStatus"}
        assert all(isinstance(v, str) and v.strip() for v in s.values())
        assert s["recordStatus"] in ("verified", "limited")
        assert s["sourceUrl"].startswith(("http://", "https://"))
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", s["retrievedAt"])


class FakeClock:
    """Monotonic clock the test advances by hand."""
    def __init__(self, start=1000.0): self.t = start
    def __call__(self): return self.t
    def advance(self, seconds): self.t += seconds

def real_records():
    """The frozen v3.1 records, or None when the release file is unavailable."""
    from oberfranken_rag import config as c
    from oberfranken_rag.records import load_records
    return load_records(c.SOURCE) if c.SOURCE.exists() else None
