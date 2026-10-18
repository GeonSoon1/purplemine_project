import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ScriptStatus } from '../common/enums';
import { MatchCandidate, Scene, Script, VehicleRequirement } from '../entities';
import { normalizeSchedule, RequirementDto, summarize, toRequirementDto, toSceneDto } from './analysis.mapper';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Script) private readonly scripts: Repository<Script>,
    @InjectRepository(Scene) private readonly scenes: Repository<Scene>,
    @InjectRepository(VehicleRequirement) private readonly reqs: Repository<VehicleRequirement>,
    @InjectRepository(MatchCandidate) private readonly candidates: Repository<MatchCandidate>,
  ) {}

  /** GET /scripts/:id/analysis */
  async getAnalysis(scriptId: string) {
    const script = await this.scripts.findOneBy({ id: scriptId });
    if (!script) throw new NotFoundException('대본을 찾을 수 없습니다.');

    const base = {
      scriptId: script.id,
      status: script.status,
      analysisModel: script.analysisModel,
      promptVersion: script.promptVersion,
      shootSchedule: normalizeSchedule(script.shootSchedule),
    };
    if (script.status !== ScriptStatus.ANALYZED) {
      return { ...base, summary: summarize([]), scenes: [] };
    }

    const scenes = await this.scenes.find({ where: { scriptId }, order: { sceneNo: 'ASC' } });
    const sceneIds = scenes.map((s) => s.id);
    const reqs = sceneIds.length
      ? await this.reqs.find({ where: { sceneId: In(sceneIds) }, order: { createdAt: 'ASC', id: 'ASC' } })
      : [];
    const dtos = await this.buildRequirementDtos(reqs, new Map(scenes.map((s) => [s.id, s.sceneNo])));

    const bySceneId = new Map<string, RequirementDto[]>();
    for (const d of dtos) bySceneId.set(d.sceneId, [...(bySceneId.get(d.sceneId) ?? []), d]);

    return {
      ...base,
      summary: summarize(dtos),
      scenes: scenes.map((s) => toSceneDto(s, bySceneId.get(s.id) ?? [])),
    };
  }

  /** 요구사항 1건의 응답 객체 (후보 포함). */
  async getRequirementDto(id: string): Promise<RequirementDto> {
    const req = await this.reqs.findOne({ where: { id }, relations: { scene: true } });
    if (!req) throw new NotFoundException('요구사항을 찾을 수 없습니다.');
    const [dto] = await this.buildRequirementDtos([req], new Map([[req.sceneId, req.scene!.sceneNo]]));
    return dto;
  }

  private async buildRequirementDtos(
    reqs: VehicleRequirement[],
    sceneNoById: Map<string, number>,
  ): Promise<RequirementDto[]> {
    if (!reqs.length) return [];
    const cands = await this.candidates.find({
      where: { requirementId: In(reqs.map((r) => r.id)) },
      relations: { vehicle: true },
      order: { rank: 'ASC' },
    });
    const byReq = new Map<string, MatchCandidate[]>();
    for (const c of cands) byReq.set(c.requirementId, [...(byReq.get(c.requirementId) ?? []), c]);
    return reqs.map((r) => toRequirementDto(r, sceneNoById.get(r.sceneId) ?? 0, byReq.get(r.id) ?? []));
  }
}
