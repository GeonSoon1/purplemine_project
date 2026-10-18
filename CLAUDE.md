# purplemine_project

## 서비스 개요
- 우리 회사: 자동차 렌트 회사
- 고객: 드라마, 영화 제작사
- 목적: 제작사가 보낸 대본을 LLM + RAG로 분석해서 촬영에 필요한 차량 렌트 견적서를 자동으로 뽑는 서비스
- 대본에서 뽑아야 하는 정보
  - 씬별 등장 차량 (주인공 차, 조연 차, 배경 차 등)
  - 차종, 대수, 용도 (일반 주행, 추격, 액션, 파손 여부 등)
  - 촬영 일정/기간 단서
- 뽑은 요구사항을 보유 차량 DB와 매칭해서 견적서(차량 목록, 대수, 기간, 금액) 생성

## 기술 스택
- 프론트: Next.js (TypeScript)
- 백엔드: NestJS (TypeScript)
- LLM 서버: Python, LangChain + FastAPI (대본 분석, RAG)
- DB: PostgreSQL + pgvector (일반 데이터와 벡터 검색을 한 DB로)
- 평가: LangSmith (트레이싱, 데이터셋 평가) - 추후 도입
- 배포: 추후 결정 (Docker 등)

## 서비스 흐름
1. 프론트에서 대본 업로드
2. NestJS가 대본 저장 후 LLM 서버 호출
3. LLM 서버가 씬 분할 → 씬별 차량 요구사항을 구조화(JSON) 추출
4. RAG로 보유 차량 DB와 매칭
5. NestJS가 견적서 생성/저장 → 프론트에서 조회, 수정

## 디렉토리 구조 (예정)
- `apps/web`: Next.js 프론트
- `apps/api`: NestJS 백엔드
- `services/llm`: Python LLM 서버
- `docs/`: 기획서, 다이어그램(mermaid), 디자인 문서
- `data/scripts/`: 대본 원본 (git 제외)

## 대본 데이터 규칙
- 대본은 제작사 기밀/저작물이므로 `data/scripts/`에만 두고 git에 올리지 않음
- 현재 실제 대본은 정리 중이라 미투입. 개발은 가짜 샘플 대본으로 진행
- 외부 LLM API로 대본 전송 가능 여부는 계약 확인 필요

## 에이전트 팀
- 리더(Claude): 작업 분배, 결과 취합, 사용자 보고
- planner: 요구사항, 아키텍처도, ER, 화면 흐름도 작성 (`grill-me`, `design-doc-mermaid`)
- designer: 화면 설계, 디자인 토큰 (`frontend-design`)
- frontend: Next.js 구현 (`vercel-react-best-practices`)
- backend: NestJS, DB 스키마 (`nestjs-best-practices`, `supabase-postgres-best-practices`)
- llm: 대본 분석, RAG 서버 (`fastapi`, `langchain-rag`, `langchain-fundamentals`, `langchain-python-quickstart`)
- reviewer: `codex` CLI로 코드 검증. 수정은 하지 않고 리포트만
- git-manager: 커밋 준비, git diff 확인

## 작업 순서
기획 → 다이어그램 → 디자인 → 프론트/백엔드/LLM 병렬 구현 → Codex 검증 → 커밋(사용자 승인)

## Git 규칙
- git-manager는 커밋 전 변경 요약을 보여주고 사용자가 `y`로 승인해야만 commit 실행
- 승인 없는 commit 금지. push, reset, rebase, checkout, restore 등 상태 변경 명령은 절대 금지
- 조회(git status, log, diff)는 자유
- 커밋 메시지: `.gitmessage.txt` 형식 (`<이모지> <타입> : <내용>`, 50자 이내, 마침표 없음)
- 브랜치/PR 규칙: `CONTRIBUTING.md` 참고
