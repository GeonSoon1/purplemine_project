import { MatchCandidate } from './match-candidate.entity';
import { QuoteItem } from './quote-item.entity';
import { Quote } from './quote.entity';
import { Scene } from './scene.entity';
import { Script } from './script.entity';
import { VehicleRequirement } from './vehicle-requirement.entity';
import { Vehicle } from './vehicle.entity';

export type { ShootSchedule } from './script.entity';
export { MatchCandidate, QuoteItem, Quote, Scene, Script, VehicleRequirement, Vehicle };
export const ALL_ENTITIES = [Script, Scene, VehicleRequirement, Vehicle, MatchCandidate, Quote, QuoteItem];
