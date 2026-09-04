import { argsHash, newDraftId, newTicketId, verifyConfirmationToken } from '@westline/shared';
import type { RecipientRole, TicketCategory } from '@westline/shared';
import type { HrContext } from '../context.js';

export interface TicketArgs {
  acting_person_id: string | null;
  about_person_id: string;
  category: TicketCategory;
  summary: string;
  details?: string;
  confirmation_token?: string;
}

export interface DraftArgs {
  acting_person_id: string | null;
  about_person_id: string;
  recipient_role: RecipientRole;
  purpose: string;
  key_points: string[];
  confirmation_token?: string;
}

type GateOutcome =
  | { ok: true }
  | {
      ok: false;
      result: { status: 'CONFIRMATION_REQUIRED'; proposed_args_hash: string; reason: string };
    };

/**
 * The gate. Missing or invalid token ⇒ CONFIRMATION_REQUIRED with the hash the app must mint a
 * token for; nothing executes. A valid token is consumed here, so a replay with the same token is
 * refused even though its signature is still good.
 */
function passGate(ctx: HrContext, args: Record<string, unknown>): GateOutcome {
  const proposed_args_hash = argsHash(args);
  const refuse = (reason: string): GateOutcome => ({
    ok: false,
    result: { status: 'CONFIRMATION_REQUIRED', proposed_args_hash, reason },
  });
  if (
    args.confirmation_token === undefined ||
    args.confirmation_token === null ||
    args.confirmation_token === ''
  ) {
    return refuse('this action needs explicit confirmation');
  }
  const v = verifyConfirmationToken(args.confirmation_token, proposed_args_hash, ctx.secret, {
    now: ctx.now().getTime(),
  });
  if (!v.ok) return refuse(`confirmation token rejected: ${v.reason}`);
  if (!ctx.usedTokens.consume(v.nonce, v.expires_at, ctx.now().getTime())) {
    return refuse('confirmation token rejected: ALREADY_USED');
  }
  return { ok: true };
}

/** Who may act about whom: the same scope rules as reading, enforced before the gate is even consulted. */
function authorizeAction(ctx: HrContext, acting: string | null, about: string) {
  const auth = ctx.data.people.authorize(acting, about);
  if (!auth.ok)
    return {
      status: 'FORBIDDEN' as const,
      reason: auth.reason,
      required_scope: auth.required_scope,
    };
  if (!ctx.data.people.get(about)) return { status: 'NOT_FOUND' as const };
  return undefined;
}

export function createMockHrTicket(ctx: HrContext, args: TicketArgs) {
  const denied = authorizeAction(ctx, args.acting_person_id, args.about_person_id);
  if (denied) return denied;
  const gate = passGate(ctx, args as unknown as Record<string, unknown>);
  if (!gate.ok) return gate.result;

  const created_at = ctx.now().toISOString();
  const ticket = {
    ticket_id: newTicketId(),
    created_by: args.acting_person_id!,
    about_person_id: args.about_person_id,
    category: args.category,
    summary: args.summary,
    details: args.details ?? null,
    status: 'open',
    created_at,
    turn_id: null,
  };
  ctx.desk.insertTicket(ticket);
  return {
    ticket_id: ticket.ticket_id,
    status: 'open' as const,
    category: ticket.category,
    created_at,
  };
}

export function draftHrEmail(ctx: HrContext, args: DraftArgs) {
  const denied = authorizeAction(ctx, args.acting_person_id, args.about_person_id);
  if (denied) return denied;
  const gate = passGate(ctx, args as unknown as Record<string, unknown>);
  if (!gate.ok) return gate.result;

  const { people } = ctx.data;
  const acting = people.get(args.acting_person_id)!;
  const about = people.get(args.about_person_id)!;
  const created_at = ctx.now().toISOString();
  const subject = `${capitalise(args.purpose)}${about.person_id === acting.person_id ? '' : ` — ${about.name}`}`;
  const body = renderEmailBody({
    recipient_role: args.recipient_role,
    purpose: args.purpose,
    key_points: args.key_points,
    sender: acting.name,
    about: about.name,
    self: about.person_id === acting.person_id,
  });
  const draft = {
    draft_id: newDraftId(),
    created_by: acting.person_id,
    about_person_id: about.person_id,
    recipient_role: args.recipient_role,
    subject,
    body,
    created_at,
    turn_id: null,
  };
  ctx.desk.insertDraft(draft);
  return {
    draft_id: draft.draft_id,
    to_role: draft.recipient_role,
    subject,
    body,
    created_at,
    sent: false as const,
  };
}

const ROLE_SALUTATION: Record<RecipientRole, string> = {
  manager: 'Hi',
  hr_partner: 'Hello People & Culture',
  creator_partnerships: 'Hello Creator Partnerships',
  editorial_standards: 'Hello Editorial Standards desk',
};

/** Deterministic template -- no model inside the tool (PRD §6.2). */
export function renderEmailBody(p: {
  recipient_role: RecipientRole;
  purpose: string;
  key_points: string[];
  sender: string;
  about: string;
  self: boolean;
}): string {
  const lines = [
    `${ROLE_SALUTATION[p.recipient_role]},`,
    '',
    p.self
      ? `I'm writing about ${lowerFirst(p.purpose)}.`
      : `I'm writing on behalf of ${p.about} about ${lowerFirst(p.purpose)}.`,
    '',
    ...p.key_points.map((k) => `- ${k.trim()}`),
    '',
    'Please let me know if you need anything else from me.',
    '',
    'Thanks,',
    p.sender,
    '',
    '[Draft prepared by the Westline HR assistant. Not sent.]',
  ];
  return lines.join('\n');
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
