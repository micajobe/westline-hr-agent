import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function slug(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const newTurnId = (): string => `t_${slug(10)}`;
export const newConversationId = (): string => `c_${slug(10)}`;
export const newTicketId = (): string => `TKT-${slug(6).toUpperCase()}`;
export const newDraftId = (): string => `DFT-${slug(6).toUpperCase()}`;
