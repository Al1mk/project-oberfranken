"""Pure geography decisions: no retrieval, provider, model or message rewriting."""
import dataclasses
import re
import pytest
from oberfranken_rag.chat import policy
from oberfranken_rag.chat.evidence import ENTITY_ALIASES
from oberfranken_rag.records import load_records
from oberfranken_rag.chat.geography import ENTITIES, REVIEWED_ENTITIES, ScopeDecision, resolve_scope

BOTH = ("bamberg", "bayreuth")
PAGES = [None, "bamberg", "bayreuth"]
# All six families (activities/fun includes restaurant and sport discovery), EN and DE, `{loc}` = geography slot.
FAMILIES = {
    "local-traditions": ("Which local traditions should I know{loc}?", "Welche lokalen Traditionen sollte ich{loc} kennen?"),
    "regional-food": ("What typical food should I try{loc}?", "Welche typischen Gerichte sollte ich{loc} probieren?"),
    "cultural-places": ("Which museums and sights can I visit{loc}?", "Welche Museen und Sehenswürdigkeiten kann ich{loc} besuchen?"),
    "local-history": ("What should I know about the local history{loc}?", "Was sollte ich über die lokale Geschichte{loc} wissen?"),
    "newcomer-essentials": ("How do I register my address{loc}?", "Wie melde ich meinen Wohnsitz{loc} an?"),
    "activities-fun": ("What can I do for fun{loc}?", "Was kann man{loc} in der Freizeit unternehmen?"),
    "restaurants": ("Can you recommend a restaurant{loc}?", "Kannst du{loc} ein Restaurant empfehlen?"),
    "sport": ("Where can I play football{loc}?", "Wo kann ich{loc} Fußball spielen?"),
}
LOC = {  # (en, de)
    "city": (" in {city}", " in {city}"),
    "region": (" in Upper Franconia", " in Oberfranken"),
    "incidental": (" across Oberfranken, including Bamberg", " in Oberfranken, zum Beispiel in Bamberg,"),
    "and": (" in Bamberg and Bayreuth", " in Bamberg und Bayreuth"),
    "or": (" in Bamberg or Bayreuth", " in Bamberg oder Bayreuth"),
    "located": (" in Bamberg in Oberfranken", " in Bamberg in Oberfranken"),
    "only": (" only in Bamberg", " nur in Bamberg"),
}

def questions(slot=None, **fmt):
    out = []
    for family, templates in FAMILIES.items():
        for lang, template in zip(("en", "de"), templates):
            loc = LOC[slot][lang == "de"].format(**fmt) if slot else ""
            out.append(pytest.param(template.format(loc=loc), id=f"{family}-{lang}"))
    return out

def is_city(decision, city, basis):
    return decision == ScopeDecision("city", (city,), basis, "city-specific")

REGIONAL = ScopeDecision("both", BOTH, "explicit-region", "regional-overview")
CLARIFY = ScopeDecision("clarify", (), "ambiguous", None)
CONFLICT = ScopeDecision("unsupported", (), "conflict", None)
MISMATCH = ScopeDecision("unsupported", (), "mismatch", None)

# --- examples from the plan ---------------------------------------------------------------------
@pytest.mark.parametrize("page_city", PAGES)
@pytest.mark.parametrize("message", [
    "What traditions are found across Oberfranken, including Bamberg?",
    "Welche Traditionen gibt es in Oberfranken, zum Beispiel in Bamberg?",
])
def test_explicit_region_is_not_narrowed_by_incidental_city(page_city, message):
    result = resolve_scope(message, page_city, selected_city=None)
    assert result.scope == "both"
    assert result.target_cities == ("bamberg", "bayreuth")
    assert result.answer_mode == "regional-overview"

def test_home_discovery_can_resume_an_alternative_without_loop():
    message = "Restaurants in Bamberg or Bayreuth?"
    assert resolve_scope(message, None, selected_city=None).scope == "clarify"
    selected = resolve_scope(message, None, selected_city="bamberg")
    assert selected.scope == "city"
    assert selected.target_cities == ("bamberg",)

