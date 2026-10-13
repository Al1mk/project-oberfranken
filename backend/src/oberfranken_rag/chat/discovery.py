"""Small, bounded discovery routes, never semantic evidence by themselves.

A route replaces ONE retrieval query. Audited ids and city/type constraints
decide eligibility before distances are evaluated; a neighbour is not support.
"""
from dataclasses import dataclass
import re
from . import policy
from .evidence import ENTITY_ALIASES

@dataclass(frozen=True)
class Route:
    intent: str
    query: str
    study_city: str | None = None

QUERIES = {
    "restaurant": "Restaurant Wirtshaus Brauereigaststätte Essen",
    "campus-food": "Studierendenwerk Mensa Frischraum Coffee Bars Essen",
    "football": "Fußballverein Fußball FC DJK SpVgg",
    "basketball": "Basketball Verein Baskets BBC",
    "ice-hockey": "Eishockey Verein EHC Tigers",
    "sport": "Sportvereine Fußball Basketball Eishockey",
    "overview": "Stadt Geschichte Kultur UNESCO Wilhelmine Altstadt",
}
IDS = {
    "restaurant": frozenset({"BA-REST-01", "BA-REST-02", "BA-REST-03", "BY-REST-01", "BY-REST-02"}),
    "campus-food": frozenset({"BT-ACT-CAMPUS-FOOD"}),
    "football": frozenset({"BA-SPORT-02", "BA-SPORT-03", "BY-SPORT-01"}),
    "basketball": frozenset({"BA-SPORT-01", "BY-SPORT-02"}),
    "ice-hockey": frozenset({"BY-SPORT-03"}),
    "overview": frozenset({"BA-HIST-02", "BA-RESEARCH-002", "BY-HIST-03", "BY-SIGHT-01", "BY-TRAD-01"}),
}
IDS["sport"] = IDS["football"] | IDS["basketball"] | IDS["ice-hockey"]
FOOD = re.compile(r"\b(?:restaurants?|restourants?|wirtshaus|lokal|essen|eat|eating|meal|dining|dinner|hungry|mensa|cafeteria|canteen|coffee bars?)\b", re.I)
CAMPUS = re.compile(r"\b(?:students?|studierende\w*|studentisch\w*|campus|mensa|cafeteria|canteen|studierendenwerk)\b", re.I)
# Conservative acceptance, not a denylist or general named-entity recognizer:
# only a bounded unconstrained question vocabulary may lose its surface form.
# Every unknown qualifier retains the ORIGINAL query and fails eligible().
COMMON_WORDS = frozenset("""
a an any are as at about and around can could do does for from get give good
how i im m in is it me my of on or please some suggest suggestions suggestion
recommend recommended recommendations tell the there to want what whats when
where which with would you your documented describe introduction short
answer reply respond english german
was welche welcher welches wo wie wer wann ist sind der die das ein eine
einen einem und kann kannst können könnte sollte soll ich im am als mein
mir mich du man gibt es bitte auf deutsch englisch gib kurze kurz nennen
empfehlen empfiehl vorschlagen möchte suche zum hingehen
bamberg bayreuth
open opened opening hours price prices cost costs available availability
current currently today tonight tomorrow tickets
öffnungszeiten öffnungszeit geöffnet haben heute morgen preise preis
kosten kostet verfügbar karten
""".split())
FOOD_WORDS = frozenset("""
restaurant restaurants wirtshaus lokal essen eat eating meal meals dining
dinner hungry places place grab food student students studierende studierenden
studentische campus mensa cafeteria canteen studierendenwerk coffee bar bars
""".split())
SPORT_WORDS = frozenset("""
sport sports sportvereine sportverein sportarten club clubs verein vereine
exist exists involved join joining participate participation training play
playing spielen offer offers
""".split())
INTENT_WORDS = {
    "restaurant": FOOD_WORDS,
    "campus-food": FOOD_WORDS,
    "football": SPORT_WORDS | frozenset("football soccer fußball fussball fußballvereine fussballvereine".split()),
    "basketball": SPORT_WORDS | frozenset({"basketball"}),
    "ice-hockey": SPORT_WORDS | frozenset({"ice", "hockey", "eishockey"}),
    "sport": SPORT_WORDS,
}
SPORTS = (
    ("football", re.compile(r"\b(?:football|soccer|fußball\w*|fussball\w*)\b", re.I)),
    ("basketball", re.compile(r"\bbasketball\w*\b", re.I)),
    ("ice-hockey", re.compile(r"\b(?:ice hockey|eishockey\w*)\b", re.I)),
)
UNKNOWN_SPORT = re.compile(r"\b(?:cricket|rugby|tennis|badminton|volleyball|swimming|schwimmen|handball|golf|hockey)\b", re.I)
FACTUAL_FOOD = re.compile(r"\b(?:rauchbier|hörnla|hoernla|schäufele|schaeufele|bratwurst\w*|sausage|bier|beer|specialit\w*|spezialit\w*|traditionalle)\b", re.I)

