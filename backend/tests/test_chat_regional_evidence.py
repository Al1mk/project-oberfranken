"""Two-city regional overviews: per-city retrieval, gates, balanced evidence and cross-city citation coverage.
Recording retrieval + stub provider only: no network, no model, no index."""
import inspect
import re
from copy import deepcopy
import pytest
from chat_fakes import CityRetriever, FakeClock, FakeProvider, contract_ok, model_json, real_records, record, result
from oberfranken_rag.chat import discovery, policy
from oberfranken_rag.chat.provider import ProviderError
from oberfranken_rag.chat.regional_evidence import city_query, discovery_text
from oberfranken_rag.chat.service import ChatService

REGIONAL = "Which traditions should I know in Upper Franconia?"
REGIONAL_DE = "Welche Traditionen sollte ich in Oberfranken kennen?"

def rec(rid, city, **over):
    base = dict(city=city, title=f"Tradition {rid}", topic="local-traditions", record_type="fact", display=None, metadata={"source_name": "Quelle"},
                source_urls=[f"https://{rid.lower()}.example.org/page"], content=f"Fakt zu {rid}.", enrichment="")
    base.update(over)
    return record(rid, **base)

def changing(rid, city, **over):
    return rec(rid, city, answer_policy="verify_live_before_answering", temporal="changing", **over)

BA_A, BA_B, BA_C = rec("BA-A", "bamberg"), rec("BA-B", "bamberg"), rec("BA-C", "bamberg")
BY_A, BY_B, BY_C = rec("BY-A", "bayreuth"), rec("BY-B", "bayreuth"), rec("BY-C", "bayreuth")
OF_A, OF_B = rec("OF-A", "oberfranken"), rec("OF-B", "oberfranken")

def make(by_city, rows=None, answer="Bamberg has one tradition; Bayreuth has another.", ids=("BA-A", "BY-A"), clock=None, provider=None):
    rows = rows if rows is not None else [r for hits in by_city.values() for r, _ in hits]
    retriever = CityRetriever({c: [result(r, d, i + 1) for i, (r, d) in enumerate(hits)] for c, hits in by_city.items()})
    provider = provider or FakeProvider(model_json(answer, ids))
    service = ChatService({r["id"]: r for r in rows}, retriever, provider, {}, **({"clock": clock} if clock else {}))
    return service, retriever, provider

def supplied(provider):
    return re.findall(r'<evidence id="([^"]+)"', provider.calls[0][1])

def ask(service, message=REGIONAL, city=None, language="en", **kw):
    body = service.answer(message, city, language, **kw)
    if body["kind"] != "clarification": contract_ok(body)
    return body

BOTH = {"bamberg": [(BA_A, .10), (BA_B, .11)], "bayreuth": [(BY_A, .15), (BY_B, .16)]}

# --- both-city selection ----------------------------------------------------------------------
@pytest.mark.parametrize("page", [None, "bamberg", "bayreuth"])
def test_regional_overview_retrieves_each_city_and_supplies_both(page):
    service, retriever, provider = make(BOTH)
    body = ask(service, city=page)
    # Ali D4: city context in the per-city RETRIEVAL query only (the region word becomes the city); the prompt keeps the original.
    assert [(q, c) for q, c, _ in retriever.calls] == [("Which traditions should I know in Bamberg?", "bamberg"),
                                                         ("Which traditions should I know in Bayreuth?", "bayreuth")]
    assert f"Question: {REGIONAL}" in provider.calls[0][1]
    assert len(provider.calls) == 1 and set(supplied(provider)) == {"BA-A", "BA-B", "BY-A", "BY-B"}
    assert body["kind"] == "answer" and [s["recordId"] for s in body["sources"]] == ["BA-A", "BY-A"]

def test_prompt_keeps_original_question_labels_city_scope_and_asks_for_a_distinction():
    service, _, provider = make({"bamberg": [(BA_A, .10), (OF_A, .11)], "bayreuth": [(BY_A, .12), (OF_A, .11)]})
    ask(service, REGIONAL_DE, "bamberg", "en")
    system, user = provider.calls[0]
    assert f"Question: {REGIONAL_DE}" in user
    assert '<evidence id="BA-A" scope="bamberg"' in user and '<evidence id="BY-A" scope="bayreuth"' in user
    assert '<evidence id="OF-A" scope="shared Oberfranken"' in user
    assert "Bamberg/Bayreuth distinction" in system and "at most four short sentences" in system and "Write the answer in German" in system
    assert "two-city pilot" in system

