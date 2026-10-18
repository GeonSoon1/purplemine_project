import os
from pathlib import Path

os.environ["LLM_PROVIDER"] = "mock"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import AnalyzeResponse

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
client = TestClient(app)


def call(name: str, **extra):
    text = (SAMPLES / name).read_text(encoding="utf-8")
    r = client.post("/analyze", json={"scriptId": "t-1", "text": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def scene(data, no):
    return next(s for s in data["scenes"] if s["sceneNo"] == no)


def test_health():
    body = client.get("/health").json()
    assert {k: body[k] for k in ("status", "provider", "model", "promptVersion")} == {
        "status": "ok", "provider": "mock", "model": "mock-rule-v1", "promptVersion": "v1"
    }
    assert body["embeddingDimension"] == 384


@pytest.mark.parametrize("f", sorted(p.name for p in SAMPLES.glob("*.txt")))
def test_schema_valid_all_samples(f):
    data = call(f)
    parsed = AnalyzeResponse.model_validate(data)
    nos = [s.scene_no for s in parsed.scenes]
    assert len(nos) == len(set(nos))
    for s in parsed.scenes:
        for v in s.vehicles:
            if v.source_quote:
                assert v.source_quote in s.source_text


def test_chase_drama_scenes_and_vehicles():
    d = call("sample_chase_drama.txt")
    assert len(d["scenes"]) == 20
    assert scene(d, 2)["vehicles"] == []  # 차량 없는 씬도 포함
    assert scene(d, 3)["timeOfDay"] == "NIGHT"
    assert scene(d, 4)["timeOfDay"] == "DAWN"

    g90 = next(v for v in scene(d, 4)["vehicles"] if v["brandModelHint"])
    assert g90["brandModelHint"] == "제네시스 G90"
    assert g90["usage"] == "CHASE" and g90["role"] == "LEAD"
    suv = next(v for v in scene(d, 4)["vehicles"] if v["categoryHint"] == "SUV")
    assert suv["quantity"] == 3 and suv["brandModelHint"] is None

    # 차명 없이 '고급 세단'만 -> brandModelHint 는 null (추측 금지)
    v7 = scene(d, 7)["vehicles"][0]
    assert v7["vehicleType"] == "고급 세단" and v7["brandModelHint"] is None

    assert scene(d, 6)["vehicles"][0]["categoryHint"] == "COMPACT"
    assert scene(d, 8)["vehicles"][0]["vehicleType"] == "구급차"
    assert all(v["role"] == "BACKGROUND" for v in scene(d, 18)["vehicles"])
    assert scene(d, 18)["vehicles"][0]["quantity"] == 2

    s10 = scene(d, 10)["vehicles"]
    sedan = next(v for v in s10 if v["vehicleType"] == "고급 세단")
    assert sedan["usage"] == "DAMAGE" and sedan["damageExpected"]
    assert any(v["usage"] == "DAMAGE" for v in scene(d, 16)["vehicles"])


def test_schedule_hints():
    d = call("sample_chase_drama.txt")
    sch = d["shootSchedule"]
    assert sch["start"] == "2026-11-03" and sch["end"] == "2026-11-21"
    assert any("11월 둘째 주" in h for h in sch["hints"])

    d = call("sample_chase_drama.txt", hints={"shootStart": "2026-12-01", "shootEnd": "2026-12-05"})
    assert d["shootSchedule"]["start"] == "2026-12-01"


def test_crash_movie():
    d = call("sample_crash_movie.txt")
    assert len(d["scenes"]) == 4
    por = scene(d, 4)["vehicles"][0]
    assert por["brandModelHint"] == "포르쉐 911" and por["quantity"] == 3
    assert por["damageExpected"] is True


def test_no_header_single_scene():
    d = call("sample_no_header.txt")
    assert len(d["scenes"]) == 1 and d["scenes"][0]["sceneNo"] == 1
    assert d["scenes"][0]["vehicles"][0]["categoryHint"] == "SUV"


@pytest.mark.parametrize("text", ["", "   \n "])
def test_empty_text_422(text):
    r = client.post("/analyze", json={"scriptId": "x", "text": text})
    assert r.status_code == 422


def test_missing_script_id_422():
    assert client.post("/analyze", json={"text": "S#1. a / 낮"}).status_code == 422
