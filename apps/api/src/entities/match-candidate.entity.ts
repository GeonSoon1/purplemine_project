import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { VehicleRequirement } from './vehicle-requirement.entity';
import { Vehicle } from './vehicle.entity';

@Entity('match_candidates')
export class MatchCandidate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'requirement_id', type: 'uuid' }) requirementId: string;
  @Column({ name: 'vehicle_id', type: 'uuid' }) vehicleId: string;
  @Column({ type: 'int', default: 0 }) score: number;
  @Column({ type: 'text', default: '' }) reason: string;
  @Column({ name: 'rank', type: 'int' }) rank: number;
  @Column({ name: 'is_selected', type: 'boolean', default: false }) isSelected: boolean;

  @ManyToOne(() => VehicleRequirement, (r) => r.candidates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requirement_id' })
  requirement?: VehicleRequirement;

  @ManyToOne(() => Vehicle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle?: Vehicle;
}
