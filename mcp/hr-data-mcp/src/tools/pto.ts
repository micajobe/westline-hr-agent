import type { HrContext } from '../context.js';
import type { BlackoutWindow, NoticeThreshold } from '../data.js';

export interface PtoArgs {
  acting_person_id: string | null;
  person_id: string;
  requested_days?: number;
  start_date?: string;
  end_date?: string;
}

/**
 * `check_pto_balance`. Notice and blackout rules come from `pto_config.json`, which the mock-data
 * tests assert against the PTO document, so the tool and the corpus cannot drift apart. "Today"
 * is the config's `as_of` date so the mock world is deterministic.
 */
export function checkPtoBalance(ctx: HrContext, args: PtoArgs) {
  const { people, ledger, ptoConfig } = ctx.data;
  const auth = people.authorize(args.acting_person_id, args.person_id);
  if (!auth.ok)
    return {
      status: 'FORBIDDEN' as const,
      reason: auth.reason,
      required_scope: auth.required_scope,
    };

  const person = people.get(args.person_id);
  if (!person) return { status: 'NOT_FOUND' as const };
  if (person.workforce_class === 'creator_partner') {
    return {
      status: 'NOT_APPLICABLE' as const,
      reason: 'creator partners do not accrue PTO; see CREATOR §5 availability windows',
    };
  }
  if (person.workforce_class === 'contractor') {
    return {
      status: 'NOT_APPLICABLE' as const,
      reason: 'contractors invoice for days worked and do not accrue PTO; see HANDBOOK §2',
    };
  }
  const row = ledger.get(args.person_id);
  if (!row) return { status: 'NOT_FOUND' as const };

  const start = parseDate(args.start_date);
  const end = parseDate(args.end_date) ?? start;
  let requested = args.requested_days ?? null;
  if (requested === null && start && end) requested = workingDaysInclusive(start, end);

  const threshold =
    requested === null ? undefined : noticeThresholdFor(ptoConfig.notice_thresholds, requested);
  const today = parseDate(ptoConfig.as_of)!;
  const notice_met =
    threshold && start ? daysBetween(today, start) >= threshold.notice_calendar_days : null;

  const collision = start
    ? blackoutCollision(
        ptoConfig.blackout_windows,
        start,
        end ?? start,
        person.market,
        person.department_or_program,
      )
    : null;

  return {
    person_id: row.person_id,
    balance: row.balance,
    annual_entitlement_days: row.annual_entitlement_days,
    accrued_ytd: row.accrued_ytd,
    used_ytd: row.used_ytd,
    carryover: row.carryover_from_prior_year,
    requested_days: requested,
    request_fits: requested === null ? null : row.balance >= requested,
    blackout_collision: collision,
    notice_required: threshold
      ? `${threshold.notice_label}; approver: ${threshold.approver} (PTO ${threshold.source_section})`
      : null,
    notice_calendar_days: threshold?.notice_calendar_days ?? null,
    notice_met,
    as_of: ptoConfig.as_of,
    pending_requests: row.pending_requests,
  };
}

export function noticeThresholdFor(
  thresholds: NoticeThreshold[],
  requestedDays: number,
): NoticeThreshold | undefined {
  const d = Math.max(1, Math.ceil(requestedDays));
  return thresholds.find(
    (t) => d >= t.min_working_days && (t.max_working_days === null || d <= t.max_working_days),
  );
}

export function blackoutCollision(
  windows: BlackoutWindow[],
  start: Date,
  end: Date,
  market: string,
  department: string,
) {
  for (const w of windows) {
    const ws = parseDate(w.start)!;
    const we = parseDate(w.end)!;
    const overlaps = start <= we && end >= ws;
    const marketHit = w.markets === null || w.markets.includes(market);
    const deptHit = w.departments === null || w.departments.includes(department);
    if (overlaps && marketHit && deptHit) {
      return {
        window: w.name,
        start: w.start,
        end: w.end,
        reason: w.reason,
        source_section: `PTO ${w.source_section}`,
      };
    }
  }
  return null;
}

export function workingDaysInclusive(start: Date, end: Date): number {
  let n = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
