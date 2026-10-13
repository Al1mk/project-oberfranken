"""Small, pure rules: status mapping, scope checks, city mentions, number check, localized texts."""
import re

# Why a reply became a fallback. Fixed codes only, for the server log: they hold no text. They are NOT part of the API reply.
REASONS = ("model_declined", "missing_citations", "invalid_citation", "volatile_answer", "unsupported_number", "weak_evidence")

def api_status(corpus_status):
    """verified stays verified. limited and source_backed are both reported as limited. Nothing is ever upgraded."""
    if corpus_status == "verified": return "verified"
    if corpus_status in ("limited", "source_backed"): return "limited"
    raise ValueError("unknown record status")

_GREETING = re.compile(r"^(hi|hello|hey|hallo|servus|moin|guten (tag|morgen|abend)|good (morning|afternoon|evening)|grüß gott)( there| everyone| zusammen)?[\s!.,]*$", re.I)
def is_greeting(text): return bool(_GREETING.match(text.strip()))

_LANG_WORDS = {
    'en': set('what whats which where why how who when is are the a an and can should would could i my for it its me you gives does do want please hello explain eat meal football suggest introduction'.split()),
    'de': set('was welche welcher welches wo warum wie wer wann ist sind der die das ein eine und kann können sollte soll ich mein meinen meinem mich du gibt bitte hallo erkläre mir man spielen fußball fußballvereine möchte essen suche lokal'.split()),
}
def reply_language(text, fallback):
    """Small offline EN/DE heuristic, not a general language detector. Ties use UI language."""
    requested = re.search(r'\b(?:answer|reply|respond)\s+(?:in\s+)?(english|german)\b|\b(?:bitte\s+)?auf\s+(englisch|deutsch)\b', text, re.I)
    if requested:
        return 'en' if (requested.group(1) or requested.group(2)).lower() in ('english', 'englisch') else 'de'
    tokens = set(re.findall(r'[a-zäöüß]+', text.lower()))
    en, de = (len(tokens & _LANG_WORDS[lang]) for lang in ('en', 'de'))
    return 'en' if en > de else 'de' if de > en else fallback

_HOUSING = re.compile(r"\b(apartments?|flats?|housing|rent(al)?s?|rooms?|accommodation|wohnung(en)?|wg|wg-zimmer|zimmer|miete|unterkunft)\b", re.I)
_SEARCHING = re.compile(r"\b(available|availability|find|search|looking|cheap|today|now|suche|suchen|verfügbar|frei|heute|günstig)\b", re.I)
_OTHER = re.compile(r"\b(doctors?|physicians?|arzt|ärztin|medical advice|lawyers?|attorneys?|anwalt|rechtsberatung|legal advice|jobs?|stellenangebote?)\b", re.I)
_MEDICAL = re.compile(r"\b(medication|medicine|dosage|diagnos\w*|symptoms?|stomach pain|medikament\w*|bauchschmerz\w*|dosierung|behandlung|schmerz\w*)\b", re.I)
_PERSONAL_VISA = re.compile(r"\b(visas?|visum|aufenthaltstitel)\b", re.I)
_PERSONAL_CASE = re.compile(r"\b(my|me|mine|personal|mein\w*|mich|persönlich\w*)\b", re.I)
def is_out_of_scope(text):
    return bool((_HOUSING.search(text) and _SEARCHING.search(text)) or _OTHER.search(text) or _MEDICAL.search(text)
                or (_PERSONAL_VISA.search(text) and _PERSONAL_CASE.search(text)))

def outside_pilot_city(text):
    # Deliberately bounded geography guard, not a claim to recognise all place names.
    return bool(re.search(r"\b(?:in|at|to|nach|über|about)\s+(?:berlin|hamburg|munich|münchen|coburg|hof|nürnberg|nuremberg|frankfurt)\b", text, re.I))

def asks_live_details(text):
    return bool(re.search(r"\b(?:tickets?|karten|eintritt|öffnungszeit\w*|opening hours|prices?|preis\w*|costs?|kostet|available|availability|verfügbar\w*|today|tonight|heute|morgen|geöffnet|open)\b", text, re.I))

