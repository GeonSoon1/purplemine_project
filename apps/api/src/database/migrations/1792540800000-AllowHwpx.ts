import { MigrationInterface, QueryRunner } from 'typeorm';

/** 대본 파일 형식에 hwpx 추가 (scripts.file_type CHECK 확장). */
export class AllowHwpx1792540800000 implements MigrationInterface {
  name = 'AllowHwpx1792540800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE scripts DROP CONSTRAINT scripts_file_type_chk`);
    await q.query(
      `ALTER TABLE scripts ADD CONSTRAINT scripts_file_type_chk CHECK (file_type IN ('txt','pdf','docx','hwpx'))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // hwpx 대본이 남아 있으면 아래 제약 추가가 실패해 되돌리기가 중단된다 (데이터는 지우지 않는다)
    await q.query(`ALTER TABLE scripts DROP CONSTRAINT scripts_file_type_chk`);
    await q.query(`ALTER TABLE scripts ADD CONSTRAINT scripts_file_type_chk CHECK (file_type IN ('txt','pdf','docx'))`);
  }
}
