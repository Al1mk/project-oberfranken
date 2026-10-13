"""Real cached E5/Chroma, recording stub provider: which records reach the prompt for two-city overviews. Proves routing and
evidence selection, NOT live prose. Outcomes per family are pinned to the frozen corpus; a limitation is not a KB change."""
import json
import re
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.chat import policy
from oberfranken_rag.chat.api import build_service
from oberfranken_rag.chat.settings import Settings
from chat_fakes import contract_ok

pytestmark = pytest.mark.skipif(not (c.STORAGE / "current.json").exists() or not c.SOURCE.exists(), reason="local index not built")
CITIES = ("bamberg", "bayreuth")
BA_RESTAURANTS, BY_RESTAURANTS = {"BA-REST-01", "BA-REST-02", "BA-REST-03"}, {"BY-REST-01", "BY-REST-02"}

class RecordingProvider:
    """Cites every supplied block, or only the first when `first_only` (to prove one-city citations are rejected)."""
    def __init__(self): self.calls, self.first_only = [], False
    def complete(self, system, user, deadline=None):
        self.calls.append((system, user))
        ids = re.findall(r'<evidence id="([^"]+)"', user)
        return json.dumps({"supported": True, "answer": "A documented pilot fact.", "record_ids": ids[:1] if self.first_only else ids})

@pytest.fixture(scope="module")
def real_service():
    provider = RecordingProvider()
    return build_service(Settings(), provider), provider

def run(real_service, question, page, ui_language="en", **kw):
    service, provider = real_service
    provider.calls.clear(); provider.first_only = False
    reply = service.answer(question, page, ui_language, **kw)
    if reply["kind"] != "clarification": contract_ok(reply)
    return reply, provider.calls

# Explicit regional overview questions for all six families (activities/fun incl. restaurants and sport), EN and DE.
FAMILIES = {
    "local-traditions": ("Which local traditions should I know in Upper Franconia?", "Welche lokalen Traditionen sollte ich in Oberfranken kennen?"),
    "regional-food": ("What typical food should I try in Upper Franconia?", "Welche typischen Gerichte sollte ich in Oberfranken probieren?"),
    "cultural-places": ("Which museums and sights can I visit in Upper Franconia?", "Welche Museen und Sehenswürdigkeiten kann ich in Oberfranken besuchen?"),
    "local-history": ("What should I know about the local history in Upper Franconia?", "Was sollte ich über die lokale Geschichte in Oberfranken wissen?"),
    "newcomer-essentials": ("How do I register my address in Upper Franconia?", "Wie melde ich meinen Wohnsitz in Oberfranken an?"),
    "activities-fun": ("What can I do for fun in Upper Franconia?", "Was kann man in Oberfranken in der Freizeit unternehmen?"),
    "restaurants": ("Can you recommend a restaurant in Upper Franconia?", "Kannst du in Oberfranken ein Restaurant empfehlen?"),
    "sport": ("Where can I play football in Upper Franconia?", "Wo kann ich in Oberfranken Fußball spielen?"),
}
# Pinned against the frozen v3.2 corpus and unchanged gates: generated | pointer | partial:<covered city> | fallback.
# Repair round (Ali D4/R1): per-city retrieval context puts the city where the region word was (retrieval query only), and the
# family gate runs before distance. Unchanged data, model and thresholds. Remaining limitation: DE address registration has no
# safe static text in either city (all registration records are changing), so it points to sources in both cities.
EXPECTED = {(family, lang): "generated" for family in FAMILIES for lang in ("en", "de")}
EXPECTED[("newcomer-essentials", "de")] = "pointer"
# Every case also has a set of records any supplied parent must come from, where the route fixes them.
ALLOWED = {"restaurants": BA_RESTAURANTS | BY_RESTAURANTS, "sport": {"BA-SPORT-02", "BA-SPORT-03", "BY-SPORT-01"}}

