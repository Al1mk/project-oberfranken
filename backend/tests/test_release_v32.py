import json
from pathlib import Path
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.records import load_records

SOURCE=c.ROOT.parent/'data'/'v3.2'/'Oberfranken_Knowledge_Base_Merged_v3.2.jsonl'

def test_new_release_loads_with_two_pilot_universities():
    rows=load_records(SOURCE)
    assert len(rows)==251
    assert {r['id'] for r in rows if r['id'].endswith('-UNIVERSITY')}=={'BA-NEW-UNIVERSITY','BY-NEW-UNIVERSITY'}
    assert c.SOURCE==SOURCE

def test_manifest_tampering_fails_even_with_unchanged_jsonl(tmp_path):
    source=tmp_path/SOURCE.name
    source.write_bytes(SOURCE.read_bytes())
    manifest=json.loads((SOURCE.parent/'manifest.json').read_text())
    manifest['record_count']=249
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match='manifest'):
        load_records(source)