def test_single_city_prompt_is_unchanged_by_regional_labels():
    service, retriever, provider = make({"bamberg": [(BA_A, .10)]}, ids=("BA-A",))
    ask(service, "Which traditions should I know?", "bamberg")
    assert 'scope="' not in provider.calls[0][1] and "distinction" not in provider.calls[0][0]
    assert retriever.calls[0][:2] == ("Which traditions should I know?", "bamberg")  # page default retrieval is unchanged

# --- per-city gates ---------------------------------------------------------------------------
def test_a_strong_bamberg_hit_cannot_suppress_bayreuth():
    service, _, provider = make({"bamberg": [(BA_A, .02)], "bayreuth": [(BY_A, .19)]})
    ask(service)
    assert set(supplied(provider)) == {"BA-A", "BY-A"}

def test_close_and_item_cutoffs_apply_within_each_city():
    by_city = {"bamberg": [(BA_A, .10), (BA_B, .14), (BA_C, .23)], "bayreuth": [(BY_A, .17), (BY_B, .19), (BY_C, .205)]}
    service, _, provider = make(by_city)
    ask(service)
    assert set(supplied(provider)) == {"BA-A", "BY-A", "BY-B"}  # .14 > best+.03 and .23 > .22 dropped; .19 is within Bayreuth's own window

@pytest.mark.parametrize("language", ["en", "de"])
def test_far_second_city_gives_partial_coverage_without_a_provider_call(language):
    service, _, provider = make({"bamberg": [(BA_A, .10)], "bayreuth": [(BY_A, .205), (BY_B, .21)]})
    body = ask(service, REGIONAL if language == "en" else REGIONAL_DE, language=language)
    assert provider.calls == [] and body["kind"] == "answer"
    assert body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", language)
    assert [s["recordId"] for s in body["sources"]] == ["BA-A"]

def test_other_city_rows_returned_by_a_search_are_never_city_evidence():
    service, _, provider = make({"bamberg": [(BA_A, .10), (BY_A, .10)], "bayreuth": [(BA_B, .10)]})
    body = ask(service)
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", "en")

# --- one-city-only safe evidence --------------------------------------------------------------
@pytest.mark.parametrize("language", ["en", "de"])
def test_safe_text_for_one_city_and_a_valid_pointer_for_the_other_points_to_both(language):
    # Ali D3 (replaces the earlier partial-coverage pin): a valid Bayreuth pointer is a usable source, so the reply keeps
    # pointers for BOTH cities and says facts could be isolated only for Bamberg. No generation, no partial_coverage_text.
    service, _, provider = make({"bamberg": [(BA_A, .10), (BA_B, .11)], "bayreuth": [(changing("BY-X", "bayreuth"), .10), (changing("BY-Y", "bayreuth"), .11)]})
    body = ask(service, REGIONAL if language == "en" else REGIONAL_DE, language=language)
    ids = [s["recordId"] for s in body["sources"]]
    assert provider.calls == [] and body["kind"] == "answer" and body["text"] == policy.split_pointer_text("bamberg", language)
    assert body["text"] != policy.partial_coverage_text("bamberg", "bayreuth", language)
    assert "BA-A" in ids and "BY-X" in ids and len(ids) <= 3

@pytest.mark.parametrize("language", ["en", "de"])
def test_split_pointer_text_names_both_pilot_cities_and_the_covered_one(language):
    text = policy.split_pointer_text("bayreuth", language)
    assert "Bamberg" in text and "Bayreuth" in text and text.startswith(("Source pointer:", "Quellenhinweis:")) and "?" not in text
    assert text != policy.split_pointer_text("bamberg", language)

def test_no_safe_static_text_in_either_city_points_to_both_cities():
    bx, by = changing("BA-X", "bamberg"), changing("BY-X", "bayreuth")
    service, _, provider = make({"bamberg": [(bx, .10)], "bayreuth": [(by, .12)]})
    body = ask(service)
    assert provider.calls == [] and body["text"] == policy.note("static_pointer", "en")
    assert [s["recordId"] for s in body["sources"]] == ["BA-X", "BY-X"]

