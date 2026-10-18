import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AnalysisRunner } from '../analysis/analysis-runner.service';
import { ScriptStatus } from '../common/enums';
import { likePattern, Page, skipOf, toPage } from '../common/pagination';
import { Scene, Script, VehicleRequirement } from '../entities';
import { fileTypeOf, ScriptFileService } from '../files/script-file.service';
import { CreateScriptDto, ListScriptsQueryDto } from './dto';

export const toScriptDto = (s: Script, counts: { sceneCount: number; requirementCount: number }) => ({
  id: s.id,
  title: s.title,
  productionCompany: s.productionCompany,
  fileName: s.fileName,
  fileType: s.fileType,
  fileSize: s.fileSize,
  shootStart: s.shootStart,
  shootEnd: s.shootEnd,
  status: s.status,
  errorMessage: s.errorMessage,
  analysisModel: s.analysisModel,
  promptVersion: s.promptVersion,
  sceneCount: counts.sceneCount,
  requirementCount: counts.requirementCount,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});
export type ScriptDto = ReturnType<typeof toScriptDto>;

@Injectable()
export class ScriptsService {
  constructor(
    @InjectRepository(Script) private readonly scripts: Repository<Script>,
    @InjectRepository(Scene) private readonly scenes: Repository<Scene>,
    @InjectRepository(VehicleRequirement) private readonly reqs: Repository<VehicleRequirement>,
    private readonly files: ScriptFileService,
    private readonly runner: AnalysisRunner,
  ) {}

  /** 업로드 + 분석 시작. 분석은 응답 이후 백그라운드로 돈다. */
  async create(file: Express.Multer.File | undefined, dto: CreateScriptDto): Promise<ScriptDto> {
    if (!file) throw new BadRequestException('file 은 필수입니다.');
    if (dto.shootStart && dto.shootEnd && dto.shootEnd < dto.shootStart) {
      throw new BadRequestException('shootEnd 는 shootStart 이후여야 합니다.');
    }
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const fileType = fileTypeOf(originalName);
    const text = await this.files.extractText(file.buffer, fileType); // 읽을 수 없으면 저장 전에 400

    const filePath = await this.files.save(file.buffer, fileType);
    let script: Script;
    try {
      script = await this.scripts.save(
        this.scripts.create({
          title: dto.title,
          productionCompany: dto.productionCompany,
          fileName: originalName.slice(0, 255),
          filePath,
          fileType,
          fileSize: file.size,
          shootStart: dto.shootStart ?? null,
          shootEnd: dto.shootEnd ?? null,
          status: ScriptStatus.ANALYZING,
        }),
      );
    } catch (e) {
      await this.files.remove(filePath);
      throw e;
    }
    this.runner.start(script.id, text);
    return toScriptDto(script, { sceneCount: 0, requirementCount: 0 });
  }

  async list(q: ListScriptsQueryDto): Promise<Page<ScriptDto>> {
    const qb = this.scripts.createQueryBuilder('s');
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.q) {
      qb.andWhere(`(s.title ILIKE :like ESCAPE '\\' OR s.production_company ILIKE :like ESCAPE '\\')`, {
        like: likePattern(q.q),
      });
    }
    const [rows, total] = await qb
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'ASC')
      .skip(skipOf(q))
      .take(q.pageSize)
      .getManyAndCount();
    const counts = await this.countsFor(rows.map((r) => r.id));
    return toPage(
      rows.map((r) => toScriptDto(r, counts.get(r.id) ?? { sceneCount: 0, requirementCount: 0 })),
      q,
      total,
    );
  }

  async get(id: string): Promise<ScriptDto> {
    const script = await this.scripts.findOneBy({ id });
    if (!script) throw new NotFoundException('대본을 찾을 수 없습니다.');
    const counts = await this.countsFor([id]);
    return toScriptDto(script, counts.get(id) ?? { sceneCount: 0, requirementCount: 0 });
  }

  async remove(id: string): Promise<void> {
    const script = await this.scripts.findOneBy({ id });
    if (!script) throw new NotFoundException('대본을 찾을 수 없습니다.');
    if (script.status === ScriptStatus.ANALYZING) {
      throw new ConflictException('분석 중인 대본은 삭제할 수 없습니다. 분석이 끝난 뒤 다시 시도하세요.');
    }
    // 조건부 삭제: 그 사이 재분석이 시작됐다면 지우지 않는다.
    const res = await this.scripts
      .createQueryBuilder()
      .delete()
      .where('id = :id AND status <> :s', { id, s: ScriptStatus.ANALYZING })
      .execute();
    if (!res.affected) throw new ConflictException('분석 중인 대본은 삭제할 수 없습니다.');
    await this.files.remove(script.filePath);
  }

  async reanalyze(id: string): Promise<ScriptDto> {
    if (!(await this.scripts.existsBy({ id }))) throw new NotFoundException('대본을 찾을 수 없습니다.');
    if (!(await this.runner.claim(id))) throw new ConflictException('이미 분석 중인 대본입니다.');
    this.runner.start(id);
    return this.get(id);
  }

  private async countsFor(ids: string[]): Promise<Map<string, { sceneCount: number; requirementCount: number }>> {
    const out = new Map<string, { sceneCount: number; requirementCount: number }>();
    if (!ids.length) return out;
    const sceneRows = await this.scenes
      .createQueryBuilder('sc')
      .select('sc.script_id', 'scriptId')
      .addSelect('COUNT(*)', 'n')
      .where({ scriptId: In(ids) })
      .groupBy('sc.script_id')
      .getRawMany<{ scriptId: string; n: string }>();
    const reqRows = await this.reqs
      .createQueryBuilder('r')
      .innerJoin(Scene, 'sc', 'sc.id = r.scene_id')
      .select('sc.script_id', 'scriptId')
      .addSelect('COUNT(*)', 'n')
      .where('sc.script_id IN (:...ids)', { ids })
      .groupBy('sc.script_id')
      .getRawMany<{ scriptId: string; n: string }>();
    for (const id of ids) out.set(id, { sceneCount: 0, requirementCount: 0 });
    for (const r of sceneRows) out.get(r.scriptId)!.sceneCount = Number(r.n);
    for (const r of reqRows) out.get(r.scriptId)!.requirementCount = Number(r.n);
    return out;
  }
}
