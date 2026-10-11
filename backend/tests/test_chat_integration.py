"""Real index and encoder (local, no network), mocked provider. Slow: loads the E5 model once."""
import json
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.chat import settings as S
from oberfranken_rag.chat.api import build_service
from chat_fakes import FakeProvider, contract_ok

pytestmark = pytest.mark.skipif(not (c.STORAGE / "current.json").exists() or not c.SOURCE.exists(), reason="local index not built")

@pytest.fixture(scope="module")
def parts():
    provider = FakeProvider()
    return build_service(S.Settings(), provider), provider

def fake_answer(provider, ids):
    provider.content = json.dumps({"supported": True, "answer": "Smoked beer is a Bamberg tradition.", "record_ids": ids})

def test_rauchbier_question_reaches_the_model_with_bamberg_evidence_and_real_provenance(parts):
    service, provider = parts; provider.calls.clear()
    fake_answer(provider, ["BA-FOOD-02"])
    body = service.answer("Why is Rauchbier special in Bamberg?", "bamberg", "en"); contract_ok(body)
    assert body["kind"] == "answer" and body["sources"][0]["recordId"] == "BA-FOOD-02"
    assert body["sources"][0]["sourceUrl"].startswith("https://") and body["sources"][0]["recordStatus"] == "verified"
    system, user = provider.calls[0]
    assert 'id="BA-FOOD-02"' in user and "Bayreuth" not in user.split("Evidence:")[0]
    assert user.count("<evidence ") <= 5

def test_regional_oberfranken_records_remain_eligible_under_a_city_filter(parts):
    service, _ = parts
    cities = {r.city for r in service.retrieve("Where can I eat Franconian food?", "bayreuth")}
    assert cities <= {"bayreuth", "oberfranken"}

def test_off_topic_and_nonsense_questions_do_not_reach_the_model(parts):
    service, provider = parts; provider.calls.clear()
    for q in ["What is the meaning of life?", "How do I bake a chocolate cake?", "Explain quantum computing", "Wie wird das Wetter morgen in Hamburg?"]:
        body = service.answer(q, None, "en"); contract_ok(body); assert body["kind"] in ("fallback", "out-of-scope"), q
    assert provider.calls == []

def test_limited_and_source_backed_records_are_reported_as_limited(parts):
    service, provider = parts
    found = service.retrieve("Welche Aqua Fitness Kurse gibt es im Bambados?", "bamberg")
    sb = next((r for r in found if r.status == "source_backed"), None); assert sb, "expected a source_backed record"
    fake_answer(provider, [sb.id]); body = service.answer("Welche Aqua Fitness Kurse gibt es im Bambados?", "bamberg", "de")
    if body["kind"] == "answer": assert all(s["recordStatus"] == "limited" for s in body["sources"] if s["recordId"] == sb.id)