# --- shared regional parents ------------------------------------------------------------------
def test_shared_parents_are_deduplicated_and_fill_remaining_space():
    service, _, provider = make({"bamberg": [(BA_A, .10), (OF_A, .11)], "bayreuth": [(BY_A, .12), (OF_A, .11), (OF_B, .12)]})
    ask(service)
    ids = supplied(provider)
    assert ids.count("OF-A") == 1 and set(ids) == {"BA-A", "BY-A", "OF-A", "OF-B"}

def test_shared_parents_do_not_count_as_a_city():
    service, _, provider = make({"bamberg": [(BA_A, .10), (OF_A, .11)], "bayreuth": [(OF_A, .11)]})
    body = ask(service)
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", "en")
    assert [s["recordId"] for s in body["sources"]] == ["BA-A"]

def test_shared_only_evidence_cannot_make_a_regional_overview():
    service, _, provider = make({"bamberg": [(OF_A, .10)], "bayreuth": [(OF_A, .10)]})
    body = ask(service)
    assert provider.calls == [] and body["kind"] == "fallback" and body["sources"] == [] and body.reason == "weak_evidence"

def test_a_far_shared_row_is_not_padding():
    service, _, provider = make({"bamberg": [(BA_A, .10), (OF_A, .21)], "bayreuth": [(BY_A, .10), (OF_A, .21)]})
    ask(service)
    assert set(supplied(provider)) == {"BA-A", "BY-A"}

# --- caps -------------------------------------------------------------------------------------
def test_at_most_five_parents_two_reserved_per_city_remainder_shared():
    by_city = {"bamberg": [(BA_A, .10), (BA_B, .10), (BA_C, .10), (OF_A, .10), (OF_B, .11)],
               "bayreuth": [(BY_A, .10), (BY_B, .11), (BY_C, .11), (OF_A, .10), (OF_B, .11)]}
    service, _, provider = make(by_city)
    ask(service)
    assert supplied(provider) == ["BA-A", "BA-B", "BY-A", "BY-B", "OF-A"]

def test_no_padding_when_one_city_has_a_single_parent():
    service, _, provider = make({"bamberg": [(BA_A, .10), (BA_B, .10), (BA_C, .10)], "bayreuth": [(BY_A, .10)]})
    ask(service)
    assert supplied(provider) == ["BA-A", "BA-B", "BY-A"]

# --- provenance -------------------------------------------------------------------------------
@pytest.mark.parametrize("urls", [[], ["ftp://example.org/x"], ["mailto:info@example.org"]])
def test_missing_provenance_never_yields_a_source_card_or_city_coverage(urls):
    bad = rec("BY-BAD", "bayreuth", source_urls=urls)
    service, _, provider = make({"bamberg": [(BA_A, .10)], "bayreuth": [(bad, .05)]})
    body = ask(service)
    assert provider.calls == [] and "BY-BAD" not in {s["recordId"] for s in body["sources"]}
    assert body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", "en")

def test_zero_valid_provenance_is_a_source_free_no_evidence_fallback():
    service, _, provider = make({"bamberg": [(rec("BA-BAD", "bamberg", source_urls=[]), .10)], "bayreuth": [(rec("BY-BAD", "bayreuth", source_urls=["ftp://x"]), .10)]})
    body = ask(service)
    assert provider.calls == [] and body["kind"] == "fallback" and body["sources"] == []
    assert body["text"] == policy.note("no_evidence", "en") and body.reason == "weak_evidence"

# --- current-detail pointers ------------------------------------------------------------------
LIVE = "What are the opening hours of museums in Upper Franconia?"
def museum(rid, city, **over): return changing(rid, city, topic="cultural-places", **over)