# --- family x language x page matrix ------------------------------------------------------------
@pytest.mark.parametrize("page_city", ["bamberg", "bayreuth"])
@pytest.mark.parametrize("message", questions())
def test_city_page_default_for_every_family(message, page_city):
    assert is_city(resolve_scope(message, page_city), page_city, "page")

@pytest.mark.parametrize("message", questions())
def test_home_orientation_without_geography_clarifies(message):
    assert resolve_scope(message, None) == CLARIFY

@pytest.mark.parametrize("city", ["bamberg", "bayreuth"])
@pytest.mark.parametrize("page_city", PAGES)
def test_explicit_single_city(city, page_city):
    for param in questions("city", city=city.capitalize()):
        result = resolve_scope(param.values[0], page_city)
        if page_city in (None, city):
            assert is_city(result, city, "explicit-city"), param.values[0]
        else:  # opposite page keeps the existing conflict explanation, never a silent switch
            assert result == CONFLICT, param.values[0]

@pytest.mark.parametrize("page_city", PAGES)
@pytest.mark.parametrize("slot", ["region", "incidental"])
def test_explicit_region_wins_over_page_and_incidental_city(slot, page_city):
    for param in questions(slot):
        assert resolve_scope(param.values[0], page_city) == REGIONAL, param.values[0]

@pytest.mark.parametrize("page_city", PAGES)
def test_two_city_and_is_a_regional_overview(page_city):
    for param in questions("and"):
        assert resolve_scope(param.values[0], page_city) == ScopeDecision("both", BOTH, "both-cities", "regional-overview"), param.values[0]

@pytest.mark.parametrize("page_city", PAGES)
def test_two_city_or_alternatives_clarify_on_every_page(page_city):
    for param in questions("or"):
        assert resolve_scope(param.values[0], page_city) == CLARIFY, param.values[0]

@pytest.mark.parametrize("slot,basis", [("located", "explicit-city"), ("only", "restricted-city")])
@pytest.mark.parametrize("page_city", PAGES)
def test_located_or_restricted_city_targets_one_city(slot, basis, page_city):
    for param in questions(slot):
        result = resolve_scope(param.values[0], page_city)
        assert (result == CONFLICT) if page_city == "bayreuth" else is_city(result, "bamberg", basis), param.values[0]

# --- spec wording ---------------------------------------------------------------------------------
@pytest.mark.parametrize("message", ["Tell me about Bamberg in Oberfranken", "Erzähl mir von Bamberg in Oberfranken", "Bamberg, Upper Franconia: what should I see?"])
def test_city_located_in_region_is_that_city(message):
    assert is_city(resolve_scope(message, None), "bamberg", "explicit-city")
    assert is_city(resolve_scope(message, "bamberg"), "bamberg", "explicit-city")
    assert resolve_scope(message, "bayreuth") == CONFLICT

@pytest.mark.parametrize("message", ["Only restaurants in Bamberg", "Nur Restaurants in Bamberg", "Restaurants in Bamberg only",
                                     "Only restaurants in Bamberg, not all of Oberfranken", "Nur Bamberg, nicht ganz Oberfranken: welche Feste gibt es?"])
def test_single_city_restriction_beats_region(message):
    assert is_city(resolve_scope(message, None), "bamberg", "restricted-city")
    assert resolve_scope(message, "bayreuth") == CONFLICT

@pytest.mark.parametrize("message", ["Compare Bamberg and Bayreuth food", "Vergleiche Bamberg und Bayreuth", "Bayreuther Festspiele und Bamberger Dom",
                                     "Restaurants in Bamberg or Bayreuth? Please cover both.", "Bamberg oder Bayreuth: vergleiche beide",
                                     "Where can I study in Oberfranken, Bamberg or Bayreuth?"])
def test_explicit_two_city_coverage_is_both(message):
    for page_city in PAGES:
        assert resolve_scope(message, page_city).scope == "both"
        assert resolve_scope(message, page_city).answer_mode == "regional-overview"