STUDY_IDS = frozenset({'BA-NEW-UNIVERSITY','BY-NEW-UNIVERSITY'})
STUDY_WORDS = COMMON_WORDS | frozenset('study studying studies university universities higher education institutions college colleges studieren studium universität universitäten hochschule hochschulen oberfranken upper franconia'.split())

def is_study_overview(message):
    return bool(re.search(r'\b(?:wo|where)\b.*\b(?:studieren|study|studying)\b|\b(?:which|what|welche)\b.*\b(?:universities|hochschulen|universitäten)\b',message,re.I))

def study_query(city):
    return f'{city} Universität Studium studieren Studienort' if city else 'Universität Bamberg Universität Bayreuth Studium studieren Hochschulen'

def bounded_study(message):
    normalized=policy.normalize_message(message)
    # A copied ordered-list marker is presentation, not a study constraint.
    # Ignore one leading marker only; preserve all other digits/unknown words
    # and keep the original message in the provider prompt and scope guards.
    normalized=re.sub(r'^\s*[0-9]{1,3}(?:\\?\.|\))\s+','',normalized,count=1)
    return not re.search(r"[^a-zäöüß\s'’?!.,:;–—-]",normalized,re.I) and set(re.findall(r'[a-zäöüß]+',normalized.lower())) <= STUDY_WORDS

def interpret(message, city):
    """Recognize a discovery intent without erasing named or dietary constraints."""
    normalized = policy.normalize_message(message)
    if is_study_overview(normalized):
        # Unknown subjects/constraints are not replaced by a generic overview.
        return Route('study',study_query(city) if bounded_study(normalized) else message,city)
    # Existing factual entity gates always have priority, including named clubs.
    if any(re.search(pattern, normalized, re.I) for pattern, _ in ENTITY_ALIASES):
        return None
    if re.search(r"\b(?:buedg|english drama|englisch\w*.*(?:theater|drama)|history|histor\w*)\b", normalized, re.I):
        return None
    if FACTUAL_FOOD.search(normalized):
        return None
    overview = re.fullmatch(
        r"\s*(?:(?:was ist|what is|what'?s|tell me about|give me (?:a )?short introduction to)\s+(?:bamberg|bayreuth))[?.! ]*"
        r"(?:(?:give me (?:a )?short introduction|gib mir eine kurze einführung)[?.! ]*)?",
        normalized, re.I,
    )
    if overview:
        intent = "overview"
    elif FOOD.search(normalized):
        intent = "campus-food" if CAMPUS.search(normalized) else "restaurant"
    else:
        sport = next((name for name, pattern in SPORTS if pattern.search(normalized)), None)
        # A mixed supported+unsupported request must not hide the missing sport.
        remaining_sports = re.sub(r"\bice hockey\b", "", normalized, flags=re.I)
        if UNKNOWN_SPORT.search(remaining_sports):
            return Route("unsupported-sport", message)
        if sport:
            intent = sport
        elif re.search(r"\b(?:sports?|sportvereine|sportarten)\b", normalized, re.I):
            intent = "sport"
        else:
            return None
    if intent in INTENT_WORDS:
        tokens = set(re.findall(r"[a-zäöüß]+", normalized.lower()))
        # Tokenization must not silently drop amounts, currencies or other
        # symbolic constraints. Only question punctuation is disposable.
        if re.search(r"[^a-zäöüß\s'’?!.,:;–—-]", normalized, re.I) or not tokens <= COMMON_WORDS | INTENT_WORDS[intent]:
            return Route(intent, message)  # no unknown venue/diet/sport substitution
    query_intent = "restaurant" if intent == "campus-food" and city == "bamberg" else intent
    return Route(intent, f"{city or ''} {QUERIES[query_intent]}".strip())

def eligible(route, rec):
    """Only reviewed identities in the route's city/type may compete on distance."""
    if route.intent=='study':
        return (route.query==study_query(route.study_city) and rec['id'] in STUDY_IDS
                and rec.get('topic')=='newcomer-essentials'
                and (route.study_city is None or rec.get('city')==route.study_city))
    city = route.query.split(" ", 1)[0]
    if city not in ("bamberg", "bayreuth") or rec.get("city") != city:
        return False
    intent = "restaurant" if route.intent == "campus-food" and city == "bamberg" else route.intent
    # A constrained route retains the original question instead of a canonical
    # query. It cannot unlock generic evidence, even if a neighbour is close.
    if route.query != f"{city} {QUERIES.get(intent, '')}":
        return False
    if rec["id"] not in IDS.get(intent, ()):
        return False
    if intent == "restaurant":
        return rec.get("record_type") == "restaurant"
    return True
