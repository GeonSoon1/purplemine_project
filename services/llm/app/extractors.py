"""추출기: mock(규칙 기반) / anthropic / openai (LangChain structured output)."""
import logging
import re
from typing import Protocol

from pydantic import ValidationError

from .config import PROMPT_VERSION, Settings
from .scenes import RawScene, extract_schedule, scene_date_hint, split_scenes
from .schemas import (
    USAGE_RANK,
    AnalyzeRequest,
    AnalyzeResponse,
    Scene,
    Vehicle,
    VehicleCategory as C,
    VehicleExtraction,
    VehicleRole,
    VehicleUsage,
)

log = logging.getLogger("llm")  # 대본 원문은 절대 로그에 남기지 않는다


class ExtractionError(Exception):
    """모델 응답이 스키마에 안 맞거나 모델 호출 실패 -> 502."""


class Extractor(Protocol):
    def extract_scene(self, scene: RawScene) -> VehicleExtraction: ...


# ---------------------------------------------------------------- mock
# (정규식, 차종 표기, 분류) -- 차명(브랜드/모델)이 명시된 경우
_BRAND_MODELS: list[tuple[str, str, C]] = [
    (r"제네시스\s*G\d{2}", "고급 세단", C.SEDAN),
    (r"벤츠\s*[A-Z]\s*클래스|벤츠\s*S\d{3}", "고급 세단", C.SEDAN),
    (r"BMW\s*\d\s*시리즈", "고급 세단", C.SEDAN),
    (r"그랜저|소나타|아반떼|K[3579]", "세단", C.SEDAN),
    (r"포르쉐\s*911|페라리|람보르기니", "스포츠카", C.SPORTS),
    (r"카니발|스타렉스", "승합차", C.VAN),
    (r"쏘렌토|싼타페|팰리세이드|투싼", "SUV", C.SUV),
    (r"모닝|캐스퍼|레이", "경차", C.COMPACT),
]
# 일반 차종 키워드 (긴 것 먼저)
_TYPES: list[tuple[str, str, C]] = [
    (r"고급\s*세단", "고급 세단", C.SEDAN),
    (r"스포츠카", "스포츠카", C.SPORTS),
    (r"클래식카|올드카", "클래식카", C.CLASSIC),
    (r"구급차", "구급차", C.VAN),
    (r"취재\s*밴|승합차|밴", "승합차", C.VAN),
    (r"봉고\s*트럭|대형\s*트럭|트럭", "트럭", C.TRUCK),
    (r"경차", "경차", C.COMPACT),
    (r"SUV|지프", "SUV", C.SUV),
    (r"세단", "세단", C.SEDAN),
    (r"택시", "택시", C.SEDAN),
    (r"버스", "버스", C.OTHER),
    (r"승용차", "승용차", C.SEDAN),
]
_DEFAULT_SUPPORT = {"구급차", "택시", "버스", "트럭", "승합차"}

