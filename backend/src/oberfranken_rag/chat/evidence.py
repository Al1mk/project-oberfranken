"""Audited static excerpts and a small, transparent relevance gate.

Excerpts must occur verbatim in the frozen parent. No inference from a changing
record, no automatic sentence stripping, no modification/re-embedding of the KB.
Only reviewed facts may bypass the whole-record temporal gate.
"""
import re
from . import policy

STATIC_EXCERPTS = {
    'BA-SIGHT-02': [
        'Das Alte Rathaus fällt durch seine Lage auf einer Insel im Fluss und durch seine bemalten Fassaden auf.',
        'Das Alte Rathaus steht in der Regnitz und ist über Brücken erschlossen.',
        'Die Fassadenmalerei erzeugt räumliche Illusionen; ein plastisch herausragendes Puttenbein verstärkt den Effekt.',
    ],
    "BA-FOOD-01": [
        "„Bamberger Hörnla“ kann zwei verschiedene lokale Spezialitäten bezeichnen: eine längliche Kartoffelsorte und ein hörnchenförmiges Gebäck.",
        "Die Kartoffel ist mit der Bamberger Gärtnertradition verbunden; das Gebäck gehört zur örtlichen Backkultur.",
        "Das Gebäck ist dagegen ein blättriges Butterhörnchen, ähnlich einem Croissant, und wird häufig zum Kaffee gegessen.",
    ],
    "BA-REST-01": [
        "Schlenkerla ist als historischer Rauchbierausschank in der Bamberger Altstadt dokumentiert.",
        "Die historische Schlenkerla-Gaststätte liegt am Fuß des Dombergs.",
        "Das Rauchmalz wird in eigener Mälzerei über einem Holzfeuer hergestellt.",
    ],
    "BA-SPORT-01": [
        "Die Bamberg Baskets stehen für die lange Profibasketballgeschichte der Stadt.",
        "Die Vereinschronik dokumentiert neun deutsche Meisterschaften und sechs Pokalsiege; damit ist ihre lokale Bedeutung objektiv belegbar, ohne sie als „bestes“ Team zu bezeichnen.",
    ],
    "BY-SPORT-01": [
        "Die SpVgg Bayreuth, lokal „Oldschdod“ genannt, ist ein historisch bedeutender Fußballverein der Stadt.",
        "Ihre Vereinschronik dokumentiert frühere Spielzeiten in der 2. Bundesliga;",
    ],
    "BY-SIGHT-01": [
        "Das Markgräfliche Opernhaus ist ein eigenständiges Bayreuther UNESCO-Welterbe und wurde nach Angabe der Deutschen UNESCO-Kommission 1746 bis 1750 erbaut.",
        "Besonders wichtig ist sein weitgehend erhaltener barocker Zuschauerraum: Er vermittelt die höfische Theaterkultur des 18. Jahrhunderts.",
        "Die Aufnahme in die Welterbeliste erfolgte 2012.",
        "Wer Bayreuth mit Wagner verbindet, sollte die Bauwerke unterscheiden: Dieses Opernhaus entstand lange vor den Festspielen; Wagners Festspielhaus steht auf dem Grünen Hügel.",
    ],
    "BY-SIGHT-02": [
        "Das Festspielhaus auf dem Grünen Hügel ist der Spielort der Bayreuther Festspiele und wurde für die Aufführung von Richard Wagners Werken geschaffen.",
        "Es darf nicht mit dem älteren Markgräflichen Opernhaus in der Innenstadt verwechselt werden.",
        "1872 wurde der Grundstein gelegt; 1876 eröffneten die ersten Festspiele mit dem Ring des Nibelungen.",
        "Der steil ansteigende Zuschauerraum und der verdeckte Orchestergraben gehören zur besonderen Klangwirkung; das Orchester sitzt unter beziehungsweise hinter der Bühnenfront.",
    ],
    "BY-TRAD-01": [
        "Die Bayreuther Festspiele sind seit 1876 mit Aufführungen von Richard Wagners Werken auf dem Grünen Hügel verbunden.",
        "Wagner ließ das Festspielhaus für seine Bühnenwerke errichten; der Ort und das Programm sind daher enger an einen Komponisten gebunden als bei einem allgemeinen Opernfestival.",
        "Sie ist zugleich vom UNESCO-Welterbe Markgräfliches Opernhaus zu unterscheiden: Das Festspielhaus ist ein anderer Bau.",
    ],
    "BY-REST-01": [
        "Die eigene Speisenseite nennt Bayreuther Bratwürste als „3 vom Grill“.",
    ],
    "BA-RESEARCH-011": [
        "Bambergs Lage an der Regnitz begründet seine Fischtradition.",
    ],
    "BA-RESEARCH-012": [
        "Bamberg liegt kulturell zwischen Bier- und Weinregion.",
        "Häcker ist die fränkische Bezeichnung für Weinbauern.",
        "Bereits vor mehr als einem Jahrtausend gab es Weinbauflächen im Bamberger Talkessel; am südlichen Michaelsberghang ist Weinbau im 12. Jahrhundert belegt.",
        "Weitere historische Lagen waren Abtsberg und St. Getreu.",
    ],
}