@pytest.mark.parametrize("message", ["Restaurants in Bamberg or Bayreuth?", "Bamberg oder Bayreuth zum Essen?", "Bamberg, Bayreuth: restaurants?"])
def test_unclear_two_city_combinations_clarify(message):
    assert resolve_scope(message, None) == CLARIFY

# --- Home entities and ordinary facts ----------------------------------------------------------
@pytest.mark.parametrize("message,city", [
    ("What is Schlenkerla known for?", "bamberg"), ("Where is the Old Town Hall?", "bamberg"),
    ("Warum steht das Alte Rathaus im Fluss?", "bamberg"), ("Was sind Hörnla?", "bamberg"),
    ("Why are the Baskets notable?", "bamberg"), ("What regional dish is documented for Oskar?", "bayreuth"),
    ("Was bedeutet Oldschdod?", "bayreuth"), ("What kind of art does the Iwalewahaus focus on?", "bayreuth"),
    ("Are the Margravial Opera House and the Festival Theatre the same building?", "bayreuth"),
])
def test_reviewed_unambiguous_entity_infers_its_city_on_home(message, city):
    assert is_city(resolve_scope(message, None), city, "entity")

def test_entity_does_not_override_page_or_explicit_geography():
    assert is_city(resolve_scope("What is Schlenkerla?", "bayreuth"), "bayreuth", "page")
    assert resolve_scope("Is Schlenkerla typical for Oberfranken?", None) == REGIONAL

@pytest.mark.parametrize("message", ["Schlenkerla or Oskar?", "Compare Schlenkerla and Oskar", "Is there a buddy programme?",
                                     "What does the orientation programme cover?"])
def test_ambiguous_or_unreviewed_entities_clarify(message):
    assert resolve_scope(message, None) == CLARIFY

@pytest.mark.parametrize("message", ["What is Rauchbier?", "Was ist fränkisches Schäufele?", "Who was Wilhelmine?", "What is UNESCO?",
                                     "Why does smoked beer taste smoky?"])
def test_home_ordinary_fact_searches_the_pilot_without_city_claims(message):
    assert resolve_scope(message, None) == ScopeDecision("both", BOTH, "pilot-search", "ordinary-fact")

def test_reviewed_entities_reuse_evidence_aliases_and_stay_unambiguous():
    queries = [q for q, _ in ENTITY_ALIASES]
    assert all(q in queries for q, _ in ENTITIES) and len({q for q, _ in ENTITIES}) == len(ENTITIES)
    for name, city in REVIEWED_ENTITIES.items():  # every reviewed name hits only aliases of its own city
        assert {c for q, c in ENTITIES if re.search(q, name, re.I)} == {city}, name
    assert not any(re.search(q, "buddy orientation programme Neues Rathaus Alten Barockrathaus", re.I) for q, _ in ENTITIES)

def test_reviewed_entities_match_one_city_in_the_frozen_release():
    rows = load_records()  # fails, never skips: the reviewed mapping must be checked against the frozen release
    record_patterns = dict(ENTITY_ALIASES)
    for query, city in ENTITIES:
        assert {r["city"] for r in rows if re.search(record_patterns[query], r["title"], re.I)} == {city}, query

# --- confirmed selection -------------------------------------------------------------------------
@pytest.mark.parametrize("selected", ["bamberg", "bayreuth"])
@pytest.mark.parametrize("message,page_city", [("Restaurants in Bamberg or Bayreuth?", None), ("Restaurants in Bamberg or Bayreuth?", "bamberg"),
                                               ("Where can I eat?", None), ("Wie melde ich meinen Wohnsitz an?", None), ("Schlenkerla or Oskar?", None)])
def test_selection_resolves_missing_geography_or_alternatives_once(message, page_city, selected):
    assert resolve_scope(message, page_city).scope == "clarify"
    assert is_city(resolve_scope(message, page_city, selected_city=selected), selected, "confirmed-choice")

