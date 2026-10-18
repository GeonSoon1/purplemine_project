# services/llm

대본 분석 + 보유 차량 RAG 매칭 FastAPI 서버 (NestJS 전용 내부 서비스). 계약: `docs/api/llm.md`.

## 실행
```bash
cd services/llm
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # 기본 LLM_PROVIDER=mock (키 불필요)
.venv/bin/uvicorn app.main:app --port 8000
```

## 호출 예
```bash
curl localhost:8000/health
python3 -c 'import json;print(json.dumps({"scriptId":"s1","text":open("samples/sample_chase_drama.txt",encoding="utf-8").read()}))' \
  | curl -s -X POST localhost:8000/analyze -H 'content-type: application/json' -d @-
```

## 프로바이더
- `mock`: 규칙 기반(씬 헤더 `S#번호. 장소 / 시간대` + 한국어 키워드). 휴리스틱이라 문맥 추론(예: 대상 불명확한 파손)은 한계가 있다.
- `anthropic` / `openai`: 씬 분할은 동일하게 규칙으로, 씬별 차량 추출만 LangChain `with_structured_output`. `.env`에 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, 선택적으로 `LLM_MODEL`. 외부 전송은 계약 확인 후에만 사용.
- 대본 원문은 로그에 남기지 않는다.

## 임베딩 / RAG 매칭 (`/embed`, `/match`)
- 로컬 `intfloat/multilingual-e5-small`(384차원, 외부 전송·비용 없음). 모델(약 470MB)은 첫 호출 때 `services/llm/.cache/models`에 내려받는다 (git 제외). 이후 오프라인 동작.
- `/match`는 `DATABASE_URL`로 `vehicles`(pgvector)를 **읽기 전용**으로 조회한다. `.env.example`의 `EMBEDDING_*`, `DATABASE_URL` 참고.
- 차량 임베딩은 `/embed`(`kind: passage`)로 만들어 NestJS가 저장한다. 모델을 바꾸면 전부 재임베딩 필요.
```bash
curl -s -X POST localhost:8000/embed -H 'content-type: application/json' \
  -d '{"texts":["제네시스 G90 고급 세단"],"kind":"passage"}'
curl -s -X POST localhost:8000/match -H 'content-type: application/json' \
  -d '{"requirement":{"vehicleType":"고급 세단","categoryHint":"SEDAN","brandModelHint":null,"usage":"CHASE","damageExpected":false,"quantity":1,"sourceQuote":null},"topK":5}'
```

## 테스트
```bash
.venv/bin/pytest
```
`/embed`·`/match` 테스트는 페이크 임베더를 주입하고, `/match` SQL은 로컬 DB(`TEST_DATABASE_URL`, 기본 localhost:5433)에 임시 스키마를 만들어 검증한 뒤 지운다 (운영 `vehicles` 미접촉). 로컬 모델이나 DB가 없으면 해당 테스트는 skip.