def test_live_details_point_to_both_cities_at_most_three():
    by_city = {"bamberg": [(museum("BA-X", "bamberg"), .10), (museum("BA-M", "bamberg"), .11)], "bayreuth": [(museum("BY-X", "bayreuth"), .15), (museum("BY-M", "bayreuth"), .16), (museum("BY-N", "bayreuth"), .17)]}
    service, _, provider = make(by_city)
    body = ask(service, LIVE)
    ids = [s["recordId"] for s in body["sources"]]
    assert provider.calls == [] and body["kind"] == "answer" and body["text"] == policy.note("signpost", "en")
    assert len(ids) <= 3 and {"BA-X", "BY-X"} <= set(ids)

def test_live_details_for_one_city_only_name_the_covered_and_missing_city():
    service, _, provider = make({"bamberg": [], "bayreuth": [(museum("BY-X", "bayreuth"), .10)]})
    body = ask(service, "Welche Öffnungszeiten haben Museen in Oberfranken?", language="en")
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bayreuth", "bamberg", "de")
    assert [s["recordId"] for s in body["sources"]] == ["BY-X"]

def test_live_details_without_any_pointer_are_a_no_evidence_fallback():
    service, _, provider = make({"bamberg": [(museum("BA-F", "bamberg"), .25)], "bayreuth": []})
    body = ask(service, LIVE)
    assert provider.calls == [] and body["kind"] == "fallback" and body["sources"] == []

# --- citation coverage ------------------------------------------------------------------------
@pytest.mark.parametrize("ids", [("BA-A",), ("BY-A", "BY-B"), ("BA-A", "OF-A"), ("OF-A",)])
def test_a_generated_answer_citing_one_city_only_is_rejected(ids):
    by_city = {"bamberg": [(BA_A, .10), (OF_A, .11)], "bayreuth": [(BY_A, .10), (BY_B, .11), (OF_A, .11)]}
    service, _, provider = make(by_city, ids=ids)
    body = ask(service)
    assert len(provider.calls) == 1 and body["kind"] == "fallback" and body["sources"] == []
    assert body["text"] == policy.note("unsupported", "en") and body.reason == "missing_citations"

def test_accepted_sources_are_exactly_the_cited_records_never_padded():
    by_city = {"bamberg": [(BA_A, .10), (BA_B, .11)], "bayreuth": [(BY_A, .10), (BY_B, .11)]}
    service, _, _ = make(by_city, ids=("BY-B", "BA-A"))
    assert [s["recordId"] for s in ask(service)["sources"]] == ["BY-B", "BA-A"]

@pytest.mark.parametrize("answer,ids,reason", [
    ("Bamberg and Bayreuth.", ("BA-A", "BY-A", "made-up"), "invalid_citation"),
    ("Bamberg and Bayreuth.", ("BA-A", "BA-C"), "invalid_citation"),
    ("Both open daily at 9:30.", ("BA-A", "BY-A"), "volatile_answer"),
    ("Founded in 1999 in both.", ("BA-A", "BY-A"), "unsupported_number"),
    ("", (), "missing_citations"),
])
def test_existing_answer_checks_still_reject_first(answer, ids, reason):
    service, _, _ = make(BOTH, rows=[BA_A, BA_B, BA_C, BY_A, BY_B], answer=answer or "x", ids=ids)
    body = ask(service)
    assert body["kind"] == "fallback" and body["sources"] == [] and body.reason == reason

def test_a_declined_regional_answer_stays_declined():
    service, _, _ = make(BOTH, provider=FakeProvider(model_json(supported=False, answer="", ids=[])))
    assert ask(service).reason == "model_declined"

def test_limited_cited_records_keep_the_server_warning():
    lim = rec("BY-L", "bayreuth", status="source_backed")
    service, _, _ = make({"bamberg": [(BA_A, .10)], "bayreuth": [(lim, .10)]}, ids=("BA-A", "BY-L"))
    body = ask(service)
    assert body["text"].count("limited source support") == 1 and body["sources"][1]["recordStatus"] == "limited"

# --- topic, entity and unknown constraints ------------------------------------------------------
def test_wrong_entity_records_are_dropped_before_distance():
    hall = rec("BA-HALL", "bamberg", title="Altes Rathaus Bamberg")
    service, _, provider = make({"bamberg": [(BA_A, .05), (hall, .12)], "bayreuth": [(BY_A, .05)]})
    body = ask(service, "Is the Old Town Hall typical for Oberfranken?")
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", "en")
    assert [s["recordId"] for s in body["sources"]] == ["BA-HALL"]