# Anything that looks like an opening time, price, date or availability. Used on (a) evidence before it may reach the model and
# (b) the model's answer before it may reach the user. Deliberately broad: a false positive only means "point to the source instead".
VOLATILE = re.compile(r"""
    €|\bEUR\b|\bEuros?\b|\bUhr\b|\bo'?clock\b|\b\d{1,2}\s?(am|pm)\b
  | \b\d{1,2}[:.]\d{2}\b                               # clock times and dd.mm dates
  | \b\d{1,2}\s?[–—-]\s?\d{1,2}\b                      # ranges such as 09-21
  | \b(19|20)\d{2}\s?/\s?\d{2,4}\b                      # seasons such as 2026/27
  | \b20[2-3]\d\b                                      # current or future years
  | \b(mo|di|mi|do|fr|sa|so)\.?\s?[–—-]\s?(mo|di|mi|do|fr|sa|so)\b
  | \b(montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende)\b
  | \b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|daily|täglich)\b
  | \b(geöffnet|öffnungszeit\w*|geschlossen|eintritt\w*|kostet|kosten\w*|preis\w*|gebühr\w*|kostenlos|gratis|ticket\w*|termin\w*|buchung|anmeld\w*|verfügbar\w*)\b
  | \b(open(s|ing)?|closed?|hours?|prices?|fees?|costs?|free|admission|tickets?|booking|availab\w+|deadline\w*|appointments?)\b
""", re.I | re.X)
def has_volatile(text): return bool(VOLATILE.search(text or ""))

def normalize_message(text):
    """Only reviewed misspellings; never rewrite the original provider question."""
    aliases = {"restourant": "restaurant", "restourants": "restaurants", "baberg": "bamberg", "whee": "where", "hungr": "hungry"}
    return re.sub(r"\b(?:restourants?|baberg|whee|hungr)\b", lambda m: aliases[m.group().lower()], text, flags=re.I)

def mentioned_cities(text):
    text = normalize_message(text)
    found = set()
    if re.search(r"bamberg", text, re.I): found.add("bamberg")
    if re.search(r"bayreuth", text, re.I): found.add("bayreuth")
    return found

def numbers_supported(answer, evidence_texts):
    """Safeguard against invented figures: every number of 2+ digits in the answer must occur in the evidence the model was shown.
    Numbers typed by the user are NOT evidence."""
    known = set(re.findall(r"\d+", " ".join(evidence_texts)))
    return all(n in known for n in re.findall(r"\d{2,}", answer))