# This tourism page supports all three reviewed historical Schlenkerla facts.
# The catalog menu remains useful for current details, not for this excerpt.
REVIEWED_CITATIONS = {
    'BA-SIGHT-02': ('https://www.bamberg.info/poi/altes_rathaus-4656','Bamberg Tourismus'),
    "BA-REST-01": ("https://en.bamberg.info/gastronomie/rauchbierbrauerei_schlenkerla-259", "Bamberg Tourismus"),
    "BY-REST-01": ("https://oskar-bayreuth.de/speisen-getranke", "Oskar – Das Wirtshaus am Markt"),
}

# Discovery uses separately audited verbatim snapshots and URL-specific
# provenance. It never upgrades parent status or changes/re-embeds the corpus.
DISCOVERY_EXCERPTS = {
    "BA-REST-01": (tuple(STATIC_EXCERPTS["BA-REST-01"]), *REVIEWED_CITATIONS["BA-REST-01"]),
    "BA-REST-02": (("Mahrs Bräu verbindet eine Bamberger Brauerei mit einem Wirtshaus im Stadtteil Wunderburg.",),
                   "https://en.bamberg.info/gastronomie/mahrs_braeu-258", "Bamberg Tourismus"),
    "BA-REST-03": (("Fässla ist eine Bamberger Brauereigaststätte, die im Verzeichnis von Bamberg Tourismus aufgeführt wird und auf ihrer eigenen Gaststättenseite weiter aktiv informiert.",),
                   "https://en.bamberg.info/gastronomie/brauerei_faessla-1465", "Bamberg Tourismus"),
    "BY-REST-01": (("Oskar – Das Wirtshaus am Markt wird von Bayreuth Tourismus als Restaurant in zentraler Lage vorgestellt.",),
                   "https://www.bayreuth-tourismus.de/restaurants/oskar-das-wirtshaus-am-markt", "Bayreuth Tourismus"),
    "BY-REST-02": (("Das Restaurant Eule ist eine bei Bayreuth Tourismus aufgeführte Adresse für fränkische Küche",),
                   "https://www.bayreuth-tourismus.de/restaurants/restaurant-eule", "Bayreuth Tourismus"),
    "BA-SPORT-01": (tuple(STATIC_EXCERPTS["BA-SPORT-01"]), "https://bamberg.basketball/club", "Bamberg Baskets"),
    "BA-SPORT-02": (("Der FC Eintracht Bamberg ist ein aktiver Fußballverein der Stadt.",),
                    "https://www.bfv.de/mannschaften/fc-eintracht-bamberg-1/01ABSVJN6G000000VV0AG811VV70TPHT", "Bayerischer Fußball-Verband"),
    "BA-SPORT-03": (("Die DJK Don Bosco Bamberg ist ein Bamberger Fußballverein mit Herren- und Nachwuchsarbeit.",),
                    "https://djk-don-bosco-bamberg.de/mannschaften/herren/1-mannschaft", "DJK Don Bosco Bamberg"),
    "BY-SPORT-01": (tuple(STATIC_EXCERPTS["BY-SPORT-01"]), "https://spvgg-bayreuth.de/club/historie", "SpVgg Bayreuth"),
    "BY-SPORT-03": (("Der EHC Bayreuth Tigers gehört zur Eishockeyszene der Stadt.",),
                    "https://www.ehc-bayreuth.de/senioren.php", "EHC Bayreuth"),
    "BT-ACT-CAMPUS-FOOD": ((
        "Das Studierendenwerk Oberfranken betreibt die gastronomischen Angebote des Campus.",
        "Die Mensa bietet Hauptgerichte, Beilagen, Desserts und vegetarische Optionen.",
        "Coffee Bars bieten Frühstück, kleine Gerichte, Kaffee und Kuchen.",
    ), "https://www.uni-bayreuth.de/en/cafeteria", "Universität Bayreuth"),
    "BA-HIST-02": ((
        "Die „Altstadt von Bamberg“ steht seit 1993 auf der UNESCO-Welterbeliste.",
        "Entscheidend ist nicht ein einzelnes Gebäude, sondern das erhaltene historische Stadtgefüge mit Bergstadt, Inselstadt und Gärtnerstadt.",
        "Die UNESCO hebt die mittelalterliche Struktur und die Wirkung Bambergs als historisches Stadtmodell hervor.",
    ), "https://whc.unesco.org/en/list/624", "UNESCO World Heritage Centre"),
    "BA-RESEARCH-002": ((
        "Bamberg wird wegen seiner sieben Hügel mit Rom verglichen.",
        "Das historische Gesamtbild vereint Kirchen, Klöster, Bürgerhäuser und innerstädtische Gartenflächen.",
        "Neben dieser Gartenbautradition steht die Braukultur mit Rauchbier, Brauereien und Bierkellern.",
    ), "https://www.visitbamberg.com/domstadt-gaertnerstadt-bierstadt-bamberg", "Visit Bamberg"),
    "BY-HIST-03": ((
        "Markgräfin Wilhelmine prägte Bayreuth im 18. Jahrhundert als Förderin von Kunst, Architektur und höfischer Kultur.",
        "In ihrer Zeit entstanden oder entwickelten sich Orte, die heute zu den wichtigsten Sehenswürdigkeiten zählen, darunter das Markgräfliche Opernhaus und die Eremitage.",
    ), "https://www.bayreuth-tourismus.de/en/places-of-interest/stage-set-for-margravine-wilhelmine/margravine-wilhelmine", "Bayreuth Tourismus"),
    "BY-SIGHT-01": (tuple(STATIC_EXCERPTS["BY-SIGHT-01"]), "https://www.unesco.de/staette/markgraefliches-opernhaus-bayreuth", "Deutsche UNESCO-Kommission"),
    "BY-TRAD-01": (tuple(STATIC_EXCERPTS["BY-TRAD-01"]), "https://www.bayreuth-tourismus.de/en/the-bayreuth-festival", "Bayreuth Tourismus"),
}