def outcome(reply, calls):
    if calls: return "generated" if reply["kind"] == "answer" else "rejected"
    if reply["kind"] == "fallback": return "fallback"
    for (covered, missing), lang in ((pair, lang) for pair in (CITIES, CITIES[::-1]) for lang in ("en", "de")):
        if reply["text"] == policy.partial_coverage_text(covered, missing, lang): return f"partial:{covered}"
    return "pointer"

def check(service, question, lang, reply, calls, family=None):
    records = service.records
    kind = outcome(reply, calls)
    if kind == "generated":
        system, user = calls[0]
        assert len(calls) == 1 and f"Question: {question}" in user
        assert "Write the answer in " + ("English" if lang == "en" else "German") in system and "Bamberg/Bayreuth distinction" in system
        blocks = re.findall(r'<evidence id="([^"]+)" scope="([^"]+)"', user)
        ids = [i for i, _ in blocks]
        assert len(ids) == len(set(ids)) <= 5
        cities = [records[i]["city"] for i in ids]
        assert all(1 <= cities.count(city) <= 2 for city in CITIES) and set(cities) <= {*CITIES, "oberfranken"}
        assert all(scope == (records[i]["city"] if records[i]["city"] in CITIES else "shared Oberfranken") for i, scope in blocks)
        assert {records[s["recordId"]]["city"] for s in reply["sources"]} >= set(CITIES) and {s["recordId"] for s in reply["sources"]} <= set(ids)
        if family in ALLOWED: assert set(ids) <= ALLOWED[family], (question, ids)
    elif kind == "pointer":
        assert 2 <= len(reply["sources"]) <= 3 and {records[s["recordId"]]["city"] for s in reply["sources"]} >= set(CITIES)
    elif kind.startswith("partial:"):
        assert {records[s["recordId"]]["city"] for s in reply["sources"]} == {kind.split(":")[1]}
    else:
        assert kind == "fallback" and reply["sources"] == []
    return kind

@pytest.mark.parametrize("page", [None, "bamberg", "bayreuth"])
@pytest.mark.parametrize("family,lang", list(EXPECTED))
def test_explicit_regional_overview_per_family_language_and_page(real_service, family, lang, page):
    question = FAMILIES[family][lang == "de"]
    reply, calls = run(real_service, question, page, "de" if lang == "en" else "en")
    assert check(real_service[0], question, lang, reply, calls, family) == EXPECTED[(family, lang)], (question, page, reply["text"][:80], reply["sources"])

@pytest.mark.parametrize("question", ["What traditions are found across Oberfranken, including Bamberg?",
                                      "Welche Traditionen gibt es in Oberfranken, zum Beispiel in Bamberg?"])
def test_incidental_example_city_keeps_both_cities(real_service, question):
    reply, calls = run(real_service, question, "bamberg")
    assert check(real_service[0], question, policy.reply_language(question, "en"), reply, calls) == "generated"

@pytest.mark.parametrize("question", ["Compare restaurants in Bamberg and Bayreuth", "Vergleiche Restaurants in Bamberg und Bayreuth"])
def test_explicit_two_city_restaurant_comparison_uses_reviewed_restaurants_of_both(real_service, question):
    reply, calls = run(real_service, question, "bayreuth")
    lang = policy.reply_language(question, "en")
    assert check(real_service[0], question, lang, reply, calls, "restaurants") == "generated"

def test_a_model_citing_one_city_only_is_rejected_with_real_retrieval(real_service):
    service, provider = real_service
    provider.calls.clear(); provider.first_only = True
    reply = service.answer("Can you recommend a restaurant in Upper Franconia?", None, "en")
    contract_ok(reply)
    assert len(provider.calls) == 1 and reply["kind"] == "fallback" and reply["sources"] == [] and reply.reason == "missing_citations"

@pytest.mark.parametrize("question,lang", [("Which local traditions should I know?", "en"), ("Welche lokalen Traditionen sollte ich kennen?", "de"),
                                           ("Can you recommend a restaurant?", "en"), ("Restaurants in Bamberg oder Bayreuth?", "de")])
