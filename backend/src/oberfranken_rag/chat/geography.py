"""Pure geography decision for the two-city pilot: deterministic word rules, no model, no retrieval.

Runs AFTER the greeting/medical/outside-pilot guards. It reads a normalized copy of the
question only for its decision and never rewrites the question or its constraints.

basis values: page, explicit-city, restricted-city, explicit-region, both-cities, entity,
pilot-search, confirmed-choice, ambiguous (clarify), conflict and mismatch (unsupported).
answer_mode is None for clarify/unsupported: nothing is answered from evidence.
"""
from dataclasses import dataclass
import re
from . import discovery, policy
from .evidence import ENTITY_ALIASES

CITIES = ("bamberg", "bayreuth")

@dataclass(frozen=True)
class ScopeDecision:
    scope: str                 # city | both | clarify | unsupported
    target_cities: tuple = ()  # ("bamberg", "bayreuth") for both, empty for clarify/unsupported
    basis: str = "page"
    answer_mode: str | None = "city-specific"  # city-specific | regional-overview | ordinary-fact

# Reviewed against the frozen v3.2 release: each name's evidence alias matches record titles of one city only.
# Generic programmes (buddy, orientation) and other town halls are deliberately absent.
REVIEWED_ENTITIES = {
    "Altes Rathaus": "bamberg", "Old Town Hall": "bamberg", "Hörnla": "bamberg", "Schlenkerla": "bamberg", "Bamberg Baskets": "bamberg",
    "Oskar": "bayreuth", "SpVgg": "bayreuth", "Oldschdod": "bayreuth", "Festspielhaus": "bayreuth", "Festival Theatre": "bayreuth",
    "Markgräfliches Opernhaus": "bayreuth", "Margravial Opera House": "bayreuth", "Iwalewahaus": "bayreuth",
}
# The existing query patterns are reused, not copied.
ENTITIES = tuple((query, city) for query, _ in ENTITY_ALIASES
                 for city in {c for name, c in REVIEWED_ENTITIES.items() if re.search(query, name, re.I)})

REGION = re.compile(r"\b(?:oberfranken|upper franconia)\b", re.I)
INSTITUTION = re.compile(r"\bstudierendenwerk oberfranken\b", re.I)  # a name, not a regional request
# A restriction must attach to the city ("only restaurants in Bamberg", "just Bamberg", "Bamberg only"); "not only" is inclusive.
NOT_ONLY = re.compile(r"\b(?:not|nicht)\s+(?:only|just|nur)\b", re.I)
ONLY = re.compile(r"\b(?:(?:only|solely|exclusively|nur|ausschließlich)\s+(?:[a-zäöüß]+\s+){0,2}?|just\s+)(?:in\s+)?(?:bamberg|bayreuth)|\b(?:bamberg|bayreuth)\w*\s+only\b", re.I)
LOCATED = re.compile(r"\b(?:bamberg|bayreuth)\s*(?:,|\(|\bin\b|\bim\b)\s*(?:oberfranken|upper franconia)\b", re.I)
EXAMPLE = re.compile(r"\b(?:not only|not just|nicht nur|including|includes?|incl|for example|for instance|e\.g|such as|especially|zum beispiel|z\.\s?b|beispielsweise|etwa|darunter|einschließlich|inklusive|unter anderem|besonders)\b", re.I)
BOTH_CUE = re.compile(r"\b(?:compare\w*|comparison|vergleich\w*|versus|vs|both|beide\w*|each|jeweils|between|zwischen|difference\w*|unterschied\w*)\b", re.I)
AND = re.compile(r"\b(?:and|und|sowie|plus)\b|&", re.I)
OR = re.compile(r"\b(?:or|oder)\b", re.I)
# Bounded vocabulary, no model. Place/recommendation/activity cues need a city on Home. Deictic cues ("local",
# "should I", "here") need one too unless a shared Franconian subject makes it an ordinary fact.
ORIENTATION = re.compile(r"""\b(?:where|wo|wohin|recommend\w*|suggest\w*|empfehl\w*|empfiehl\w*|vorschl\w*|tips?|tipps?
  |visit\w*|besuch\w*|for\s+fun|freizeit|unternehm\w*|things\s+to\s+do|go\s+out|ausgehen
  |play|spielen|join\w*|register\w*|anmeld\w*|melde\w*|nearby|in\s+der\s+nähe)\b""", re.I | re.X)