def discovery_excerpt(rec):
    projection = DISCOVERY_EXCERPTS.get(rec["id"])
    if not projection:
        return None
    parts, url, _ = projection
    original = "\n".join(rec.get(k, "") for k in ("content", "enrichment"))
    if url not in rec["source_urls"] or any(part not in original or policy.has_volatile(part) for part in parts):
        return None
    return "\n".join(parts)

def discovery_citation(rec):
    projection = DISCOVERY_EXCERPTS.get(rec["id"])
    if projection and discovery_excerpt(rec) is not None:
        return projection[1:]
    return None

def reviewed_citation(rec):
    citation = REVIEWED_CITATIONS.get(rec["id"])
    if citation and citation[0] in rec["source_urls"] and reviewed_excerpt(rec) is not None:
        return citation
    return None

def reviewed_excerpt(rec):
    citation = REVIEWED_CITATIONS.get(rec["id"])
    if citation and citation[0] not in rec["source_urls"]:
        return None  # do not generate historical facts without their audited provenance
    excerpts = STATIC_EXCERPTS.get(rec["id"])
    if not excerpts:
        return None
    original = "\n".join(rec.get(k, "") for k in ("content", "enrichment"))
    # Fail closed on a changed parent or any volatile-looking curated passage.
    if any(part not in original or policy.has_volatile(part) for part in excerpts):
        return None
    return "\n".join(excerpts)

# Entity aliases translate query names, not answers. The gate runs BEFORE both
# provider calls and local signposts. An embedding neighbour is not entailment.
ENTITY_ALIASES = (
    (r'\b(?:alt(?:e|en|es|em)\s+rathaus(?:es)?|old town hall)\b',r'\baltes rathaus\b'),
    (r"\b(?:hörnla|hoernla)\b", r"\bhörnla\b"),
    (r"\bschlenkerla\b", r"\bschlenkerla\b"),
    (r"\boskar\b", r"\boskar\b"),
    (r"\b(?:bamberg\s+baskets|baskets)\b", r"\bbaskets\b"),
    (r"\b(?:oldschdod|spvgg)\b", r"\b(?:oldschdod|spvgg)\b"),
    (r"\b(?:festspielhaus|festival theatre|festival theater)\b", r"\b(?:festspielhaus|festival theatre|festival theater)\b"),
    (r"\b(?:markgräfliches opernhaus|margravial opera house)\b", r"\b(?:markgräflich\w* opernhaus|margravial opera house)\b"),
    (r"\biwalewahaus\b", r"\biwalewahaus\b"),
    (r"\bbuddy\b", r"\bbuddy\b"),
    (r"\b(?:orientation programme|orientation program|orientierungsprogramm)\b", r"\b(?:orientierung|orientation)\w*\b"),
)

def relevant_records(message, records):
    anchors = [record_pattern for query_pattern, record_pattern in ENTITY_ALIASES if re.search(query_pattern, message, re.I)]
    theatre_english = bool(re.search(r"(english|englisch).*?(theatre|theater|drama)|(theatre|theater|drama).*?(english|englisch)", message, re.I))
    university_overview = bool(re.search(r"\bwo\b.*\bstudieren\b|\bwhere\b.*\b(?:study|studying)\b|\bwhich\b.*\buniversities\b", message, re.I))
    output = []
    for rec in records:
        title = rec["title"]
        identity = title + "\n" + rec.get("content", "")
        # A comparison can require multiple entities; retain evidence for either.
        if anchors and not any(re.search(a, title, re.I) for a in anchors):
            continue
        if theatre_english and not re.search(r"english drama|\bbuedg\b|spielt auf englisch", identity, re.I):
            continue
        if university_overview and not (rec["topic"] == "newcomer-essentials" and re.search(r"universität|university|hochschule", title, re.I)
                                       and not re.search(r"wohn|housing|versicherung|it-hilfe|behörden", title, re.I)):
            continue
        output.append(rec)
    return output