TEXTS = {
    "choose_city": {"en": "Please choose Bamberg or Bayreuth so I can look for relevant places in that city.",
                    "de": "Bitte wähle Bamberg oder Bayreuth, damit ich passende Orte in dieser Stadt suchen kann."},
    "other_city": {"en": "This pilot covers Bamberg and Bayreuth, not other cities. I cannot give reliable recommendations for that city.",
                   "de": "Dieser Pilot behandelt Bamberg und Bayreuth, keine anderen Städte. Für diese Stadt kann ich keine verlässlichen Empfehlungen geben."},
    "static_pointer": {"en": "Source pointer: I found a related source, but cannot isolate reliable facts that answer your question. Please check the linked source.",
                       "de": "Quellenhinweis: Ich habe eine verwandte Quelle gefunden, kann daraus aber keine verlässlichen Fakten für deine Frage isolieren. Bitte prüfe die verlinkte Quelle."},
    "limited": {"en": "Some of this information has limited source support, so please check the linked source before relying on it.",
                "de": "Ein Teil dieser Informationen ist nur eingeschränkt belegt, bitte prüfe die verlinkte Quelle, bevor du dich darauf verlässt."},
    "fresh": {"en": "Opening hours, prices, availability and dates can change, so please check the source for current details.",
              "de": "Öffnungszeiten, Preise, Verfügbarkeit und Termine können sich ändern; bitte prüfe aktuelle Angaben in der Quelle."},
    "signpost": {"en": "Source pointer: I found a source on this, but its details (such as opening hours, prices, availability or dates) can change, so I will not summarise them here. Please open the linked source for current information.",
                 "de": "Quellenhinweis: Dazu habe ich eine Quelle gefunden, aber ihre Angaben (etwa Öffnungszeiten, Preise, Verfügbarkeit oder Termine) können sich ändern, deshalb fasse ich sie hier nicht zusammen. Bitte öffne die verlinkte Quelle für aktuelle Informationen."},
    "greeting": {"en": "Hello! Ask me about places to see, food, sport or first steps in Bamberg or Bayreuth.",
                 "de": "Hallo! Frag mich nach Sehenswürdigkeiten, Essen, Sport oder ersten Schritten in Bamberg oder Bayreuth."},
    "out_of_scope": {"en": "Live housing search, medical, legal and job advice are outside the scope of this pilot. Please use the official services of your city or university.",
                     "de": "Live-Wohnungssuche sowie medizinische, rechtliche und Jobberatung liegen außerhalb des Pilotumfangs. Bitte nutze die offiziellen Angebote deiner Stadt oder Universität."},
    "no_evidence": {"en": "I could not find reliable information about that in my sources. Try asking about places to see, food, sport or first steps in Bamberg or Bayreuth.",
                    "de": "Dazu habe ich in meinen Quellen keine verlässlichen Informationen gefunden. Frag zum Beispiel nach Sehenswürdigkeiten, Essen, Sport oder ersten Schritten in Bamberg oder Bayreuth."},
    "unsupported": {"en": "My sources do not support a reliable answer to that question.",
                    "de": "Meine Quellen stützen keine verlässliche Antwort auf diese Frage."},
    "ambiguous": {"en": "Your question mentions more than one city. Please ask about Bamberg or Bayreuth separately.",
                  "de": "Deine Frage nennt mehr als eine Stadt. Bitte frage zu Bamberg oder Bayreuth getrennt."},
    # Only for unresolved geography (kind `clarification`); asked once, never after a confirmed selection.
    "clarify_city": {"en": "This pilot covers Bamberg and Bayreuth. Which city should I look at: Bamberg or Bayreuth?",
                     "de": "Dieser Pilot behandelt Bamberg und Bayreuth. Zu welcher Stadt soll ich suchen: Bamberg oder Bayreuth?"},
    # A confirmed selection that does not fit the question: a fixed answer, not another clarification.
    "selection_mismatch": {"en": "Your city choice does not fit this question, so I did not apply it. Please ask again about Bamberg, Bayreuth or both pilot cities.",
                           "de": "Deine Stadtauswahl passt nicht zu dieser Frage, deshalb habe ich sie nicht angewendet. Bitte frage erneut zu Bamberg, Bayreuth oder beiden Pilotstädten."},
}
def note(name, language): return TEXTS[name][language]
def conflict_text(chosen, language):
    city = chosen.capitalize()
    return {"en": f"You are looking at {city}, but your question names another city. Please switch the city page or ask about {city}.",
            "de": f"Du siehst gerade {city}, deine Frage nennt aber eine andere Stadt. Bitte wechsle die Stadtseite oder frage zu {city}."}[language]
def partial_coverage_text(covered, missing, language):
    """Geography is known, but only one pilot city has suitable sources: name both, invent nothing for the other."""
    covered, missing = covered.capitalize(), missing.capitalize()
    return {"en": f"For this question I found suitable sources for {covered} only, not for {missing}, the other pilot city. Please check the linked sources.",
            "de": f"Zu dieser Frage habe ich passende Quellen nur für {covered} gefunden, nicht für {missing}, die andere Pilotstadt. Bitte prüfe die verlinkten Quellen."}[language]
def split_pointer_text(covered, language):
    """Both pilot cities have usable sources, but safe static facts could be isolated for one city only: point to both."""
    covered = covered.capitalize()
    return {"en": f"Source pointer: I found sources for both pilot cities, Bamberg and Bayreuth, but could isolate reliable facts only for {covered}. Please check the linked sources.",
            "de": f"Quellenhinweis: Ich habe Quellen für beide Pilotstädte, Bamberg und Bayreuth, gefunden, konnte verlässliche Fakten aber nur für {covered} isolieren. Bitte prüfe die verlinkten Quellen."}[language]