_NUM = {"한": 1, "하나": 1, "두": 2, "둘": 2, "세": 3, "셋": 3, "네": 4, "넷": 4,
        "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10}
_NUM_RE = r"(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|여러|몇)"
_BG_RE = re.compile(r"배경|주차되어|곳곳|줄지어|오간다|오가는|지나간다")
_SUPPORT_RE = re.compile(r"추격자|가로막|뒤따라|뒤에서|잠복|쫓")
_DAMAGE_RE = re.compile(r"충돌|전복|폭발|파손|대파|불탄|불타|부딪|추락")
_ACTION_RE = re.compile(r"액션|드리프트|점프|경주|스턴트")
_CHASE_RE = re.compile(r"추격|따돌|쫓")


def _qty(sentence: str, start: int, end: int) -> int:
    """언급 구간 앞뒤에 바로 붙은 'N대' 해석."""
    after = re.match(rf"\s*{_NUM_RE}\s*대", sentence[end:])
    before = re.search(rf"{_NUM_RE}\s*대(?:의)?\s*$", sentence[:start])
    m = after or before
    if not m:
        return 1
    w = m.group(1)
    if w.isdigit():
        return max(1, int(w))
    if w == "여러":
        return 3
    if w == "몇":
        return 2
    return _NUM.get(w, 1)


def _sentences(body: str) -> list[str]:
    parts = re.split(r"(?<=[.!?다])\s+|\n+", body)
    return [p.strip() for p in parts if p.strip()]


def _usage(sentence: str) -> VehicleUsage:
    if _DAMAGE_RE.search(sentence):
        return VehicleUsage.DAMAGE
    if _ACTION_RE.search(sentence):
        return VehicleUsage.ACTION
    if _CHASE_RE.search(sentence):
        return VehicleUsage.CHASE
    return VehicleUsage.NORMAL


def _mentions(sentence: str) -> list[tuple[int, int, str, C, str | None]]:
    """(start, end, vehicleType, category, brandModel)"""
    found: list[tuple[int, int, str, C, str | None]] = []
    taken: list[tuple[int, int]] = []

    def free(s: int, e: int) -> bool:
        return all(e <= ts or s >= te for ts, te in taken)

    for rx, vtype, cat in _BRAND_MODELS:
        for m in re.finditer(rx, sentence):
            if free(m.start(), m.end()):
                taken.append((m.start(), m.end()))
                found.append((m.start(), m.end(), vtype, cat, re.sub(r"\s+", " ", m.group(0))))
    for rx, vtype, cat in _TYPES:
        for m in re.finditer(rx, sentence):
            if free(m.start(), m.end()):
                taken.append((m.start(), m.end()))
                found.append((m.start(), m.end(), vtype, cat, None))
    return sorted(found)


class MockExtractor:
    """API 키 없이 동작하는 규칙 기반 추출기."""

    def extract_scene(self, scene: RawScene) -> VehicleExtraction:
        merged: dict[tuple[str, str | None], Vehicle] = {}
        damage_only_sentences: list[str] = []
        scene_chase = bool(_CHASE_RE.search(scene.body))

        for sent in _sentences(scene.body):
            ms = _mentions(sent)
            if not ms:
                if _DAMAGE_RE.search(sent):
                    damage_only_sentences.append(sent)
                continue
            usage = _usage(sent)
            is_bg = bool(_BG_RE.search(sent))
            for s, e, vtype, cat, brand in ms:
                if is_bg:
                    role = VehicleRole.BACKGROUND
                elif _SUPPORT_RE.search(sent) and brand is None or vtype in _DEFAULT_SUPPORT:
                    role = VehicleRole.SUPPORT
                else:
                    role = VehicleRole.LEAD
                v = Vehicle(
                    role=role,
                    vehicle_type=vtype,
                    category_hint=cat,
                    brand_model_hint=brand,
                    quantity=_qty(sent, s, e),
                    usage=usage,
                    damage_expected=usage == VehicleUsage.DAMAGE,
                    source_quote=sent,
                    confidence=0.9 if brand else (0.6 if is_bg else 0.75),
                )
                key = (vtype, brand)
                old = merged.get(key)
                if old is None:
                    merged[key] = v
                else:  # 같은 차량 재언급: 대수는 큰 쪽, 용도는 강한 쪽
                    old.quantity = max(old.quantity, v.quantity)
                    if USAGE_RANK[v.usage] > USAGE_RANK[old.usage]:
                        old.usage = v.usage
                    if old.role == VehicleRole.BACKGROUND and v.role != VehicleRole.BACKGROUND:
                        old.role = v.role

        vehicles = list(merged.values())
        for v in vehicles:
            if v.role == VehicleRole.BACKGROUND:
                continue
            # 씬 전체 추격은 배경 아닌 차량에 전파. 대상 미지정 파손 문장도 전파.
            if scene_chase and USAGE_RANK[v.usage] < USAGE_RANK[VehicleUsage.CHASE]:
                v.usage = VehicleUsage.CHASE
            if damage_only_sentences:
                v.usage = VehicleUsage.DAMAGE
            v.damage_expected = v.usage == VehicleUsage.DAMAGE

        first = next(iter(_sentences(scene.body)), "")
        summary = first[:80] if first else (scene.location or "")
        return VehicleExtraction(
            summary=summary, shoot_date_hint=scene_date_hint(scene.body), vehicles=vehicles
        )


# ---------------------------------------------------------------- LLM (LangChain)
_SYSTEM_PROMPT = (
    "너는 영화/드라마 대본에서 촬영용 렌트 차량 요구사항을 뽑는 분석가다. "
    "입력은 대본의 씬 1개다. 규칙: 차량이 안 나오면 vehicles는 빈 배열. "
    "brandModelHint는 대본에 명시된 차명만 쓰고 추측하지 말 것(없으면 null). "
    "role은 LEAD(주인공 차)/SUPPORT(조연 차)/BACKGROUND(배경 차). "
    "usage는 가장 강한 용도 하나(DAMAGE > ACTION > CHASE > NORMAL), "
    "충돌/전복/폭발/파손이 있으면 usage=DAMAGE, damageExpected=true. "
    "quantity는 1 이상 정수. sourceQuote는 씬 원문에서 그대로 인용. "
    "summary는 한 문장 요약. shootDateHint는 YYYY-MM-DD로 특정될 때만."
)


class LangChainExtractor:
    def __init__(self, settings: Settings):
        from langchain_core.prompts import ChatPromptTemplate  # lazy import

        if settings.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic

            llm = ChatAnthropic(model=settings.model, temperature=0)  # 키: ANTHROPIC_API_KEY
        else:
            from langchain_openai import ChatOpenAI

            llm = ChatOpenAI(model=settings.model, temperature=0)  # 키: OPENAI_API_KEY
        prompt = ChatPromptTemplate.from_messages(
            [("system", _SYSTEM_PROMPT), ("human", "{scene}")]
        )
        self._chain = prompt | llm.with_structured_output(VehicleExtraction)

    def extract_scene(self, scene: RawScene) -> VehicleExtraction:
        last: Exception | None = None
        for _ in range(2):  # 검증 실패 시 1회 재시도
            try:
                out = self._chain.invoke({"scene": scene.source_text})
                if isinstance(out, dict):
                    out = VehicleExtraction.model_validate(out)
                return out
            except ValidationError as e:
                last = e
            except Exception as e:  # 모델 호출 실패
                raise ExtractionError(type(e).__name__) from e
        raise ExtractionError("schema validation failed") from last


# ---------------------------------------------------------------- 공통 파이프라인
def build_extractor(settings: Settings) -> Extractor:
    if settings.provider == "mock":
        return MockExtractor()
    return LangChainExtractor(settings)


def analyze(req: AnalyzeRequest, extractor: Extractor, settings: Settings) -> AnalyzeResponse:
    scenes: list[Scene] = []
    for raw in split_scenes(req.text):
        ext = extractor.extract_scene(raw)
        for v in ext.vehicles:  # 인용은 씬 원문의 부분 문자열이어야 함
            if v.source_quote and v.source_quote not in raw.source_text:
                v.source_quote = None
        scenes.append(
            Scene(
                scene_no=raw.scene_no,
                location=raw.location,
                time_of_day=raw.time_of_day,
                summary=ext.summary,
                source_text=raw.source_text,
                shoot_date_hint=ext.shoot_date_hint,
                vehicles=ext.vehicles,
            )
        )
    log.info("analyzed script=%s scenes=%d", req.script_id, len(scenes))
    return AnalyzeResponse(
        script_id=req.script_id,
        model=settings.model,
        prompt_version=PROMPT_VERSION,
        scenes=scenes,
        shoot_schedule=extract_schedule(req.text, req.hints),
    )