@pytest.fixture(scope="module")
def real():
    rows = real_records()
    assert rows, "frozen release required"
    return {r["id"]: r for r in rows}

def test_restaurant_route_runs_per_city_with_reviewed_ids_and_original_wording(real):
    question = "Can you recommend a restaurant in Upper Franconia?"
    by_city = {"bamberg": [(real["BA-SPORT-01"], .10), (real["BA-REST-02"], .12), (real["OF-FOOD-002"], .12)],
               "bayreuth": [(real["BY-REST-01"], .13), (real["BY-SPORT-03"], .12)]}
    service, retriever, provider = make(by_city, ids=("BA-REST-02", "BY-REST-01"))
    body = ask(service, question, "bayreuth")
    assert [(q, c) for q, c, _ in retriever.calls] == [(f"{c} {discovery.QUERIES['restaurant']}", c) for c in ("bamberg", "bayreuth")]
    assert set(supplied(provider)) == {"BA-REST-02", "BY-REST-01"} and f"Question: {question}" in provider.calls[0][1]
    assert "restaurant discovery request" in provider.calls[0][0]
    assert [s["sourceUrl"] for s in body["sources"]] == ["https://en.bamberg.info/gastronomie/mahrs_braeu-258",
                                                         "https://www.bayreuth-tourismus.de/restaurants/oskar-das-wirtshaus-am-markt"]

@pytest.mark.parametrize("question", ["Can you recommend a vegan restaurant in Oberfranken?", "Where can I play cricket in Upper Franconia?",
                                      "Kannst du in Oberfranken ein Restaurant für 10 Euro empfehlen?", "Where can I study engineering in Oberfranken?"])
def test_unknown_constraints_cannot_unlock_generic_regional_evidence(real, question):
    by_city = {"bamberg": [(real[i], .10) for i in ("BA-REST-02", "BA-SPORT-02", "BA-NEW-UNIVERSITY")],
               "bayreuth": [(real[i], .10) for i in ("BY-REST-01", "BY-SPORT-01", "BY-NEW-UNIVERSITY")]}
    service, retriever, provider = make(by_city)
    body = ask(service, question)
    assert provider.calls == [] and body["kind"] == "fallback" and body["sources"] == []
    # A constrained route keeps the original wording; only the reviewed region word becomes the city (Ali D4).
    assert [q for q, _, _ in retriever.calls] == [city_query(question, c) for c in ("bamberg", "bayreuth")]
    assert all(re.search(r"vegan|cricket|10 Euro|engineering", q) for q, _, _ in retriever.calls)

def test_regional_study_uses_each_city_university_and_keeps_the_pilot_disclaimer(real):
    by_city = {c: [(real[i], .10)] for c, i in (("bamberg", "BA-NEW-UNIVERSITY"), ("bayreuth", "BY-NEW-UNIVERSITY"))}
    service, retriever, provider = make(by_city, ids=("BA-NEW-UNIVERSITY", "BY-NEW-UNIVERSITY"))
    body = ask(service, "Where can I study in Oberfranken?", "bamberg")
    assert [q for q, _, _ in retriever.calls] == [discovery.study_query("bamberg"), discovery.study_query("bayreuth")]
    assert set(supplied(provider)) == {"BA-NEW-UNIVERSITY", "BY-NEW-UNIVERSITY"} and "study orientation" in provider.calls[0][0]
    assert "not a complete university directory" in body["text"]

# --- discovery text: geography syntax only ----------------------------------------------------
@pytest.mark.parametrize("question,intent", [
    ("Can you recommend a restaurant in Upper Franconia?", "restaurant"),
    ("Kannst du in Oberfranken ein Restaurant empfehlen?", "restaurant"),
    ("Compare restaurants in Bamberg and Bayreuth", "restaurant"),
    ("Vergleiche Restaurants in Bamberg und Bayreuth", "restaurant"),
    ("Where can I play football across Oberfranken, including Bamberg?", "football"),
    ("Wo kann ich in Oberfranken, zum Beispiel in Bamberg, Fußball spielen?", "football"),
    ("Which football clubs exist in both Bamberg and Bayreuth?", "football"),
    ("Where can I study in Oberfranken?", "study"),
])
def test_discovery_text_lets_reviewed_geography_reach_the_canonical_route(question, intent):
    route = discovery.interpret(discovery_text(question), "bamberg")
    assert route.intent == intent and route.query != discovery_text(question)

