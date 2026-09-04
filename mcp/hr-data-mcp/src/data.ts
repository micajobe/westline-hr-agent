import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PeopleDirectory } from '@westline/shared';

export interface PtoLedgerRow {
  person_id: string;
  tenure_tier: string;
  annual_entitlement_days: number;
  monthly_accrual_days: number;
  accrued_ytd: number;
  used_ytd: number;
  carryover_from_prior_year: number;
  balance: number;
  pending_requests: { start: string; end: string; days: number; status: string }[];
}

export interface BenefitsRow {
  person_id: string;
  eligible: boolean;
  eligibility_reason: string;
  waiting_period_ends: string | null;
  enrolled_plans: string[];
  dependants_count: number;
  next_enrollment_window: { start: string; end: string } | null;
  fixed_term_months: number | null;
}

export interface CreatorRecord {
  person_id: string;
  agreement_start: string;
  tier: number;
  rate_card_id: string;
  exclusivity_window_days: number;
  active_brand_deals: Record<string, unknown>[];
  availability_windows: Record<string, unknown>[];
}

export interface NoticeThreshold {
  min_working_days: number;
  max_working_days: number | null;
  notice_calendar_days: number;
  notice_label: string;
  approver: string;
  source_section: string;
}

export interface BlackoutWindow {
  name: string;
  start: string;
  end: string;
  markets: string[] | null;
  departments: string[] | null;
  reason: string;
  source_section: string;
}

export interface PtoConfig {
  as_of: string;
  notice_thresholds: NoticeThreshold[];
  blackout_windows: BlackoutWindow[];
}

export interface HrData {
  people: PeopleDirectory;
  ledger: Map<string, PtoLedgerRow>;
  benefits: Map<string, BenefitsRow>;
  creators: Map<string, CreatorRecord>;
  ptoConfig: PtoConfig;
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

/** Load every mock data file once. All reads afterwards are in-memory map lookups. */
export function loadHrData(mockDir: string): HrData {
  const byPerson = <T extends { person_id: string }>(rows: T[]) =>
    new Map(rows.map((r) => [r.person_id, r]));
  return {
    people: PeopleDirectory.load(join(mockDir, 'people.json')),
    ledger: byPerson(readJson<PtoLedgerRow[]>(mockDir, 'pto_ledger.json')),
    benefits: byPerson(readJson<BenefitsRow[]>(mockDir, 'benefits.json')),
    creators: byPerson(readJson<CreatorRecord[]>(mockDir, 'creator_records.json')),
    ptoConfig: readJson<PtoConfig>(mockDir, 'pto_config.json'),
  };
}
