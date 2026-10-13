"""Two-city regional overviews: one retrieval per pilot city under the request deadline, per-city gates, balanced evidence.

Type/entity/relevance/provenance gates run BEFORE distance. The unchanged cutoffs (best, other, close-to-best) apply
within each city and, separately, within the shared Oberfranken rows, so no hit can suppress another scope. Shared
rows are regional background: they never count as evidence of a particular city's offerings.
"""
import re
from . import discovery, policy
from .evidence import DISCOVERY_EXCERPTS, discovery_citation, on_topic, question_families, relevant_records
from .geography import AND, BOTH_CUE, CITIES, EXAMPLE, REGION

SHARED = "oberfranken"
MAX_EVIDENCE, PER_CITY, MAX_POINTERS = 5, 2, 3
# Reviewed geography syntax only; the resolver's own patterns are reused, not copied.
REGION_PHRASE = re.compile(r"\b(?:(?:in|across|throughout|im)\s+(?:ganz\s+)?)?" + REGION.pattern, re.I)
CITY_NAME = re.compile(r"\b(?:bamberg|bayreuth)\w*", re.I)
REGION_WORD = re.compile(r"(?<!studierendenwerk )" + REGION.pattern, re.I)  # an institution name is not geography

def discovery_text(message):
    """Copy for finite intent matching only: region, both/compare, example cues, and/und between the two city names and the
    city names go. Every other word, number or symbol stays, so an unknown constraint still fails closed in discovery."""
    text = policy.normalize_message(message)
    names = list(CITY_NAME.finditer(text))
    if len(names) > 1:
        start, end = names[0].end(), names[-1].start()
        text = text[:start] + AND.sub(" ", text[start:end]) + text[end:]
    for pattern in (REGION_PHRASE, BOTH_CUE, EXAMPLE, CITY_NAME):
        text = pattern.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()

def city_query(message, city):
    """Retrieval-only city context (never the prompt): the reviewed region word becomes the city, else the city is appended
    unless the question already names it. Every other word, number and constraint stays."""
    text = REGION_WORD.sub(city.capitalize(), message)
    return text if re.search(city, text, re.I) else f"{text} {city.capitalize()}"

def _owned(service, rec, route):
    """Usable provenance: the source card's URL is one of the record's own HTTP(S) URLs. Checked before distance."""
    urls = rec.get("source_urls") or []
    if not any(isinstance(u, str) and u.startswith(("https://", "http://")) for u in urls): return False
    url = service._source(rec, "en", discovery=bool(route))["sourceUrl"]
    return url in urls and url.startswith(("https://", "http://"))

def _accept(rows, distances, service):
    """The existing cutoffs on already gated rows: best <= top, every row <= item and within close-to-best."""
    rows = sorted((r for r in rows if distances[r["id"]] <= service.item_distance), key=lambda r: distances[r["id"]])
    if not rows or distances[rows[0]["id"]] > service.top_distance: return []
    best = distances[rows[0]["id"]]
    return [r for r in rows if distances[r["id"]] <= best + service.close_distance]

def gather(service, message, deadline):
    """Searches each pilot city once (shared encoder lock via retrieve_fn). Returns (route, {city: rows}, shared rows, distances)."""
    canonical, families = discovery_text(message), question_families(message)
    accepted, shared, distance, route = {}, {}, {}, None
    for city in CITIES:
        route = discovery.interpret(canonical, city)
        query = route.query if route and route.query != canonical else city_query(message, city)  # constrained: original wording + city
        found = service.retrieve(query, city, deadline)
        service._check(deadline)  # never start the next search or a paid call after the deadline
        distances = {r.id: r.distance for r in found}
        distance.update((r.id, min(r.distance, distance.get(r.id, float("inf")))) for r in found)
        rows = [service.records[r.id] for r in found if r.id in service.records and service.records[r.id]["city"] in (city, SHARED)]
        if route:
            rows = [r for r in rows if discovery.eligible(route, r) and (r["id"] not in DISCOVERY_EXCERPTS or discovery_citation(r) is not None)]
        text = lambda r: service._evidence_text(r, discovery=bool(route) and route.intent != "study") or r.get("content", "")
        rows = [r for r in relevant_records(message, rows) if on_topic(families, r, text(r)) and _owned(service, r, route)]
        accepted[city] = _accept([r for r in rows if r["city"] == city], distances, service)
        shared.update((r["id"], r) for r in rows if r["city"] == SHARED)  # deduplicated by parent id across both searches
    return route, accepted, _accept(list(shared.values()), distance, service), distance

def answer(service, message, language, ui_language, deadline):
    """Generated only with safe city-specific evidence for BOTH cities; otherwise free pointers or a named partial coverage."""
    route, accepted, shared, distance = gather(service, message, deadline)
    texts = {r["id"]: service._evidence_text(r, discovery=bool(route) and route.intent != "study") for r in [*accepted["bamberg"], *accepted["bayreuth"], *shared]}
    picked = {city: [r for r in accepted[city] if texts[r["id"]] is not None][:PER_CITY] for city in CITIES}
    live = policy.asks_live_details(message)
    if not live and all(picked.values()):
        chosen = picked["bamberg"] + picked["bayreuth"]
        chosen += [r for r in shared if texts[r["id"]] is not None][:MAX_EVIDENCE - len(chosen)]
        return service._generate(message, None, [(r, texts[r["id"]]) for r in chosen], language, ui_language, route, deadline, cover=CITIES)
    # No generation: every gated row with owned provenance may point to its source, also without safe static text.
    # Both cities with a usable source keep pointers for both; partial coverage only when one city has no usable source.
    covered = [city for city in CITIES if accepted[city]]
    safe = [city for city in CITIES if picked[city]]
    source = lambda rows: [service._source(r, ui_language, discovery=bool(route)) for r in rows]
    if len(covered) == 2:
        first = [(picked[city] or accepted[city])[0] for city in CITIES]  # at least one per city, at most three
        rest = sorted([r for city in CITIES for r in accepted[city] if r not in first] + shared, key=lambda r: distance[r["id"]])
        text = policy.note("signpost", language) if live else policy.split_pointer_text(safe[0], language) if len(safe) == 1 else policy.note("static_pointer", language)
        return service._reply("answer", text, source((first + rest)[:MAX_POINTERS]))
    if covered:
        city = covered[0]
        return service._reply("answer", policy.partial_coverage_text(city, CITIES[1 - CITIES.index(city)], language), source(accepted[city][:MAX_POINTERS]))
    return service._reply("fallback", policy.note("no_evidence", language), reason="weak_evidence")