@pytest.mark.parametrize("message,page_city,expected", [
    ("Only restaurants in Bamberg", None, "bamberg"), ("Nur Restaurants in Bamberg", None, "bamberg"),
    ("Tell me about Bamberg in Oberfranken", None, "bamberg"), ("Where can I eat?", "bamberg", "bamberg"),
    ("What is Schlenkerla?", None, "bamberg"),
])
def test_matching_selection_keeps_the_explicit_decision(message, page_city, expected):
    assert resolve_scope(message, page_city, selected_city=expected) == resolve_scope(message, page_city)

@pytest.mark.parametrize("message,page_city", [
    ("Only restaurants in Bamberg", None), ("Nur Restaurants in Bamberg", None),        # never overrides a restriction
    ("Restaurants in Bamberg", None), ("Where can I eat?", "bamberg"),                  # explicit or page city
    ("What is Schlenkerla?", None),                                                     # reviewed entity
    ("Compare Bamberg and Bayreuth food", None), ("What can I do for fun in Oberfranken?", "bayreuth"),  # never narrows both
    ("What is Rauchbier?", None),                                                       # nothing to resolve: inapplicable
])
def test_mismatched_or_inapplicable_selection_is_a_fixed_fallback_not_a_new_clarification(message, page_city):
    assert resolve_scope(message, page_city, selected_city="bayreuth") == MISMATCH

def test_selection_does_not_bypass_a_conflict_or_accept_other_cities():
    assert resolve_scope("Restaurants in Bayreuth", "bamberg", selected_city="bayreuth") == CONFLICT
    assert resolve_scope("Where can I eat?", None, selected_city="coburg") == MISMATCH

@pytest.mark.parametrize("selected", ["bamberg", "bayreuth"])
@pytest.mark.parametrize("page_city", PAGES)
def test_a_selection_never_yields_another_clarification(page_city, selected):
    messages = [p.values[0] for slot in (None, "region", "incidental", "and", "or", "located", "only") for p in questions(slot)]
    messages += [p.values[0] for p in questions("city", city="Bayreuth")]
    assert all(resolve_scope(m, page_city, selected_city=selected).scope != "clarify" for m in messages)

# --- preserved normalization and constraints ----------------------------------------------------
def test_typo_alias_still_names_the_city():
    assert is_city(resolve_scope("give me a good restourant in baberg?", None), "bamberg", "explicit-city")
    assert resolve_scope("give me a good restourant in baberg?", "bayreuth") == CONFLICT
    assert is_city(resolve_scope("nur baberg bitte, welche Restaurants?", None), "bamberg", "restricted-city")

@pytest.mark.parametrize("page_city", PAGES)
@pytest.mark.parametrize("message", ["1. Where can I study in Oberfranken?", r"1\. Where can I study in Oberfranken?",
                                     "2) Where can I study in Oberfranken?", "20. Wo kann man in Oberfranken studieren?"])
def test_leading_list_marker_regional_study_is_both(message, page_city):
    assert resolve_scope(message, page_city) == REGIONAL

def test_leading_list_marker_without_region_still_asks_on_home():
    assert resolve_scope("1. Where can I study?", None) == CLARIFY

def test_resolver_only_decides_geography_and_never_rewrites_the_question():
    assert [f.name for f in dataclasses.fields(ScopeDecision)] == ["scope", "target_cities", "basis", "answer_mode"]
    message = "Vegan restaurants under 15 euros in baberg in 2026, ranked?"
    result = resolve_scope(message, None)
    assert is_city(result, "bamberg", "explicit-city") and message not in repr(result)
    with pytest.raises(dataclasses.FrozenInstanceError):
        result.scope = "both"

