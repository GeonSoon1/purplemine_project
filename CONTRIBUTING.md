# Contributing Guide
## 브랜치 전략
- main: 배포용(항상 안정)
- dev: 통합 개발
- feature/<scope>-<desc>: 기능 개발 브랜치

## 커밋 규칙
- .gitmessage.txt 템플릿 사용
- 50자 이내, 이모지 + 타입 + 제목 : 내용

## PR 규칙
- feature -> dev 로 PR
- 승인(2명) + CI 통과 후 merge
- dev -> main 은 배포 시점에 PR
