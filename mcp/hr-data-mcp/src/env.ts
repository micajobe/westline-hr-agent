import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHrContext, type HrContext } from './context.js';
import { loadHrData } from './data.js';
import { DeskStore } from './desk.js';

export interface HrContextEnv {
  MOCK_DATA_DIR?: string;
  DESK_PATH?: string;
  MCP_SHARED_SECRET?: string;
}

/**
 * Production path: mock data from `mock_data/`, the desk store at `data/desk.sqlite` (seeded, and
 * reset on every redeploy because Render free services have no persistent disk -- PRD §10), and
 * the shared secret that confirmation tokens are verified against.
 */
export function createHrContextFromEnv(env: HrContextEnv = process.env, repoRoot = process.cwd()): HrContext {
  const secret = env.MCP_SHARED_SECRET;
  if (!secret) throw new Error('MCP_SHARED_SECRET is required: confirmation tokens cannot be verified without it');
  const mockDir = resolve(repoRoot, env.MOCK_DATA_DIR ?? 'mock_data');
  const deskPath = env.DESK_PATH === ':memory:' ? ':memory:' : resolve(repoRoot, env.DESK_PATH ?? 'data/desk.sqlite');
  if (deskPath !== ':memory:') mkdirSync(dirname(deskPath), { recursive: true });
  const desk = DeskStore.open(deskPath);
  desk.seed(resolve(mockDir, 'tickets.seed.json'));
  return createHrContext({ data: loadHrData(mockDir), desk, secret });
}
