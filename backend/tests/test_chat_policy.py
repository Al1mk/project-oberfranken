import pytest
from oberfranken_rag.chat import policy

def test_status_mapping_never_upgrades():
    assert policy.api_status("verified") == "verified"
    assert policy.api_status("limited") == "limited"
    assert policy.api_status("source_backed") == "limited"

def test_unknown_status_is_refused():
    with pytest.raises(ValueError): policy.api_status("official")

@pytest.mark.parametrize("text", ["Hi", "hello!", "Hallo", "Servus", "guten tag", "Hey there"])
def test_greetings(text): assert policy.is_greeting(text)

@pytest.mark.parametrize("text", ["Hello, where is the cathedral?", "Hallo wo ist der Dom", "What is Rauchbier?"])
def test_not_greetings(text): assert not policy.is_greeting(text)

@pytest.mark.parametrize("text", ["Which apartments are available today in Bamberg?", "Ich suche ein WG-Zimmer", "Can you recommend a doctor?", "I need a lawyer", "Welche Jobs gibt es?"])
def test_out_of_scope(text): assert policy.is_out_of_scope(text)

@pytest.mark.parametrize("text", ["What is the Bamberg rental tradition of boats?", "Why is Rauchbier special?", "Tell me about parents' day and current festivals"])
def test_in_scope(text): assert not policy.is_out_of_scope(text)

def test_mentioned_cities():
    assert policy.mentioned_cities("Why is Bamberg special?") == {"bamberg"}
    assert policy.mentioned_cities("Bayreuther Festspiele und Bamberger Dom") == {"bamberg", "bayreuth"}
    assert policy.mentioned_cities("Franconian food") == set()

def test_numbers_must_be_in_the_evidence_shown_to_the_model():
    assert policy.numbers_supported("It opens at 9:30.", ["täglich ab 9:30"])
    assert not policy.numbers_supported("It costs 55 Euro.", ["Aqua Fitness"])
    assert policy.numbers_supported("Founded in 1380.", ["bis 1380"])
    assert policy.numbers_supported("One of 9 titles", ["x"])  # single digits are not checked

def test_numbers_typed_by_the_user_are_not_evidence():
    assert not policy.numbers_supported("You asked about 2026.", ["x"])

@pytest.mark.parametrize("text", ["40 Euro", "Tickets ab 12 €", "täglich 9:30 Uhr", "open until 22:00", "Mo–Fr 09–21", "Montag bis Freitag", "Winter 2026/27", "am 12.10.2026",
                                  "Eintritt frei", "free admission", "geöffnet", "booking required", "Anmeldung nötig", "opens at 9 am", "weekends only", "Termin vereinbaren"])
def test_volatile_looking_text_is_detected(text): assert policy.has_volatile(text)

@pytest.mark.parametrize("text", ["Schlenkerla ist ein historischer Rauchbierausschank in Bamberg.", "The cathedral was consecrated in 1237.", "Das Haus wird seit 1405 urkundlich erwähnt.",
                                  "Smoked beer gets its flavour from malt dried over beech wood.", "Der Dom hat vier Türme."])
def test_plain_historical_and_descriptive_text_is_not_flagged(text): assert not policy.has_volatile(text)

def test_notes_are_localized():
    assert "check" in policy.note("limited", "en").lower()
    assert "prüf" in policy.note("limited", "de").lower()
    assert policy.note("fresh", "en") != policy.note("fresh", "de")
