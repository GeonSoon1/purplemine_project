import { ScriptStatus } from '../common/enums';
import { BadRequestException } from '@nestjs/common';
import { LlmClientError } from '../llm/llm.client';
import type { LlmAnalyzeResponse } from '../llm/llm.types';
import { AnalysisRunner, RESTART_FAILED_MESSAGE } from './analysis-runner.service';

const llmResult: LlmAnalyzeResponse = {
  scriptId: 's1',
  model: 'mock-rule-v1',
  promptVersion: 'v1',
  shootSchedule: { start: '2026-11-03', end: null, hints: ['힌트'] },
  scenes: [
    {
      sceneNo: 1, location: '도로', timeOfDay: 'DAY', summary: 's', sourceText: 'x', shootDateHint: null,
      vehicles: [
        { role: 'LEAD', vehicleType: '세단', categoryHint: 'SEDAN', brandModelHint: null, quantity: 1, usage: 'NORMAL', damageExpected: false, sourceQuote: null, confidence: 0.9 },
      ],
    },
  ],
};

function setup(opts: { analyze?: jest.Mock; script?: object | null } = {}) {
  const em = { delete: jest.fn(), insert: jest.fn(), update: jest.fn() };
  const dataSource = { transaction: jest.fn(async (fn: (m: typeof em) => Promise<unknown>) => fn(em)) };
  const scripts = {
    findOneBy: jest.fn().mockResolvedValue(
      opts.script === undefined
        ? { id: 's1', filePath: '/x.txt', fileType: 'txt', shootStart: '2026-11-03', shootEnd: null }
        : opts.script,
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const matcher = {
    matchMany: jest.fn(async (reqs: unknown[]) =>
      reqs.map(() => ({ source: 'rag', results: [{ vehicleId: 'v1', score: 80, reason: 'r', rank: 1 }] })),
    ),
  };
  const files = { readText: jest.fn().mockResolvedValue('S#1. a / 낮') };
  const llm = { analyze: opts.analyze ?? jest.fn().mockResolvedValue(llmResult) };
  const runner = new AnalysisRunner(dataSource as never, scripts as never, files as never, llm as never, matcher as never);
  return { runner, em, dataSource, scripts, matcher, files, llm };
}

describe('AnalysisRunner', () => {
  it('성공: LLM 결과를 한 트랜잭션으로 저장하고 ANALYZED + 모델/프롬프트/일정을 기록', async () => {
    const { runner, em, dataSource, llm, scripts, matcher } = setup();
    await runner.run('s1');

    expect(llm.analyze).toHaveBeenCalledWith({
      scriptId: 's1',
      text: 'S#1. a / 낮',
      hints: { shootStart: '2026-11-03', shootEnd: null },
    });
    expect(matcher.matchMany).toHaveBeenCalledTimes(1);
    // 후보 산정(외부 HTTP)은 트랜잭션보다 먼저 끝나 있어야 한다.
    expect(matcher.matchMany.mock.invocationCallOrder[0]).toBeLessThan(dataSource.transaction.mock.invocationCallOrder[0]);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(em.delete).toHaveBeenCalledTimes(1); // 기존 씬 제거
    expect(em.insert).toHaveBeenCalledTimes(3); // scenes, requirements, candidates
    const [, scriptId, patch] = em.update.mock.calls[0];
    expect(scriptId).toBe('s1');
    expect(patch).toEqual({
      status: ScriptStatus.ANALYZED,
      errorMessage: null,
      analysisModel: 'mock-rule-v1',
      promptVersion: 'v1',
      shootSchedule: llmResult.shootSchedule,
    });
    expect(scripts.update).not.toHaveBeenCalled();
  });

  it('업로드 시 이미 추출한 텍스트가 있으면 파일을 다시 읽지 않는다', async () => {
    const { runner, files, llm } = setup();
    await runner.run('s1', '본문');
    expect(files.readText).not.toHaveBeenCalled();
    expect(llm.analyze).toHaveBeenCalledWith(expect.objectContaining({ text: '본문' }));
  });

  it('촬영 기간 힌트가 없으면 hints 는 null', async () => {
    const { runner, llm } = setup({ script: { id: 's1', filePath: '/x', fileType: 'txt', shootStart: null, shootEnd: null } });
    await runner.run('s1', 't');
    expect(llm.analyze).toHaveBeenCalledWith(expect.objectContaining({ hints: null }));
  });

  it('LLM 실패: FAILED + 사용자용 errorMessage, 저장은 하지 않음', async () => {
    const { runner, dataSource, scripts } = setup({ analyze: jest.fn().mockRejectedValue(new LlmClientError('LLM 서버 오류 (HTTP 502).')) });
    await runner.run('s1');
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(scripts.update).toHaveBeenCalledWith('s1', { status: ScriptStatus.FAILED, errorMessage: 'LLM 서버 오류 (HTTP 502).' });
  });

  it('알 수 없는 오류는 내부 메시지를 노출하지 않는다', async () => {
    const { runner, scripts } = setup({ analyze: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1')) });
    await runner.run('s1');
    expect(scripts.update).toHaveBeenCalledWith('s1', { status: ScriptStatus.FAILED, errorMessage: '분석 중 오류가 발생했습니다.' });
  });

  it('파일 읽기 오류(HttpException)는 메시지를 그대로 기록', async () => {
    const { runner, files, scripts } = setup();
    files.readText.mockRejectedValue(new BadRequestException('파일에 읽을 수 있는 텍스트가 없습니다.'));
    await runner.run('s1');
    expect(scripts.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'FAILED', errorMessage: '파일에 읽을 수 있는 텍스트가 없습니다.' }));
  });

  it('저장 트랜잭션이 실패하면 FAILED', async () => {
    const { runner, dataSource, scripts } = setup();
    dataSource.transaction.mockRejectedValue(new Error('duplicate key'));
    await runner.run('s1');
    expect(scripts.update).toHaveBeenCalledWith('s1', { status: ScriptStatus.FAILED, errorMessage: '분석 중 오류가 발생했습니다.' });
  });

  it('대본이 이미 삭제되었으면 아무것도 하지 않는다', async () => {
    const { runner, llm } = setup({ script: null });
    await runner.run('s1');
    expect(llm.analyze).not.toHaveBeenCalled();
  });

  it('서버 시작 시 ANALYZING 으로 남은 건을 FAILED 처리', async () => {
    const { runner, scripts } = setup();
    await runner.onApplicationBootstrap();
    expect(scripts.update).toHaveBeenCalledWith(
      { status: ScriptStatus.ANALYZING },
      { status: ScriptStatus.FAILED, errorMessage: RESTART_FAILED_MESSAGE },
    );
  });
});
