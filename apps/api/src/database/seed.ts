import 'reflect-metadata';
import dataSource from './data-source';
import { Vehicle } from '../entities';
import { VehicleCategory as C } from '../common/enums';
import { runEmbedBackfill } from './embed-backfill';
import { generateDescription } from '../vehicles/vehicles.service';

/** 개발용 가짜 보유 차량. 번호판은 임의 값(실존 차량 아님). npm run seed — 여러 번 돌려도 안전(번호판 중복 무시). */
type Row = [brand: string, model: string, year: number, category: C, color: string, seats: number, rate: number, damage: boolean];

const ROWS: Row[] = [
  // 경차
  ['기아', '모닝', 2022, C.COMPACT, '흰색', 5, 60000, true],
  ['기아', '모닝', 2021, C.COMPACT, '노랑', 5, 58000, true],
  ['기아', '레이', 2023, C.COMPACT, '은색', 5, 70000, true],
  ['현대', '캐스퍼', 2023, C.COMPACT, '주황', 4, 75000, false],
  // 세단
  ['제네시스', 'G90', 2023, C.SEDAN, '검정', 5, 220000, false],
  ['제네시스', 'G90', 2022, C.SEDAN, '흰색', 5, 210000, false],
  ['제네시스', 'G80', 2023, C.SEDAN, '검정', 5, 180000, false],
  ['제네시스', 'G70', 2022, C.SEDAN, '회색', 5, 150000, true],
  ['현대', '그랜저', 2023, C.SEDAN, '검정', 5, 130000, true],
  ['현대', '그랜저', 2021, C.SEDAN, '은색', 5, 110000, true],
  ['현대', '쏘나타', 2022, C.SEDAN, '흰색', 5, 90000, true],
  ['현대', '쏘나타', 2020, C.SEDAN, '검정', 5, 80000, true],
  ['현대', '아반떼', 2023, C.SEDAN, '회색', 5, 70000, true],
  ['기아', 'K5', 2022, C.SEDAN, '흰색', 5, 85000, true],
  ['기아', 'K8', 2023, C.SEDAN, '검정', 5, 140000, true],
  ['벤츠', 'E-Class', 2022, C.SEDAN, '검정', 5, 280000, false],
  ['BMW', '520i', 2022, C.SEDAN, '파랑', 5, 260000, false],
  // SUV
  ['현대', '팰리세이드', 2023, C.SUV, '검정', 7, 160000, true],
  ['현대', '싼타페', 2022, C.SUV, '흰색', 7, 120000, true],
  ['현대', '투싼', 2022, C.SUV, '회색', 5, 100000, true],
  ['기아', '쏘렌토', 2023, C.SUV, '검정', 7, 125000, true],
  ['기아', '스포티지', 2022, C.SUV, '은색', 5, 100000, true],
  ['제네시스', 'GV80', 2023, C.SUV, '검정', 5, 230000, false],
  ['쌍용', '렉스턴', 2020, C.SUV, '흰색', 7, 95000, true],
  // 승합
  ['기아', '카니발', 2023, C.VAN, '검정', 9, 150000, true],
  ['기아', '카니발', 2021, C.VAN, '흰색', 9, 120000, true],
  ['현대', '스타렉스', 2021, C.VAN, '흰색', 12, 110000, true],
  ['현대', '쏠라티', 2022, C.VAN, '흰색', 15, 190000, true],
  // 트럭
  ['현대', '포터', 2022, C.TRUCK, '흰색', 3, 80000, true],
  ['기아', '봉고', 2021, C.TRUCK, '파랑', 3, 78000, true],
  ['현대', '마이티', 2019, C.TRUCK, '흰색', 3, 150000, true],
  // 스포츠
  ['포르쉐', '911', 2021, C.SPORTS, '빨강', 2, 650000, false],
  ['쉐보레', '카마로', 2019, C.SPORTS, '노랑', 4, 380000, false],
  ['현대', '벨로스터 N', 2020, C.SPORTS, '파랑', 4, 170000, true],
  // 클래식
  ['현대', '포니', 1982, C.CLASSIC, '하늘색', 5, 300000, false],
  ['기아', '브리사', 1978, C.CLASSIC, '갈색', 5, 280000, false],
  ['대우', '르망', 1993, C.CLASSIC, '은색', 5, 120000, true],
  ['쌍용', '코란도', 1996, C.CLASSIC, '초록', 5, 130000, true],
  // 기타
  ['현대', '카운티 구급차', 2018, C.OTHER, '흰색', 10, 140000, true],
  ['현대', '에어로 버스', 2017, C.OTHER, '흰색', 45, 350000, true],
];

const RENTAL_HANGUL = ['하', '허', '호'];

/** 렌터카 형식 "NN하 NNNN". 시드 순번 기반으로 결정적 생성(재실행해도 동일). */
const plateOf = (i: number): string => {
  const head = 10 + ((i * 7) % 90);
  const tail = 1000 + ((i * 7919) % 9000);
  return `${head}${RENTAL_HANGUL[i % 3]} ${tail}`;
};

async function main() {
  await dataSource.initialize();
  const repo = dataSource.getRepository(Vehicle);
  const rows = ROWS.map(([brand, model, year, category, color, seats, dailyRate, damageAllowed], i) => {
    const v = repo.create({
      plateNo: plateOf(i),
      brand,
      model,
      year,
      category,
      color,
      seats,
      dailyRate,
      damageAllowed,
      // 정비중 2대
      status: i === 9 || i === 29 ? 'MAINTENANCE' : 'AVAILABLE',
    });
    v.description = generateDescription(v);
    return v;
  });
  const res = await repo.createQueryBuilder().insert().values(rows).orIgnore().execute();
  const total = await repo.count();
  console.log(`seed: ${rows.length}대 중 ${res.raw.length}대 추가, 전체 ${total}대`);
  if (process.argv.includes('--embed')) {
    try {
      await runEmbedBackfill();
    } catch (e) {
      console.warn(`임베딩 실패(차량은 저장됨, 나중에 npm run embed:backfill): ${(e as Error).message}`);
    }
  } else {
    console.log('임베딩(RAG 매칭용)은 LLM 서버를 띄운 뒤 `npm run embed:backfill` (또는 `npm run seed -- --embed`)로 채우세요.');
  }
  await dataSource.destroy();
}

main().catch(async (e) => {
  console.error(e);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
