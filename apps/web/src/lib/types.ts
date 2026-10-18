// docs/api/ 명세의 응답 형태. 필드명은 명세 그대로(camelCase).

export type ScriptStatus = 'UPLOADED' | 'ANALYZING' | 'ANALYZED' | 'FAILED';
export type TimeOfDay = 'DAY' | 'NIGHT' | 'DAWN' | 'DUSK' | 'UNKNOWN';
export type Role = 'LEAD' | 'SUPPORT' | 'BACKGROUND';
export type Usage = 'NORMAL' | 'CHASE' | 'ACTION' | 'DAMAGE';
export type VehicleCategory =
  | 'COMPACT'
  | 'SEDAN'
  | 'SUV'
  | 'VAN'
  | 'TRUCK'
  | 'SPORTS'
  | 'CLASSIC'
  | 'OTHER';
export type VehicleStatus = 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';
export type QuoteStatus = 'DRAFT' | 'REVIEW' | 'SENT' | 'CONFIRMED';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Script {
  id: string;
  title: string;
  productionCompany: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  shootStart: string | null;
  shootEnd: string | null;
  status: ScriptStatus;
  errorMessage: string | null;
  analysisModel: string | null;
  promptVersion: string | null;
  sceneCount: number;
  requirementCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  plateNo: string;
  brand: string;
  model: string;
  year: number;
  category: VehicleCategory;
  color: string | null;
  seats: number | null;
  dailyRate: number;
  damageAllowed: boolean;
  status: VehicleStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 후보에 붙는 차량 요약 (Vehicle의 일부) */
export type CandidateVehicle = Pick<
  Vehicle,
  'id' | 'plateNo' | 'brand' | 'model' | 'year' | 'category' | 'color' | 'dailyRate' | 'damageAllowed'
>;

export interface Candidate {
  id: string;
  vehicleId: string;
  score: number;
  reason: string;
  rank: number;
  isSelected: boolean;
  vehicle: CandidateVehicle;
}

export interface Requirement {
  id: string;
  sceneId: string;
  sceneNo: number;
  role: Role;
  vehicleType: string;
  categoryHint: VehicleCategory | null;
  brandModelHint: string | null;
  quantity: number;
  usage: Usage;
  damageExpected: boolean;
  sourceQuote: string | null;
  confidence: number | null;
  isUserEdited: boolean;
  selectedCount: number;
  candidates: Candidate[];
  /** PATCH 응답에만 붙는다 */
  candidatesStale?: boolean;
}

export interface Scene {
  id: string;
  sceneNo: number;
  location: string | null;
  timeOfDay: TimeOfDay;
  summary: string | null;
  sourceText: string | null;
  shootDateHint: string | null;
  requirements: Requirement[];
}

export interface Analysis {
  scriptId: string;
  status: ScriptStatus;
  analysisModel: string | null;
  promptVersion: string | null;
  shootSchedule: { start: string | null; end: string | null; hints: string[] };
  summary: {
    requirementCount: number;
    selectedCount: number;
    noCandidateCount: number;
    pendingCount: number;
  };
  scenes: Scene[];
}

export interface QuoteItemVehicle {
  plateNo: string;
  brand: string;
  model: string;
  year: number;
  color: string | null;
  category: VehicleCategory;
}

export interface QuoteItem {
  id: string;
  vehicleId: string | null;
  requirementId: string | null;
  vehicle: QuoteItemVehicle | null;
  label: string | null;
  role: Role | null;
  usage: Usage | null;
  damageExpected: boolean;
  sceneNos: number[];
  quantity: number;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  unitPrice: number;
  extraAmount: number;
  subtotal: number;
  memo: string | null;
}

export interface Quote {
  id: string;
  quoteNo: string;
  version: number;
  isLatest: boolean;
  status: QuoteStatus;
  scriptId: string | null;
  title: string;
  productionCompany: string;
  periodStart: string | null;
  periodEnd: string | null;
  days: number | null;
  author: string | null;
  validUntil: string | null;
  memo: string | null;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  unassignedCount: number;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
}

export interface QuoteListItem {
  id: string;
  quoteNo: string;
  version: number;
  isLatest: boolean;
  status: QuoteStatus;
  scriptId: string | null;
  title: string;
  productionCompany: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalAmount: number;
  itemCount: number;
  unassignedCount: number;
  author: string | null;
  createdAt: string;
}

export interface VehicleSummary {
  total: number;
  byCategory: Record<VehicleCategory, number>;
}
