import { VehicleCategory } from '../common/enums';
import { generateDescription } from './vehicles.service';

describe('generateDescription', () => {
  it('브랜드 모델 연식 색상 분류로 설명 생성', () => {
    expect(generateDescription({ brand: '제네시스', model: 'G90', year: 2023, color: '검정', category: VehicleCategory.SEDAN })).toBe(
      '제네시스 G90 2023년식 검정 세단',
    );
  });
  it('색상이 없으면 생략', () => {
    expect(generateDescription({ brand: '기아', model: '모닝', year: 2022, color: null, category: VehicleCategory.COMPACT })).toBe(
      '기아 모닝 2022년식 경차',
    );
  });
});

describe('VehiclesService 임베딩 연동', () => {
  const { VehiclesService } = jest.requireActual('./vehicles.service') as typeof import('./vehicles.service');
  const dto = { plateNo: '12하 3456', brand: '기아', model: '모닝', year: 2022, category: VehicleCategory.COMPACT, dailyRate: 60000 };

  function setup(embedOk: boolean) {
    const repo = {
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => ({ id: 'v1', createdAt: new Date(), updatedAt: new Date(), ...x })),
      findOneBy: jest.fn(),
    };
    const embeddings = { embedVehicle: jest.fn().mockResolvedValue(embedOk), clear: jest.fn() };
    return { svc: new VehiclesService(repo as never, {} as never, embeddings as never), repo, embeddings };
  }

  it('등록: 임베딩 실패여도 차량은 저장/반환된다', async () => {
    const { svc, embeddings } = setup(false);
    const out = await svc.create(dto);
    expect(out.id).toBe('v1');
    expect(embeddings.embedVehicle).toHaveBeenCalledTimes(1);
  });

  it('수정: description 이 바뀌면 낡은 임베딩 제거 후 재임베딩, 안 바뀌면 호출 안 함', async () => {
    const { svc, repo, embeddings } = setup(true);
    const base = { id: 'v1', ...dto, color: null, seats: null, damageAllowed: false, status: 'AVAILABLE', description: '직접 쓴 설명' };
    repo.findOneBy.mockResolvedValue({ ...base });
    await svc.update('v1', { dailyRate: 70000 });
    expect(embeddings.embedVehicle).not.toHaveBeenCalled();

    repo.findOneBy.mockResolvedValue({ ...base });
    await svc.update('v1', { description: '새 설명' });
    expect(embeddings.clear).toHaveBeenCalledWith('v1');
    expect(embeddings.embedVehicle).toHaveBeenCalledTimes(1);
  });
});
