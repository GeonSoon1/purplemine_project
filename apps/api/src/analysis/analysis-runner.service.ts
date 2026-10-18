import { HttpException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ScriptStatus } from '../common/enums';
import { MatchCandidate, Scene, Script, VehicleRequirement } from '../entities';
import { ScriptFileService } from '../files/script-file.service';
import { LlmClient, LlmClientError } from '../llm/llm.client';
import type { LlmAnalyzeResponse } from '../llm/llm.types';
import { CandidateMatcher } from '../matching/candidate-matcher.service';
import { buildCandidates, buildStructure, CandidatesByRequirement } from './analysis-rows';

const CHUNK = 500;
const chunks = <T>(arr: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const RESTART_FAILED_MESSAGE = '서버가 재시작되어 분석이 중단되었습니다. 다시 분석해 주세요.';

/** 백그라운드 분석: LLM 서버 호출 → 씬/요구사항/후보를 한 트랜잭션으로 저장. */
@Injectable()
export class AnalysisRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnalysisRunner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Script) private readonly scripts: Repository<Script>,
    private readonly files: ScriptFileService,
    private readonly llm: LlmClient,
    private readonly matcher: CandidateMatcher,
  ) {}

  /** 서버가 죽으면서 ANALYZING 으로 남은 건은 영원히 끝나지 않으므로 FAILED 처리. */
  async onApplicationBootstrap(): Promise<void> {
    const res = await this.scripts.update(
      { status: ScriptStatus.ANALYZING },
      { status: ScriptStatus.FAILED, errorMessage: RESTART_FAILED_MESSAGE },
    );
    if (res.affected) this.logger.warn(`중단된 분석 ${res.affected}건을 FAILED 로 전환했습니다.`);
  }

  /**
   * 재분석 시작: ANALYZING 이 아닐 때만 원자적으로 ANALYZING 으로 바꾸고 기존 씬을 지운다.
   * 이미 분석 중이면 false.
   */
  async claim(scriptId: string): Promise<boolean> {
    return this.dataSource.transaction(async (em) => {
      const res = await em
        .createQueryBuilder()
        .update(Script)
        .set({ status: ScriptStatus.ANALYZING, errorMessage: null })
        .where('id = :id AND status <> :s', { id: scriptId, s: ScriptStatus.ANALYZING })
        .execute();
      if (!res.affected) return false;
      await em.delete(Scene, { scriptId });
      return true;
    });
  }

  /** fire-and-forget. 호출자는 이미 status=ANALYZING 으로 만들어 둔 상태여야 한다. */
  start(scriptId: string, text?: string): void {
    void this.run(scriptId, text).catch((e) => this.logger.error(`분석 실행기 오류: ${(e as Error).stack}`));
  }

  async run(scriptId: string, text?: string): Promise<void> {
    try {
      const script = await this.scripts.findOneBy({ id: scriptId });
      if (!script) return;
      const body = text ?? (await this.files.readText(script.filePath, script.fileType));
      const hints =
        script.shootStart || script.shootEnd ? { shootStart: script.shootStart, shootEnd: script.shootEnd } : null;
      const result = await this.llm.analyze({ scriptId, text: body, hints });
      await this.saveResult(scriptId, result);
    } catch (e) {
      await this.markFailed(scriptId, e);
    }
  }

  async saveResult(scriptId: string, result: LlmAnalyzeResponse): Promise<void> {
    const rows = buildStructure(scriptId, result);
    // 후보 산정(LLM /match 등 외부 HTTP)은 트랜잭션을 잡기 전에 끝낸다.
    const outcomes = await this.matcher.matchMany(rows.requirements);
    const byReq: CandidatesByRequirement = new Map(rows.requirements.map((r, i) => [r.id, outcomes[i].results]));
    rows.candidates = buildCandidates(rows.requirements, byReq);

    await this.dataSource.transaction(async (em) => {
      await em.delete(Scene, { scriptId });
      for (const c of chunks(rows.scenes)) await em.insert(Scene, c);
      for (const c of chunks(rows.requirements)) await em.insert(VehicleRequirement, c);
      for (const c of chunks(rows.candidates)) await em.insert(MatchCandidate, c);
      await em.update(Script, scriptId, {
        status: ScriptStatus.ANALYZED,
        errorMessage: null,
        analysisModel: result.model,
        promptVersion: result.promptVersion,
        shootSchedule: result.shootSchedule,
      });
    });
  }

  private async markFailed(scriptId: string, e: unknown): Promise<void> {
    const known = e instanceof LlmClientError || e instanceof HttpException;
    const message = known ? e.message : '분석 중 오류가 발생했습니다.';
    if (!known) {
      this.logger.error(`분석 실패(${scriptId}): ${(e as Error).stack ?? e}`);
    }
    try {
      await this.scripts.update(scriptId, { status: ScriptStatus.FAILED, errorMessage: message.slice(0, 500) });
    } catch (err) {
      this.logger.error(`FAILED 상태 기록 실패(${scriptId}): ${(err as Error).message}`);
    }
  }
}
