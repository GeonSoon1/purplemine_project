"""씬 분할 (규칙 기반, 모든 프로바이더 공용) 및 일정 단서 추출."""
import re
from dataclasses import dataclass
from datetime import date

from .schemas import Hints, ShootSchedule, TimeOfDay

HEADER_RE = re.compile(r"^[ \t]*S#\s*(\d+)\s*[.\-:)]?\s*(.*)$", re.MULTILINE)

_TIME_WORDS: list[tuple[str, TimeOfDay]] = [
    ("새벽", TimeOfDay.DAWN),
    ("황혼", TimeOfDay.DUSK),
    ("저녁", TimeOfDay.DUSK),
    ("해질", TimeOfDay.DUSK),
    ("밤", TimeOfDay.NIGHT),
    ("야간", TimeOfDay.NIGHT),
    ("낮", TimeOfDay.DAY),
    ("오전", TimeOfDay.DAY),
    ("오후", TimeOfDay.DAY),
    ("아침", TimeOfDay.DAY),
]


@dataclass
class RawScene:
    scene_no: int
    location: str | None
    time_of_day: TimeOfDay
    source_text: str
    body: str  # 헤더를 제외한 본문


def parse_time_of_day(s: str | None) -> TimeOfDay:
    if not s:
        return TimeOfDay.UNKNOWN
    for word, tod in _TIME_WORDS:
        if word in s:
            return tod
    return TimeOfDay.UNKNOWN


def split_scenes(text: str) -> list[RawScene]:
    headers = list(HEADER_RE.finditer(text))
    if not headers:
        body = text.strip()
        return [RawScene(1, None, TimeOfDay.UNKNOWN, body, body)]

    scenes: list[RawScene] = []
    used: set[int] = set()
    for i, m in enumerate(headers):
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        chunk = text[m.start() : end].strip()
        no = int(m.group(1))
        if no in used:  # 번호 중복 불가
            no = max(used) + 1
        used.add(no)
        loc_part, _, time_part = m.group(2).partition("/")
        location = loc_part.strip() or None
        body = text[m.end() : end].strip()
        scenes.append(RawScene(no, location, parse_time_of_day(time_part), chunk, body))
    return scenes


# ---- 일정 단서 ----
ISO_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
KR_DATE_RE = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")
HINT_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}|\d{1,2}\s*월|\d+\s*주|상순|중순|하순|야간 촬영|촬영\s*예정|예정이다"
)


def find_dates(text: str) -> list[date]:
    out: list[date] = []
    for rx in (ISO_RE, KR_DATE_RE):
        for m in rx.finditer(text):
            try:
                out.append(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
            except ValueError:
                pass
    return out


def extract_schedule(text: str, hints: Hints | None) -> ShootSchedule:
    found: list[str] = []
    for line in re.split(r"[\n。]|(?<=[.다요])\s", text):
        line = line.strip()
        if "촬영" in line and HINT_RE.search(line) and line not in found:
            found.append(line.rstrip("."))
    start = end = None
    if hints and (hints.shoot_start or hints.shoot_end):
        start, end = hints.shoot_start, hints.shoot_end
    else:
        dates = sorted(find_dates("\n".join(found)))
        if dates:
            start = dates[0]
            end = dates[-1] if len(dates) > 1 else None
    return ShootSchedule(start=start, end=end, hints=found[:20])


def scene_date_hint(text: str) -> date | None:
    """씬 내 날짜가 정확히 하나로 특정될 때만."""
    dates = set(find_dates(text))
    return dates.pop() if len(dates) == 1 else None
