import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ScriptStatus } from '../common/enums';
import type { Scene } from './scene.entity';

export interface ShootSchedule {
  start: string | null;
  end: string | null;
  hints: string[];
}

@Entity('scripts')
export class Script {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ name: 'production_company', type: 'varchar', length: 200 }) productionCompany: string;
  @Column({ name: 'file_name', type: 'varchar', length: 255 }) fileName: string;
  @Column({ name: 'file_path', type: 'varchar', length: 500 }) filePath: string;
  @Column({ name: 'file_type', type: 'varchar', length: 10 }) fileType: string;
  @Column({ name: 'file_size', type: 'int' }) fileSize: number;
  @Column({ name: 'shoot_start', type: 'date', nullable: true }) shootStart: string | null;
  @Column({ name: 'shoot_end', type: 'date', nullable: true }) shootEnd: string | null;
  @Column({ name: 'shoot_schedule', type: 'jsonb', nullable: true }) shootSchedule: ShootSchedule | null;
  @Column({ type: 'varchar', length: 20, default: ScriptStatus.UPLOADED }) status: ScriptStatus;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @Column({ name: 'analysis_model', type: 'varchar', length: 100, nullable: true }) analysisModel: string | null;
  @Column({ name: 'prompt_version', type: 'varchar', length: 50, nullable: true }) promptVersion: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;

  @OneToMany('Scene', 'script') scenes?: Scene[];
}