def test_home_orientation_clarifies_without_retrieval_or_provider(real_service, question, lang):
    reply, calls = run(real_service, question, None, lang)
    assert reply == {"text": policy.note("clarify_city", policy.reply_language(question, lang)), "kind": "clarification", "isSample": False, "sources": []}
    assert calls == []

@pytest.mark.parametrize("question", ["Can you recommend a restaurant?", "Kannst du ein Restaurant empfehlen?", "Restaurants in Bamberg or Bayreuth?"])
@pytest.mark.parametrize("city,expected", [("bamberg", BA_RESTAURANTS), ("bayreuth", BY_RESTAURANTS)])
def test_typed_city_confirmation_answers_that_city_only(real_service, question, city, expected):
    reply, calls = run(real_service, question, None, "en", selected_city=city)
    assert len(calls) == 1 and set(re.findall(r'<evidence id="([^"]+)"', calls[0][1])) <= expected
    assert f"Question: {question}" in calls[0][1] and 'scope="' not in calls[0][1] and {s["recordId"] for s in reply["sources"]} <= expected

@pytest.mark.parametrize("city,expected", [("bamberg", BA_RESTAURANTS), ("bayreuth", BY_RESTAURANTS)])
def test_page_default_without_geography_stays_local(real_service, city, expected):
    reply, calls = run(real_service, "Can you recommend a restaurant?", city)
    assert len(calls) == 1 and set(re.findall(r'<evidence id="([^"]+)"', calls[0][1])) <= expected and reply["kind"] == "answer"

def test_typed_confirmation_cannot_narrow_a_regional_overview(real_service):
    reply, calls = run(real_service, "What can I do for fun in Upper Franconia?", None, selected_city="bamberg")
    assert reply["kind"] == "fallback" and reply["text"] == policy.note("selection_mismatch", "en") and calls == []

def test_opposite_page_conflict_is_kept(real_service):
    reply, calls = run(real_service, "Can you recommend a restaurant in Bayreuth?", "bamberg")
    assert reply["text"] == policy.conflict_text("bamberg", "en") and calls == []

@pytest.mark.parametrize("question", ["What is Rauchbier?", "Was ist fränkisches Schäufele?"])
def test_home_ordinary_fact_searches_the_pilot_without_two_city_labels(real_service, question):
    reply, calls = run(real_service, question, None)
    assert len(calls) == 1 and 'scope="' not in calls[0][1] and "distinction" not in calls[0][0] and reply["kind"] == "answer"


# --- repair round (Ali R1/D4) on the real index --------------------------------------------------------------------------
@pytest.mark.parametrize("family", ["local-traditions", "local-history", "activities-fun"])
def test_food_profile_records_no_longer_count_as_bayreuth_coverage_for_non_food_overviews(real_service, family):
    reply, calls = run(real_service, FAMILIES[family][1], None)
    ids = set(re.findall(r'<evidence id="([^"]+)"', calls[0][1]))
    assert "BT-FOOD-GENUSSORT" not in ids
    if family != "local-traditions": assert "BT-FOOD-001" not in ids  # its own text names a "Brautradition": a tradition anchor

@pytest.mark.parametrize("question,lang", [("Which local traditions should I know?", "en"), ("Welche lokalen Traditionen sollte ich kennen?", "de"),
                                           ("What can I do for fun?", "en"), ("Was kann man in der Freizeit unternehmen?", "de")])
@pytest.mark.parametrize("city", CITIES)
def test_confirmed_choice_without_a_city_word_answers_that_city(real_service, question, lang, city):
    reply, calls = run(real_service, question, None, "en", selected_city=city)
    assert len(calls) == 1 and f"Question: {question}" in calls[0][1] and reply["kind"] == "answer"
    ids = re.findall(r'<evidence id="([^"]+)"', calls[0][1])
    assert {real_service[0].records[i]["city"] for i in ids} <= {city, "oberfranken"}