@pytest.mark.parametrize("question,kept", [
    ("Can you recommend a vegan restaurant in Oberfranken?", "vegan"), ("A restaurant for 10 euros in Upper Franconia?", "10"),
    ("Restaurants in Oberfranken in 2027?", "2027"), ("Ranked restaurants in Bamberg and Bayreuth", "Ranked"),
])
def test_discovery_text_keeps_unknown_constraints(question, kept):
    text = discovery_text(question)
    assert kept in text and discovery.interpret(text, "bamberg").query == text

# --- clarify, mismatch, conflict, ordinary facts ----------------------------------------------
@pytest.mark.parametrize("language", ["en", "de"])
def test_home_orientation_without_geography_is_a_free_source_free_clarification(language):
    service, retriever, provider = make(BOTH)
    body = service.answer({"en": "Which local traditions should I know?", "de": "Welche lokalen Traditionen sollte ich kennen?"}[language], None, language)
    assert body == {"text": policy.note("clarify_city", language), "kind": "clarification", "isSample": False, "sources": []}
    assert retriever.calls == [] and provider.calls == []

def test_two_city_alternatives_clarify_then_the_confirmed_city_is_searched_once():
    service, retriever, _ = make({"bayreuth": [(BY_A, .10)]}, ids=("BY-A",))
    assert ask(service, "Restaurants in Bamberg or Bayreuth?")["kind"] == "clarification" and retriever.calls == []
    ask(service, "Restaurants in Bamberg or Bayreuth?", selected_city="bayreuth")
    assert [(q, c) for q, c, _ in retriever.calls] == [(f"bayreuth {discovery.QUERIES['restaurant']}", "bayreuth")]
    body = ask(service, "Which local traditions should I know?", selected_city="bayreuth")
    # Ali D4: a confirmed choice adds its city to the retrieval query only; the prompt keeps the question as typed.
    assert retriever.calls[-1][:2] == ("Which local traditions should I know? Bayreuth", "bayreuth") and body["kind"] == "answer"

@pytest.mark.parametrize("language", ["en", "de"])
def test_mismatched_selection_is_a_fixed_fallback(language):
    service, retriever, provider = make(BOTH)
    body = ask(service, {"en": "What is Rauchbier?", "de": "Was ist Rauchbier?"}[language], None, language, selected_city="bayreuth")
    assert body["kind"] == "fallback" and body["text"] == policy.note("selection_mismatch", language)
    assert retriever.calls == [] and provider.calls == []

def test_selection_never_narrows_a_regional_overview():
    service, retriever, _ = make(BOTH)
    assert ask(service, selected_city="bamberg")["text"] == policy.note("selection_mismatch", "en") and retriever.calls == []

def test_opposite_city_conflict_is_kept():
    service, retriever, provider = make(BOTH)
    body = ask(service, "Which traditions should I know in Bayreuth?", "bamberg")
    assert body["kind"] == "fallback" and body["text"] == policy.conflict_text("bamberg", "en") and retriever.calls == provider.calls == []

def test_home_ordinary_fact_searches_the_pilot_once_without_two_city_coverage():
    service, retriever, provider = make({None: [(BA_A, .10)]}, ids=("BA-A",))
    body = ask(service, "What is Rauchbier?")
    assert [(q, c) for q, c, _ in retriever.calls] == [("What is Rauchbier?", None)]
    assert body["kind"] == "answer" and 'scope="' not in provider.calls[0][1]

def test_compare_both_cities_by_name_is_a_regional_overview():
    service, retriever, provider = make(BOTH)
    body = ask(service, "Compare the traditions of Bamberg and Bayreuth", "bayreuth")
    assert [c for _, c, _ in retriever.calls] == ["bamberg", "bayreuth"] and body["kind"] == "answer" and len(provider.calls) == 1

