/**
 * Core Westline domain vocabulary. These names are load-bearing: they appear in tool
 * schemas, trace events, corpus front-matter and the eval set. Keep them stable.
 */

export const WORKFORCE_CLASSES = ['staff', 'contractor', 'creator_partner'] as const;
export type WorkforceClass = (typeof WORKFORCE_CLASSES)[number];

export const SCOPES = ['self', 'manager', 'hr_partner'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Audience tags as they appear in corpus front-matter. `hr_only` marks material that is
 * visible to HR partners regardless of the reader's own workforce class.
 */
export const AUDIENCES = [
  'all',
  'staff',
  'contractor',
  'creator_partners',
  'staff_and_contractors',
  'hr_only',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const TICKET_CATEGORIES = [
  'hr_partner',
  'manager',
  'creator_partnerships',
  'security',
  'editorial_standards',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const RECIPIENT_ROLES = [
  'manager',
  'hr_partner',
  'creator_partnerships',
  'editorial_standards',
] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export const ESCALATION_TARGETS = [
  'none',
  'hr_partner',
  'manager',
  'creator_partnerships',
  'security',
  'editorial_standards',
  'out_of_scope',
] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

/** Structured statuses returned across the MCP boundary. Never thrown, always returned. */
export const TOOL_STATUSES = [
  'FORBIDDEN',
  'NOT_FOUND',
  'AMBIGUOUS',
  'NOT_APPLICABLE',
  'TOOL_UNAVAILABLE',
  'CONFIRMATION_REQUIRED',
  'FORBIDDEN_AUDIENCE',
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/**
 * Does a document (or section) tagged `audience` bind a reader of class `cls`?
 *
 * `viewerScope` is passed separately because HR partners can read `hr_only` material about
 * other classes -- that is a scope question, not a class question. Anonymous readers
 * (no acting person) get `all` only; callers pass `cls = null` for that case.
 */
export function audienceApplies(
  audience: Audience,
  cls: WorkforceClass | null,
  viewerScope: Scope | null = null,
): boolean {
  if (audience === 'hr_only') return viewerScope === 'hr_partner';
  if (audience === 'all') return true;
  if (cls === null) return false;
  switch (audience) {
    case 'staff':
      return cls === 'staff';
    case 'contractor':
      return cls === 'contractor';
    case 'creator_partners':
      return cls === 'creator_partner';
    case 'staff_and_contractors':
      return cls === 'staff' || cls === 'contractor';
    default:
      return false;
  }
}
