import importlib.util
from pathlib import Path
import pytest
from chat_fakes import real_records

spec = importlib.util.spec_from_file_location("live_smoke", Path(__file__).resolve().parents[1] / "scripts" / "live_smoke.py")
smoke = importlib.util.module_from_spec(spec); spec.loader.exec_module(smoke)

def good(rec):
    return {"text": "x", "kind": "answer", "isSample": False, "sources": [{"recordId": rec["id"], "title": rec["title"], "sourceName": "n", "sourceUrl": rec["source_urls"][0],
            "topic": rec["topic"], "retrievedAt": rec["retrieved_at"], "recordStatus": "verified" if rec["status"] == "verified" else "limited"}]}

@pytest.fixture(scope="module")
def parts():
    rows = real_records()
    if rows is None: pytest.skip("release data unavailable")
    by_id = {r["id"]: r for r in rows}
    return by_id, next(r for r in rows if r["id"] == "BA-FOOD-02")

def test_a_valid_reply_passes(parts):
    by_id, rec = parts; assert smoke.check_reply(good(rec), by_id) == []

def test_problems_are_found(parts):
    by_id, rec = parts
    for mutate, text in [(lambda r: r["sources"][0].update(recordId="made-up"), "unknown record"), (lambda r: r["sources"][0].update(sourceUrl="https://evil.example/"), "URL"),
                         (lambda r: r["sources"][0].update(recordStatus="verified" if rec["status"] != "verified" else "limited"), "status"),
                         (lambda r: r["sources"][0].update(retrievedAt="2020-01-01"), "date"), (lambda r: r.update(sources=[]), "without sources"),
                         (lambda r: r.update(kind="fallback"), "non-answer"), (lambda r: r.update(isSample=True), "isSample"), (lambda r: r.update(extra=1), "fields")]:
        reply = good(rec); mutate(reply)
        assert any(text in p for p in smoke.check_reply(reply, by_id)), text

def test_a_changing_record_cited_as_an_answer_source_is_flagged(parts):
    by_id, _ = parts; changing = next(r for r in by_id.values() if r["answer_policy"] != "normal")
    assert any("changing" in p for p in smoke.check_reply(good(changing), by_id))

def test_a_source_free_clarification_is_accepted(parts):
    by_id, _ = parts
    assert smoke.check_reply({"text": "Which city do you mean?", "kind": "clarification", "isSample": False, "sources": []}, by_id) == []

def test_a_clarification_with_sources_or_other_flaws_is_rejected(parts):
    by_id, rec = parts
    base = {"text": "Which city?", "kind": "clarification", "isSample": False, "sources": []}
    assert any("non-answer" in p for p in smoke.check_reply({**base, "sources": good(rec)["sources"]}, by_id))
    assert any("empty text" in p for p in smoke.check_reply({**base, "text": " "}, by_id))
    assert any("isSample" in p for p in smoke.check_reply({**base, "isSample": True}, by_id))
    assert any("bad kind" in p for p in smoke.check_reply({**base, "kind": "chitchat"}, by_id))