# --- signature, deadline, one call ------------------------------------------------------------
def test_selected_city_is_keyword_only_and_positional_deadline_still_works():
    param = inspect.signature(ChatService.answer).parameters["selected_city"]
    assert param.kind is inspect.Parameter.KEYWORD_ONLY and param.default is None
    clock = FakeClock()
    service, retriever, provider = make(BOTH, clock=clock)
    service.answer(REGIONAL, None, "en", clock() + 25)
    assert [d for _, _, d in retriever.calls] == [clock() + 25] * 2 and provider.deadlines == [clock() + 25]
    with pytest.raises(TypeError): service.answer(REGIONAL, None, "en", None, "bamberg")

def test_deadline_expiry_after_the_first_city_stops_further_work():
    clock = FakeClock()
    service, retriever, provider = make(BOTH, clock=clock)
    retriever.on_call = lambda: clock.advance(30)
    with pytest.raises(ProviderError) as exc: service.answer(REGIONAL, None, "en", clock() + 20)
    assert exc.value.code == "timeout" and len(retriever.calls) == 1 and provider.calls == []

def test_projection_without_its_audited_url_fails_closed_per_city(real):
    moved = deepcopy(real["BY-REST-01"]); moved["source_urls"] = ["https://oskar-bayreuth.de/"]
    service, _, provider = make({"bamberg": [(real["BA-REST-02"], .10)], "bayreuth": [(moved, .10)]}, ids=("BA-REST-02", "BY-REST-01"))
    body = ask(service, "Can you recommend a restaurant in Upper Franconia?")
    assert provider.calls == [] and "BY-REST-01" not in {s["recordId"] for s in body["sources"]}


# --- repair round (Ali R1): topic/family gate BEFORE distance and BEFORE city coverage ------------------------------
HISTORY = "What should I know about the local history in Upper Franconia?"
HISTORY_DE = "Was sollte ich über die lokale Geschichte in Oberfranken wissen?"
def restaurant(rid, city, text): return rec(rid, city, topic="regional-food", record_type="restaurant", title=f"Restaurant {rid}", content=text)
SUSHI = restaurant("BA-SUSHI", "bamberg", "Das Lokal bietet Sushi, Ramen und Bowls in modernem Ambiente.")
PIZZA = restaurant("BY-PIZZA", "bayreuth", "Die Pizzeria serviert Pizza aus dem Steinofen und Pasta.")
BA_HIST = rec("BA-H", "bamberg", topic="local-history", content="Bamberg wurde im Mittelalter Bischofssitz.")
BY_HIST = rec("BY-H", "bayreuth", topic="local-history", content="Bayreuth wurde später markgräfliche Residenz.")
FOOD_WITH_HISTORY = rec("BY-FH", "bayreuth", topic="regional-food", content="Die Esskultur entstand in historischen Herrschaftsgebieten; die Bezeichnung wurde im Jahrhundert der Reform eingeführt.")

@pytest.mark.parametrize("question", [HISTORY, HISTORY_DE])
def test_cross_topic_restaurants_are_not_history_evidence_for_either_city(question):
    service, _, provider = make({"bamberg": [(SUSHI, .05)], "bayreuth": [(PIZZA, .05)]})
    body = ask(service, question)
    assert provider.calls == [] and body["kind"] == "fallback" and body["sources"] == [] and body.reason == "weak_evidence"

def test_a_cross_topic_hit_cannot_suppress_or_count_as_a_city():
    # The sushi row is nearest in Bamberg but is gated before distance: the real history row defines Bamberg's window.
    service, _, provider = make({"bamberg": [(SUSHI, .02), (BA_HIST, .15)], "bayreuth": [(PIZZA, .02), (BY_HIST, .16)]}, ids=("BA-H", "BY-H"))
    body = ask(service, HISTORY)
    assert supplied(provider) == ["BA-H", "BY-H"] and [s["recordId"] for s in body["sources"]] == ["BA-H", "BY-H"]

def test_only_one_city_on_topic_is_partial_coverage():
    service, _, provider = make({"bamberg": [(BA_HIST, .10)], "bayreuth": [(PIZZA, .05)]})
    body = ask(service, HISTORY)
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bamberg", "bayreuth", "en")
    assert [s["recordId"] for s in body["sources"]] == ["BA-H"]

