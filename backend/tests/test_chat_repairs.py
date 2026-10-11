"""Regressions from Ali's manual transcript. Provider is offline; real policy/service/data."""
import pytest
from chat_fakes import FakeProvider, FakeRetriever, contract_ok, model_json, real_records, record, result
from oberfranken_rag.chat.service import ChatService

def service_for(rows, provider=None):
    provider = provider or FakeProvider()
    retriever = FakeRetriever([result(r, .12 + i * .002, i + 1) for i, r in enumerate(rows)])
    return ChatService({r['id']: r for r in rows}, retriever, provider, {}), retriever, provider

@pytest.mark.parametrize('question,ui_language,expected', [
    ('What is Rauchbier, and what gives it its smoky taste?', 'de', 'English'),
    ('Welche regionale Tradition sollte ich in Bamberg kennen?', 'en', 'German'),
    ('Was ist Rauchbier?', 'en', 'German'),
    ('Rauchbier?', 'de', 'German'),
    ('Rauchbier?', 'en', 'English'),
    ('Please answer in English: Was ist Rauchbier?', 'de', 'English'),
    ('Bitte auf Deutsch: What is Rauchbier?', 'en', 'German'),
    ('Explain Rauchbier.', 'de', 'English'),
    ('Erkläre mir Rauchbier.', 'en', 'German'),
])
def test_question_language_overrides_ui_language(question, ui_language, expected):
    service, _, provider = service_for([record()])
    service.answer(question, 'bamberg', ui_language)
    assert expected in provider.calls[0][0]

@pytest.mark.parametrize('question', [
    'Welches Medikament soll ich gegen starke Bauchschmerzen nehmen?',
    'Which medication should I take for stomach pain?',
    'Which German student visa fits my personal case, and how should I apply?',
    'Welches Visum passt zu meinem persönlichen Fall?',
])
def test_personal_medical_and_legal_questions_stop_before_retrieval(question):
    service, retriever, provider = service_for([record()])
    reply = service.answer(question, 'bayreuth', 'de')
    contract_ok(reply)
    assert reply['kind'] == 'out-of-scope'
    assert retriever.calls == provider.calls == []

def test_berlin_sights_are_outside_pilot_without_irrelevant_sources():
    service, retriever, provider = service_for([record()])
    reply = service.answer('What are the best attractions in Berlin?', None, 'de')
    assert reply['kind'] == 'out-of-scope' and reply['sources'] == []
    assert 'Bamberg' in reply['text'] and 'Bayreuth' in reply['text']
    assert retriever.calls == provider.calls == []

def test_static_neighbour_can_answer_tradition_despite_mixed_top_hit():
    rows = {r['id']: r for r in real_records()}
    selected = [rows['BA-RESEARCH-011'], rows['BA-RESEARCH-002']]
    service, _, provider = service_for(selected, FakeProvider(model_json('Bamberg has a historic gardening tradition.', ['BA-RESEARCH-002'])))
    reply = service.answer('Welche regionale Tradition sollte ich in Bamberg kennen?', 'bamberg', 'de')
    assert provider.calls and reply['kind'] == 'answer'
    assert not reply['text'].startswith('Quellenhinweis:')

@pytest.mark.parametrize('rid,question', [
    ('BA-REST-01', 'What is Schlenkerla known for in Bamberg?'),
    ('BA-SPORT-01', 'Warum sind die Bamberg Baskets sporthistorisch bekannt?'),
    ('BY-SPORT-01', 'Was bedeutet Oldschdod im Zusammenhang mit Bayreuth?'),
    ('BY-SIGHT-01', 'What is the Margravial Opera House?'),
    ('BY-SIGHT-02', 'What is the Festival Theatre in Bayreuth?'),
    ('BY-REST-01', 'What regional dish is documented for Oskar in Bayreuth?'),
])
def test_reviewed_static_facts_in_mixed_records_are_answerable(rid, question):
    rows = {r['id']: r for r in real_records()}; rec = rows[rid]
    service, _, provider = service_for([rec], FakeProvider(model_json('A documented historical fact.', [rid])))
    reply = service.answer(question, rec['city'], 'en')
    assert provider.calls and reply['kind'] == 'answer'
    assert '2026/27' not in provider.calls[0][1] and '10€/ermäßigt' not in provider.calls[0][1]

def test_english_theatre_question_excludes_german_group():
    rows = {r['id']: r for r in real_records()}
    selected = [rows['BA-ACT-GLUT'], rows['BA-ACT-ENGLISH-DRAMA']]
    service, _, provider = service_for(selected, FakeProvider(model_json('BUEDG performs in English.', ['BA-ACT-ENGLISH-DRAMA'])))
    reply = service.answer('Which English-language student theatre group can I join in Bamberg?', 'bamberg', 'de')
    assert provider.calls and reply['sources'][0]['recordId'] == 'BA-ACT-ENGLISH-DRAMA'
    assert 'id="BA-ACT-GLUT"' not in provider.calls[0][1]

def test_named_club_history_does_not_cite_university_basketball():
    rows = {r['id']: r for r in real_records()}
    service, _, provider = service_for([rows['BA-ACT-BASKETBALL'], rows['BA-SPORT-01']], FakeProvider(model_json('The club has nine German championships.', ['BA-SPORT-01'])))
    reply = service.answer('Warum sind die Bamberg Baskets sporthistorisch bekannt?', 'bamberg', 'de')
    assert provider.calls and reply['sources'][0]['recordId'] == 'BA-SPORT-01'
    assert 'id="BA-ACT-BASKETBALL"' not in provider.calls[0][1]

def test_university_overview_is_not_answered_with_housing_or_cafeteria():
    rows = {r['id']: r for r in real_records()}
    selected = [rows['BT-NEW-SWO-ONLINE-APPLICATION'], rows['BT-ACT-CAMPUS-FOOD'], rows['BY-NEW-05']]
    service, _, provider = service_for(selected)
    reply = service.answer('Wo kann man in Oberfranken studieren?', None, 'de')
    assert reply['kind'] == 'fallback' and reply['sources'] == [] and provider.calls == []

def test_live_ticket_question_never_points_to_a_different_festival():
    rows = {r['id']: r for r in real_records()}
    selected = [rows['BY-SIGHT-01'], rows['BY-SIGHT-02']]
    service, _, provider = service_for(selected)
    reply = service.answer('Are tickets for the Festspielhaus available tonight?', 'bayreuth', 'de')
    assert provider.calls == [] and reply['text'].startswith('Source pointer:')
    assert [s['recordId'] for s in reply['sources']] == ['BY-SIGHT-02']

def test_unknown_mixed_record_is_not_unlocked_by_sentence_filtering():
    rec = record('UNKNOWN', temporal='changing', answer_policy='verify_live_before_answering', content='The club is in a league. It costs 40 Euro.')
    service, _, provider = service_for([rec])
    service.answer('Tell me about it', 'bamberg', 'en')
    assert provider.calls == []