DEICTIC = re.compile(r"\b(?:local\w*|lokal\w*|should\s+i|sollte\s+ich|soll\s+ich|here|hier)\b", re.I)
SHARED = re.compile(r"\b(?:frankens?|fränk\w*|franconia\w*)\b", re.I)
# Discovery intents whose answer depends on a city. A constrained route ("Vegan restaurants?") is still a city question,
# unless it is a shared Franconian subject without a venue noun ("Was ist fränkisches Essen?").
CITY_INTENTS = frozenset({"restaurant", "campus-food", "football", "basketball", "ice-hockey", "sport"})
VENUE = re.compile(r"\b(?:restaurants?|wirtsh(?:aus|äuser)|lokale?|gaststätten?|mensa|cafeteria|canteen|clubs?|vereine?|\w+vereine?|teams?)\b", re.I)

def _orientation(text):
    route = discovery.interpret(text, None)
    if route and route.query != text: return True  # a canonical bounded discovery route
    constrained = bool(route and route.intent in CITY_INTENTS and (VENUE.search(text) or not SHARED.search(text)))
    return bool(constrained or ORIENTATION.search(text) or (DEICTIC.search(text) and not SHARED.search(text)))

def _decide(text, page_city):
    named = [c for c in CITIES if c in policy.mentioned_cities(text)]
    region = bool(REGION.search(INSTITUTION.sub(" ", text)))
    if len(named) == 2:
        between = re.search(r"(?:bamberg|bayreuth)(.*)(?:bamberg|bayreuth)", text, re.I | re.S).group(1)
        if region or BOTH_CUE.search(text) or (AND.search(between) and not OR.search(between)):
            return ScopeDecision("both", CITIES, "explicit-region" if region else "both-cities", "regional-overview")
        return ScopeDecision("clarify", (), "ambiguous", None)  # alternatives or an unclear list
    if named:
        city = named[0]
        if ONLY.search(NOT_ONLY.sub(" ", text)): basis = "restricted-city"
        elif not region or LOCATED.search(text): basis = "explicit-city"
        elif EXAMPLE.search(text): return ScopeDecision("both", CITIES, "explicit-region", "regional-overview")
        else: return ScopeDecision("clarify", (), "ambiguous", None)  # region + city, relation unclear
        if page_city and page_city != city: return ScopeDecision("unsupported", (), "conflict", None)
        return ScopeDecision("city", (city,), basis)
    if region: return ScopeDecision("both", CITIES, "explicit-region", "regional-overview")
    if page_city: return ScopeDecision("city", (page_city,), "page")
    entity_cities = {c for q, c in ENTITIES if re.search(q, text, re.I)}
    if len(entity_cities) == 1: return ScopeDecision("city", tuple(entity_cities), "entity")
    unreviewed = any(re.search(q, text, re.I) for q, _ in ENTITY_ALIASES)
    if entity_cities or unreviewed or _orientation(text):
        return ScopeDecision("clarify", (), "ambiguous", None)
    return ScopeDecision("both", CITIES, "pilot-search", "ordinary-fact")

def resolve_scope(message, page_city, selected_city=None):
    """A confirmed selection only resolves a clarification, once; it never narrows, overrides or bypasses."""
    decision = _decide(policy.normalize_message(message), page_city)
    if selected_city is None or decision.scope == "unsupported": return decision
    if selected_city in CITIES and decision.scope == "clarify":
        return ScopeDecision("city", (selected_city,), "confirmed-choice")
    if decision.scope == "city" and decision.target_cities == (selected_city,): return decision
    return ScopeDecision("unsupported", (), "mismatch", None)
