"""docs/api/llm.md 계약에 대응하는 Pydantic 모델. JSON 필드는 camelCase."""
from datetime import date
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class TimeOfDay(str, Enum):
    DAY = "DAY"
    NIGHT = "NIGHT"
    DAWN = "DAWN"
    DUSK = "DUSK"
    UNKNOWN = "UNKNOWN"


class VehicleRole(str, Enum):
    LEAD = "LEAD"
    SUPPORT = "SUPPORT"
    BACKGROUND = "BACKGROUND"


class VehicleCategory(str, Enum):
    COMPACT = "COMPACT"
    SEDAN = "SEDAN"
    SUV = "SUV"
    VAN = "VAN"
    TRUCK = "TRUCK"
    SPORTS = "SPORTS"
    CLASSIC = "CLASSIC"
    OTHER = "OTHER"


class VehicleUsage(str, Enum):
    NORMAL = "NORMAL"
    CHASE = "CHASE"
    ACTION = "ACTION"
    DAMAGE = "DAMAGE"


# 용도 강도: 파손 > 액션 > 추격 > 일반
USAGE_RANK = {
    VehicleUsage.NORMAL: 0,
    VehicleUsage.CHASE: 1,
    VehicleUsage.ACTION: 2,
    VehicleUsage.DAMAGE: 3,
}


# ---- 요청 ----
class Hints(CamelModel):
    shoot_start: date | None = None
    shoot_end: date | None = None


class AnalyzeRequest(CamelModel):
    script_id: Annotated[str, Field(min_length=1)]
    text: Annotated[str, Field(min_length=1, max_length=500_000)]
    hints: Hints | None = None

    @field_validator("text")
    @classmethod
    def text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be empty")
        return v


# ---- 응답 ----
class Vehicle(CamelModel):
    role: VehicleRole
    vehicle_type: str
    category_hint: VehicleCategory | None = None
    brand_model_hint: str | None = None
    quantity: Annotated[int, Field(ge=1)] = 1
    usage: VehicleUsage = VehicleUsage.NORMAL
    damage_expected: bool = False
    source_quote: str | None = None
    confidence: Annotated[float, Field(ge=0, le=1)] = 0.5


class VehicleExtraction(CamelModel):
    """LLM 프로바이더 구조화 출력용 (씬 1개 분량)."""

    summary: str
    shoot_date_hint: date | None = None
    vehicles: list[Vehicle] = Field(default_factory=list)


class Scene(CamelModel):
    scene_no: int
    location: str | None = None
    time_of_day: TimeOfDay = TimeOfDay.UNKNOWN
    summary: str
    source_text: str
    shoot_date_hint: date | None = None
    vehicles: list[Vehicle] = Field(default_factory=list)


class ShootSchedule(CamelModel):
    start: date | None = None
    end: date | None = None
    hints: list[str] = Field(default_factory=list)


class AnalyzeResponse(CamelModel):
    script_id: str
    model: str
    prompt_version: str
    scenes: list[Scene]
    shoot_schedule: ShootSchedule


class HealthResponse(CamelModel):
    status: str = "ok"
    provider: str
    model: str
    prompt_version: str
    embedding_provider: str | None = None
    embedding_model: str | None = None
    embedding_dimension: int | None = None


# ---- /embed ----
class EmbedRequest(CamelModel):
    texts: Annotated[list[Annotated[str, Field(min_length=1, max_length=4000)]], Field(min_length=1, max_length=64)]
    kind: Literal["passage", "query"]


    @field_validator("texts")
    @classmethod
    def texts_not_blank(cls, v: list[str]) -> list[str]:
        if any(not t.strip() for t in v):
            raise ValueError("texts must not contain empty strings")
        return v


class EmbedResponse(CamelModel):
    model: str
    dimension: int
    embeddings: list[list[float]]


# ---- /match ----
class VehicleRequirementIn(CamelModel):
    vehicle_type: Annotated[str, Field(min_length=1, max_length=200)]
    category_hint: VehicleCategory | None = None
    brand_model_hint: str | None = None
    usage: VehicleUsage = VehicleUsage.NORMAL
    damage_expected: bool = False
    quantity: Annotated[int, Field(ge=1)] = 1
    source_quote: str | None = None

    @field_validator("vehicle_type")
    @classmethod
    def vehicle_type_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("vehicleType must not be empty")
        return v


class MatchRequest(CamelModel):
    requirement: VehicleRequirementIn
    top_k: Annotated[int, Field(ge=1, le=50)] = 5


class MatchCandidate(CamelModel):
    vehicle_id: str
    score: Annotated[int, Field(ge=0, le=100)]
    reason: str


class MatchResponse(CamelModel):
    model: str
    candidates: list[MatchCandidate]