def test_a_real_historical_passage_inside_a_food_record_stays_eligible():
    service, _, provider = make({"bamberg": [(BA_HIST, .10)], "bayreuth": [(FOOD_WITH_HISTORY, .10)]}, ids=("BA-H", "BY-FH"))
    assert ask(service, HISTORY)["kind"] == "answer" and supplied(provider) == ["BA-H", "BY-FH"]

def test_cross_topic_pointer_rows_are_not_pointers_either():
    live = "What are the opening hours of history museums in Upper Franconia?"
    service, _, provider = make({"bamberg": [(changing("BA-SUSHI2", "bamberg", topic="regional-food", content="Sushi und Ramen."), .05)],
                                 "bayreuth": [(changing("BY-MUS", "bayreuth", topic="cultural-places", content="Historisches Museum."), .10)]})
    body = ask(service, live)
    assert provider.calls == [] and body["text"] == policy.partial_coverage_text("bayreuth", "bamberg", "en")

def test_question_without_a_detected_family_keeps_current_behaviour():
    service, _, provider = make({"bamberg": [(SUSHI, .05)], "bayreuth": [(PIZZA, .05)]}, ids=("BA-SUSHI", "BY-PIZZA"))
    assert ask(service, "Tell me something about Upper Franconia.")["kind"] == "answer" and len(provider.calls) == 1

# --- repair round (Ali D1/D2) through the service ---------------------------------------------------------------------
@pytest.mark.parametrize("question", ["Vegan restaurants?", "Restaurants with live music?", "Vegane Restaurants?"])
def test_home_constrained_discovery_clarifies_then_stays_constrained_after_a_selection(real, question):
    service, retriever, provider = make({c: [(real[i], .10)] for c, i in (("bamberg", "BA-REST-02"), ("bayreuth", "BY-REST-01"))})
    assert ask(service, question)["kind"] == "clarification" and retriever.calls == []
    body = ask(service, question, selected_city="bamberg")
    assert retriever.calls[0][1] == "bamberg" and provider.calls == []
    assert body["kind"] == "fallback" and body["sources"] == [] and body.reason == "weak_evidence"

def test_pending_choice_of_bayreuth_on_the_bamberg_page_answers_bayreuth(real):
    service, retriever, provider = make({"bayreuth": [(real["BY-REST-01"], .10)]}, ids=("BY-REST-01",))
    body = ask(service, "Restaurants in Bamberg or Bayreuth?", "bamberg", selected_city="bayreuth")
    assert [c for _, c, _ in retriever.calls] == ["bayreuth"] and body["kind"] == "answer" and body["sources"][0]["recordId"] == "BY-REST-01"

@pytest.mark.parametrize("selected", [None, "bayreuth"])
def test_explicit_opposite_city_question_is_a_conflict_even_with_a_selection(selected):
    service, retriever, provider = make(BOTH)
    body = ask(service, "Which restaurants are in Bayreuth?", "bamberg", selected_city=selected)
    assert body["text"] == policy.conflict_text("bamberg", "en") and retriever.calls == provider.calls == []

# --- repair round (Ali D4): bounded per-city retrieval context ----------------------------------------------------------
@pytest.mark.parametrize("question,city,expected", [
    ("Which traditions should I know in Upper Franconia?", "bayreuth", "Which traditions should I know in Bayreuth?"),
    ("Was kann man in Oberfranken in der Freizeit unternehmen?", "bamberg", "Was kann man in Bamberg in der Freizeit unternehmen?"),
    ("Compare the traditions of Bamberg and Bayreuth", "bayreuth", "Compare the traditions of Bamberg and Bayreuth"),
    ("Which local traditions should I know?", "bamberg", "Which local traditions should I know? Bamberg"),
    ("Vegan restaurants in Oberfranken for 10 euros?", "bamberg", "Vegan restaurants in Bamberg for 10 euros?"),
    ("Was bietet das Studierendenwerk Oberfranken in ganz Oberfranken?", "bamberg", "Was bietet das Studierendenwerk Oberfranken in ganz Bamberg?"),
])
def test_city_query_only_swaps_the_reviewed_region_word_or_appends_the_city(question, city, expected):
    assert city_query(question, city) == expected
