import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 초기 스키마. docs/planning/erd.md + docs/api 명세 기준.
 * - enum 은 varchar + CHECK (값 추가 시 마이그레이션이 간단)
 * - FK 컬럼은 전부 인덱스 (스키마 규칙: FK 인덱스)
 * - 금액은 numeric(14,0) (원 단위 정수)
 */
export class InitSchema1792368000000 implements MigrationInterface {
  name = 'InitSchema1792368000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await q.query(`
      CREATE TABLE scripts (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title              varchar(200) NOT NULL,
        production_company varchar(200) NOT NULL,
        file_name          varchar(255) NOT NULL,
        file_path          varchar(500) NOT NULL,
        file_type          varchar(10)  NOT NULL,
        file_size          integer      NOT NULL,
        shoot_start        date,
        shoot_end          date,
        shoot_schedule     jsonb,
        status             varchar(20)  NOT NULL DEFAULT 'UPLOADED',
        error_message      text,
        analysis_model     varchar(100),
        prompt_version     varchar(50),
        created_at         timestamptz  NOT NULL DEFAULT now(),
        updated_at         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT scripts_status_chk CHECK (status IN ('UPLOADED','ANALYZING','ANALYZED','FAILED')),
        CONSTRAINT scripts_file_type_chk CHECK (file_type IN ('txt','pdf','docx')),
        CONSTRAINT scripts_shoot_range_chk CHECK (shoot_start IS NULL OR shoot_end IS NULL OR shoot_end >= shoot_start)
      )`);
    await q.query(`CREATE INDEX idx_scripts_created_at ON scripts (created_at DESC)`);
    await q.query(`CREATE INDEX idx_scripts_status ON scripts (status)`);

    await q.query(`
      CREATE TABLE scenes (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_id       uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
        scene_no        integer NOT NULL,
        location        varchar(200),
        time_of_day     varchar(10) NOT NULL DEFAULT 'UNKNOWN',
        summary         text,
        source_text     text NOT NULL DEFAULT '',
        shoot_date_hint date,
        CONSTRAINT scenes_time_of_day_chk CHECK (time_of_day IN ('DAY','NIGHT','DAWN','DUSK','UNKNOWN')),
        CONSTRAINT scenes_script_scene_no_uq UNIQUE (script_id, scene_no)
      )`);
    // UNIQUE (script_id, scene_no) 가 script_id FK 인덱스를 겸한다.

    await q.query(`
      CREATE TABLE vehicle_requirements (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scene_id          uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        role              varchar(12) NOT NULL,
        vehicle_type      varchar(100) NOT NULL,
        category_hint     varchar(10),
        brand_model_hint  varchar(100),
        quantity          integer NOT NULL DEFAULT 1,
        "usage"           varchar(10) NOT NULL DEFAULT 'NORMAL',
        damage_expected   boolean NOT NULL DEFAULT false,
        source_quote      text,
        confidence        real,
        is_user_edited    boolean NOT NULL DEFAULT false,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vreq_role_chk CHECK (role IN ('LEAD','SUPPORT','BACKGROUND')),
        CONSTRAINT vreq_usage_chk CHECK ("usage" IN ('NORMAL','CHASE','ACTION','DAMAGE')),
        CONSTRAINT vreq_category_chk CHECK (category_hint IS NULL OR category_hint IN
          ('COMPACT','SEDAN','SUV','VAN','TRUCK','SPORTS','CLASSIC','OTHER')),
        CONSTRAINT vreq_quantity_chk CHECK (quantity >= 1),
        CONSTRAINT vreq_confidence_chk CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
      )`);
    await q.query(`CREATE INDEX idx_vreq_scene_id ON vehicle_requirements (scene_id)`);

    await q.query(`
      CREATE TABLE vehicles (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plate_no     varchar(20) NOT NULL,
        brand        varchar(50) NOT NULL,
        model        varchar(100) NOT NULL,
        year         smallint NOT NULL,
        category     varchar(10) NOT NULL,
        color        varchar(30),
        seats        smallint,
        daily_rate   numeric(12,0) NOT NULL,
        damage_allowed boolean NOT NULL DEFAULT false,
        status       varchar(12) NOT NULL DEFAULT 'AVAILABLE',
        description  text NOT NULL DEFAULT '',
        embedding    vector(1536),
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vehicles_plate_no_uq UNIQUE (plate_no),
        CONSTRAINT vehicles_category_chk CHECK (category IN
          ('COMPACT','SEDAN','SUV','VAN','TRUCK','SPORTS','CLASSIC','OTHER')),
        CONSTRAINT vehicles_status_chk CHECK (status IN ('AVAILABLE','MAINTENANCE','INACTIVE')),
        CONSTRAINT vehicles_rate_chk CHECK (daily_rate >= 0)
      )`);
    await q.query(`CREATE INDEX idx_vehicles_category_status ON vehicles (category, status)`);
    await q.query(`CREATE INDEX idx_vehicles_embedding_hnsw ON vehicles USING hnsw (embedding vector_cosine_ops)`);

    await q.query(`
      CREATE TABLE match_candidates (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        requirement_id uuid NOT NULL REFERENCES vehicle_requirements(id) ON DELETE CASCADE,
        vehicle_id     uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        score          integer NOT NULL DEFAULT 0,
        reason         text NOT NULL DEFAULT '',
        "rank"         integer NOT NULL,
        is_selected    boolean NOT NULL DEFAULT false,
        CONSTRAINT match_candidates_req_vehicle_uq UNIQUE (requirement_id, vehicle_id),
        CONSTRAINT match_candidates_score_chk CHECK (score BETWEEN 0 AND 100)
      )`);
    await q.query(`CREATE INDEX idx_match_candidates_vehicle_id ON match_candidates (vehicle_id)`);

    await q.query(`
      CREATE TABLE quotes (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        script_id          uuid REFERENCES scripts(id) ON DELETE SET NULL,
        quote_no           varchar(20) NOT NULL,
        version            integer NOT NULL DEFAULT 1,
        status             varchar(10) NOT NULL DEFAULT 'DRAFT',
        title              varchar(200) NOT NULL,
        production_company varchar(200) NOT NULL,
        period_start       date,
        period_end         date,
        supply_amount      numeric(14,0) NOT NULL DEFAULT 0,
        tax_amount         numeric(14,0) NOT NULL DEFAULT 0,
        total_amount       numeric(14,0) NOT NULL DEFAULT 0,
        author             varchar(100),
        valid_until        date,
        memo               text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT quotes_no_version_uq UNIQUE (quote_no, version),
        CONSTRAINT quotes_status_chk CHECK (status IN ('DRAFT','REVIEW','SENT','CONFIRMED')),
        CONSTRAINT quotes_period_chk CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
      )`);
    await q.query(`CREATE INDEX idx_quotes_script_id ON quotes (script_id)`);
    await q.query(`CREATE INDEX idx_quotes_created_at ON quotes (created_at DESC)`);

    // vehicle_id: 견적서에 쓰인 차량은 삭제 불가 (RESTRICT). 앱에서 409 로 변환.
    await q.query(`
      CREATE TABLE quote_items (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        vehicle_id      uuid REFERENCES vehicles(id) ON DELETE RESTRICT,
        requirement_id  uuid REFERENCES vehicle_requirements(id) ON DELETE SET NULL,
        position        integer NOT NULL DEFAULT 0,
        label           varchar(200),
        role            varchar(12),
        "usage"         varchar(10),
        damage_expected boolean NOT NULL DEFAULT false,
        scene_nos       integer[] NOT NULL DEFAULT '{}',
        quantity        integer NOT NULL DEFAULT 1,
        start_date      date,
        end_date        date,
        days            integer,
        unit_price      numeric(12,0) NOT NULL DEFAULT 0,
        extra_amount    numeric(12,0) NOT NULL DEFAULT 0,
        subtotal        numeric(14,0) NOT NULL DEFAULT 0,
        memo            text,
        CONSTRAINT quote_items_role_chk CHECK (role IS NULL OR role IN ('LEAD','SUPPORT','BACKGROUND')),
        CONSTRAINT quote_items_usage_chk CHECK ("usage" IS NULL OR "usage" IN ('NORMAL','CHASE','ACTION','DAMAGE')),
        CONSTRAINT quote_items_quantity_chk CHECK (quantity >= 1),
        CONSTRAINT quote_items_dates_chk CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
      )`);
    await q.query(`CREATE INDEX idx_quote_items_quote_id ON quote_items (quote_id, position)`);
    await q.query(`CREATE INDEX idx_quote_items_vehicle_id ON quote_items (vehicle_id)`);
    await q.query(`CREATE INDEX idx_quote_items_requirement_id ON quote_items (requirement_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS quote_items`);
    await q.query(`DROP TABLE IF EXISTS quotes`);
    await q.query(`DROP TABLE IF EXISTS match_candidates`);
    await q.query(`DROP TABLE IF EXISTS vehicles`);
    await q.query(`DROP TABLE IF EXISTS vehicle_requirements`);
    await q.query(`DROP TABLE IF EXISTS scenes`);
    await q.query(`DROP TABLE IF EXISTS scripts`);
  }
}
