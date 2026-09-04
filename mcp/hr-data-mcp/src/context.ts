import { UsedTokenRegistry } from '@westline/shared';
import type { HrData } from './data.js';
import type { DeskStore } from './desk.js';

/** Everything the hr-data tools need. Built once per process; tests build one per suite. */
export interface HrContext {
  data: HrData;
  desk: DeskStore;
  /** `MCP_SHARED_SECRET`: verifies confirmation tokens minted by the app server. */
  secret: string;
  usedTokens: UsedTokenRegistry;
  /** Injectable clock for the gate's TTL and timestamps. */
  now: () => Date;
}

export function createHrContext(
  init: Omit<HrContext, 'usedTokens' | 'now'> & Partial<Pick<HrContext, 'now'>>,
): HrContext {
  return { ...init, usedTokens: new UsedTokenRegistry(), now: init.now ?? (() => new Date()) };
}

export const forbidden = (reason: string, required_scope: string) =>
  ({ status: 'FORBIDDEN', reason, required_scope }) as const;
