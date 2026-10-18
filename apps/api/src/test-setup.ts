import { Logger } from '@nestjs/common';

// 테스트 출력 정리: 의도된 실패 경로의 Nest 로그를 끈다.
Logger.overrideLogger(false);
