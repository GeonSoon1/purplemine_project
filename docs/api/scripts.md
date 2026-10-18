# 대본 API

## ScriptStatus 흐름
`UPLOADED` → `ANALYZING` → `ANALYZED` | `FAILED`. 업로드 응답 시점에 분석이 이미 접수되므로 보통 `ANALYZING`으로 돌아온다. 프론트는 `GET /scripts/:id`를 2~3초 간격으로 폴링하다 `ANALYZED`/`FAILED`에서 멈춘다.

## Script 객체
```json
{
  "id": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
  "title": "서울의 밤",
  "productionCompany": "한빛스튜디오",
  "fileName": "seoul-night.txt",
  "fileType": "txt",
  "fileSize": 18342,
  "shootStart": "2026-11-03",
  "shootEnd": "2026-11-21",
  "status": "ANALYZING",
  "errorMessage": null,
  "analysisModel": null,
  "promptVersion": null,
  "sceneCount": 0,
  "requirementCount": 0,
  "createdAt": "2026-10-19T03:21:00.000Z",
  "updatedAt": "2026-10-19T03:21:01.000Z"
}
```
- `errorMessage`: `FAILED`일 때 사용자에게 보여 줄 수 있는 사유.
- `analysisModel`, `promptVersion`: 분석 완료 후 채워짐 (재현성 기록).
- `sceneCount`, `requirementCount`: 분석 전에는 0.
- 서버 내부 파일 경로(`file_path`)는 노출하지 않는다.

## POST /scripts — 업로드 + 분석 시작
`multipart/form-data`

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | O | `.txt` `.pdf` `.docx`. 최대 10MB |
| `title` | O | 작품명 (1~200자) |
| `productionCompany` | O | 제작사 (1~200자) |
| `shootStart` | | `YYYY-MM-DD` |
| `shootEnd` | | `YYYY-MM-DD`, `shootStart` 이후 |

응답 `201` — Script 객체 (`status: "ANALYZING"`). 분석은 백그라운드로 진행된다.
오류: `400` 필수값 누락/날짜 역전/텍스트를 읽을 수 없는 파일(손상, 스캔 이미지, 빈 파일)/본문 500,000자 초과, `413` 용량 초과, `415` 지원 안 하는 형식.
업로드 시점에 텍스트 추출까지 끝내므로 위 `400`은 대본이 저장되기 전에 돌아온다 (실패한 업로드는 아무것도 남기지 않는다). 서버가 재시작되어 `ANALYZING`으로 남은 대본은 `FAILED`(`errorMessage`: 재시작 안내)로 바뀐다.

## GET /scripts
쿼리: `status`(선택, ScriptStatus), `q`(작품명/제작사 부분 검색), `page`, `pageSize`. 정렬: 최신 업로드순.
```json
{ "items": [ { "...Script 객체..." } ], "page": 1, "pageSize": 20, "total": 3 }
```

## GET /scripts/:id
Script 객체. `404` 없음.

## DELETE /scripts/:id
대본 원본 파일과 씬·요구사항·후보를 함께 삭제한다. 이 대본에서 만든 견적서는 **삭제하지 않고** 유지한다 (`quote.scriptId`는 `null`이 되고 작품명/제작사는 견적서에 복사본으로 남아 있다).
응답 `204`. 분석 중(`ANALYZING`)이면 `409`.

## POST /scripts/:id/analyze — 재분석
기존 씬·요구사항·후보를 지우고 다시 분석한다. 사람이 수정한 요구사항(`isUserEdited`)도 지워지므로 프론트에서 확인 모달을 띄울 것.
응답 `202` — Script 객체 (`status: "ANALYZING"`). `ANALYZING`이면 `409`.