# --- localized texts ------------------------------------------------------------------------------
@pytest.mark.parametrize("language", ["en", "de"])
def test_clarification_and_fallback_texts(language):
    clarify, mismatch = policy.note("clarify_city", language), policy.note("selection_mismatch", language)
    assert "Bamberg" in clarify and "Bayreuth" in clarify and clarify.rstrip().endswith("?")
    assert "?" not in mismatch and mismatch != clarify and "Bamberg" in mismatch and "Bayreuth" in mismatch
    assert policy.note("choose_city", language)  # retained public key
    partial = policy.partial_coverage_text("bayreuth", "bamberg", language)
    assert partial.index("Bayreuth") < partial.index("Bamberg") and "?" not in partial

def test_texts_are_localized():
    for key in ("clarify_city", "selection_mismatch"):
        assert policy.note(key, "en") != policy.note(key, "de")
    assert policy.partial_coverage_text("bamberg", "bayreuth", "en") != policy.partial_coverage_text("bamberg", "bayreuth", "de")

# --- edge cases ----------------------------------------------------------------------------------
@pytest.mark.parametrize("message", ["How do I bake a chocolate cake?", "What is the meaning of life?", "Explain quantum computing",
                                     "Can I ask something about quantum physics?"])
def test_off_topic_home_question_is_not_turned_into_a_city_question(message):
    # Topic relevance stays with retrieval/evidence gates; asking for a city here would be a pointless loop.
    assert resolve_scope(message, None).basis == "pilot-search"

def test_institution_name_is_not_a_regional_request():
    assert is_city(resolve_scope("Was bietet das Studierendenwerk Oberfranken in Bayreuth?", "bayreuth"), "bayreuth", "explicit-city")
    assert is_city(resolve_scope("Was bietet das Studierendenwerk Oberfranken?", "bamberg"), "bamberg", "page")

@pytest.mark.parametrize("message", ["Oberfranken food in Bamberg?", "Upper Franconia traditions, Bamberg?"])
def test_region_plus_city_without_clear_relation_clarifies(message):
    assert resolve_scope(message, None) == CLARIFY and resolve_scope(message, "bamberg") == CLARIFY
    assert is_city(resolve_scope(message, None, selected_city="bamberg"), "bamberg", "confirmed-choice")

@pytest.mark.parametrize("message", ["Bamberg vs Bayreuth?", "Bamberger Rauchbier und Bayreuther Bratwurst?", "What is the difference between Bamberg and Bayreuth?"])
def test_comparison_wording_is_both(message):
    assert resolve_scope(message, "bayreuth") == ScopeDecision("both", BOTH, "both-cities", "regional-overview")

def test_and_outside_the_city_list_does_not_turn_alternatives_into_both():
    assert resolve_scope("What food and drinks in Bamberg or Bayreuth?", None) == CLARIFY


# --- fix round 1: anchored restriction (I1) -------------------------------------------------------
@pytest.mark.parametrize("page_city", PAGES)
@pytest.mark.parametrize("message", [
    "Which traditions are found not only in Bamberg but across Oberfranken?",
    "Welche Traditionen gibt es nicht nur in Bamberg, sondern in ganz Oberfranken?",
    "I just moved to Oberfranken; which traditions, for example in Bamberg, should I know?",
    "Which traditions are typical in Oberfranken and not just in Bamberg?",
])
def test_not_only_and_free_just_do_not_narrow_a_regional_question(message, page_city):
    assert resolve_scope(message, page_city) == REGIONAL

@pytest.mark.parametrize("message", ["Kann ich allein in Bamberg wandern?", "I just arrived in Bamberg, where can I eat?"])
def test_alone_or_free_just_is_an_ordinary_explicit_city(message):
    assert is_city(resolve_scope(message, None), "bamberg", "explicit-city")
    assert is_city(resolve_scope(message, "bamberg"), "bamberg", "explicit-city")
    assert resolve_scope(message, "bayreuth") == CONFLICT

@pytest.mark.parametrize("page_city", PAGES)
@pytest.mark.parametrize("message", ["Only restaurants in Bamberg", "Nur Restaurants in Bamberg", "Restaurants in Bamberg only",
                                     "Just Bamberg please: which festivals?", "Nur Bamberg, nicht ganz Oberfranken: welche Feste gibt es?"])
