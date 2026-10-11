"""Real E5 + real frozen Chroma + service; only the paid provider is replaced.

These prove evidence routing and prompt language, NOT live generated prose.
"""
import json
import re
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.chat.api import build_service
from oberfranken_rag.chat.settings import Settings
from chat_fakes import contract_ok

pytestmark = pytest.mark.skipif(not (c.STORAGE / "current.json").exists(), reason="local index not built")

class RecordingProvider:
    def __init__(self):
        self.calls = []
    def complete(self, system, user, deadline=None):
        self.calls.append((system, user))
        ids = re.findall(r'<evidence id="([^"]+)"', user)
        return json.dumps({"supported": True, "answer": "A documented fact.", "record_ids": ids[:1]})

@pytest.fixture(scope="module")
def real_service():
    provider = RecordingProvider()
    return build_service(Settings(), provider), provider

CASES = [
    ("Welche regionale Tradition sollte ich in Bamberg kennen?", "bamberg", "German", {"BA-TRAD-01", "BA-RESEARCH-012", "BA-RESEARCH-002", "BA-RESEARCH-011"}),
    ("What is Rauchbier, and what gives it its smoky taste?", "bamberg", "English", {"BA-FOOD-02"}),
    ("Was sind Bamberger Hörnla?", "bamberg", "German", {"BA-FOOD-01"}),
    ("Why is Bamberg’s old town a UNESCO World Heritage Site?", "bamberg", "English", {"BA-HIST-02"}),
    ("Welche drei historischen Stadtbereiche gehören zum Bamberger Welterbe?", "bamberg", "German", {"BA-HIST-03"}),
    ("What is Schlenkerla known for in Bamberg?", "bamberg", "English", {"BA-REST-01"}),
    ("Warum sind die Bamberg Baskets für die Sportgeschichte der Stadt wichtig?", "bamberg", "German", {"BA-SPORT-01"}),
    ("I’m visiting Bamberg for a day. What could I do for fun without joining a university group?", "bamberg", "English", {"BA-ACT-LEISURE-ORIENTATION", "BA-ACT-SURVIVAL-GUIDE"}),
    ("Wer gründete das Bistum Bamberg und in welchem Jahr?", "bamberg", "German", {"BA-HIST-01"}),
    ("Is there an English-language student theatre group in Bamberg?", "bamberg", "English", {"BA-ACT-ENGLISH-DRAMA"}),
    ("Wer war Wilhelmine und warum ist sie für Bayreuth wichtig?", "bayreuth", "German", {"BY-HIST-03"}),
    ("Are the Margravial Opera House and Wagner’s Festival Theatre the same building?", "bayreuth", "English", {"BY-SIGHT-01", "BY-SIGHT-02"}),
    ("Was ist fränkisches Schäufele?", "bayreuth", "German", {"BY-FOOD-02"}),
    ("What local sausage speciality is associated with Bayreuth?", "bayreuth", "English", {"BY-FOOD-01", "BT-FOOD-001"}),
    ("Seit welchem Jahr war Bayreuth Sitz der Markgrafen von Brandenburg-Bayreuth?", "bayreuth", "German", {"BY-HIST-02"}),
    ("What regional dish is documented for Oskar – Das Wirtshaus am Markt?", "bayreuth", "English", {"BY-REST-01"}),
    ("Was bedeutet „Oldschdod“ im Zusammenhang mit dem Bayreuther Fußball?", "bayreuth", "German", {"BY-SPORT-01"}),
    ("What kind of art does the Iwalewahaus focus on?", "bayreuth", "English", {"BT-CULT-026"}),
    ("Wobei hilft das Buddy-Programm internationalen Studierenden in Bayreuth?", "bayreuth", "German", {"BT-NEW-BUDDY"}),
    ("What does the orientation week for admitted international students in Bayreuth cover?", "bayreuth", "English", {"BT-NEW-INTERNATIONAL-ORIENTATION"}),
]

@pytest.mark.parametrize("question,city,language,expected_ids", CASES)
def test_positive_transcript_questions_select_relevant_static_evidence(real_service, question, city, language, expected_ids):
    service, provider = real_service
    provider.calls.clear()
    reply = service.answer(question, city, "de")
    contract_ok(reply)
    assert provider.calls, (question, reply)
    system, prompt = provider.calls[0]
    assert language in system
    supplied = set(re.findall(r'<evidence id="([^"]+)"', prompt))
    assert supplied & expected_ids, (question, supplied)
    assert len(supplied) <= 5
    assert not reply["text"].startswith(("Quellenhinweis:", "Source pointer:"))
    if len(expected_ids) == 2 and "same building" in question:
        assert expected_ids <= supplied

@pytest.mark.parametrize("question,kind", [
    ("Welche Wohnungen sind heute in Bamberg für weniger als 400 Euro frei?", "out-of-scope"),
    ("Based on my personal circumstances, am I legally entitled to a German student visa?", "out-of-scope"),
    ("Welche Medikamente sollte ich gegen Bauchschmerzen nehmen?", "out-of-scope"),
    ("What are the best attractions to visit in Berlin?", "out-of-scope"),
    ("How many tickets are available right now for tonight’s performance at the Bayreuth Festspielhaus?", "answer"),
])
def test_negative_transcript_questions_make_no_provider_call(real_service, question, kind):
    service, provider = real_service
    provider.calls.clear()
    reply = service.answer(question, None, "de")
    contract_ok(reply)
    assert provider.calls == []
    assert reply["kind"] == kind, (question, reply)
    if kind == "answer":
        assert reply["text"].startswith("Source pointer:")
        assert {s["recordId"] for s in reply["sources"]} <= {"BY-SIGHT-02"}
    else:
        assert reply["sources"] == []

def test_audited_excerpts_are_verbatim_and_have_no_volatile_facts(real_service):
    from oberfranken_rag.chat.evidence import STATIC_EXCERPTS, reviewed_excerpt
    from oberfranken_rag.chat import policy
    service, _ = real_service
    for rid in STATIC_EXCERPTS:
        text = reviewed_excerpt(service.records[rid])
        assert text and not policy.has_volatile(text), rid