def test_anchored_restriction_on_every_page(message, page_city):
    result = resolve_scope(message, page_city)
    assert result == CONFLICT if page_city == "bayreuth" else is_city(result, "bamberg", "restricted-city")

# --- fix round 1: Home shared facts vs orientation (I2) ------------------------------------------
@pytest.mark.parametrize("message", [
    "Is there a Franconian beer tradition?", "Gibt es in Franken eine Biertradition?", "Welche Feste gibt es in Franken?",
    "Are there typical Franconian dishes?", "What local dishes are typical in Franconia?", "What should I know about Franconian dialect?",
    "Was ist fränkisches Essen?", "What do people eat in Franconia?", "Welche lokalen Gerichte sind in Franken typisch?",
    "Was sollte ich über den fränkischen Dialekt wissen?",
])
def test_home_shared_fact_searches_the_pilot(message):
    assert resolve_scope(message, None) == ScopeDecision("both", BOTH, "pilot-search", "ordinary-fact")

@pytest.mark.parametrize("message", [
    "Where can I eat Franconian food?", "Wo kann ich fränkisch essen?", "Which restaurants can I visit?", "Welche Restaurants kann ich besuchen?",
    "What can I do for fun?", "Was kann man in der Freizeit unternehmen?", "Which sights should I visit?", "Welche Sehenswürdigkeiten sollte ich besuchen?",
    "Where can I play football?", "Wo kann ich Fußball spielen?", "Where do I register my address?", "Wo melde ich meinen Wohnsitz an?",
    "Restaurants?", "Fußballvereine?", "Can you recommend a Franconian restaurant?", "Kannst du ein fränkisches Lokal empfehlen?",
    # Decision: "local"/"should I" without any named region is deictic city orientation (spec rule 4) and clarifies.
    "Which local traditions should I know?", "Welche lokalen Traditionen sollte ich kennen?",
])
def test_home_place_recommendation_and_orientation_still_clarify(message):
    assert resolve_scope(message, None) == CLARIFY

def test_distance_between_the_two_cities_clarifies():
    # Two cities without an and/compare cue are treated as an unclear combination (documented limitation).
    assert resolve_scope("How far is Bayreuth from Bamberg?", None) == CLARIFY


# --- repair round (Ali D1): Home constrained discovery questions are city-dependent ----------------
@pytest.mark.parametrize("message", ["Vegan restaurants?", "Restaurants with live music?", "Vegane Restaurants?", "Restaurants mit Livemusik?",
                                     "Pescatarian restaurants?", "Fußballvereine für Frauen?", "Basketball for beginners?", "Fränkische Restaurants?"])
def test_home_constrained_discovery_clarifies(message):
    assert resolve_scope(message, None) == CLARIFY
    assert is_city(resolve_scope(message, None, selected_city="bayreuth"), "bayreuth", "confirmed-choice")

@pytest.mark.parametrize("page_city", ["bamberg", "bayreuth"])
@pytest.mark.parametrize("message", ["Vegan restaurants?", "Vegane Restaurants?"])
def test_constrained_discovery_on_a_city_page_stays_local(message, page_city):
    assert is_city(resolve_scope(message, page_city), page_city, "page")

# --- repair round (Ali D2): a genuine pending choice may differ from the page; an explicit opposite city may not --------
def test_pending_alternative_resolved_to_the_other_city_on_a_city_page():
    assert resolve_scope("Restaurants in Bamberg or Bayreuth?", "bamberg") == CLARIFY
    assert is_city(resolve_scope("Restaurants in Bamberg or Bayreuth?", "bamberg", selected_city="bayreuth"), "bayreuth", "confirmed-choice")

@pytest.mark.parametrize("selected", [None, "bayreuth", "bamberg"])
def test_explicit_opposite_city_is_a_conflict_even_with_a_selection(selected):
    assert resolve_scope("Which restaurants are in Bayreuth?", "bamberg", selected_city=selected) == CONFLICT
