import { startServer, type WestlineServer } from '@westline/server';
import type { EvalItem } from './types.js';

/** One arm of an ablation (PRD §12.3): a name, the env it needs, and which items it is measured on. */
export interface EvalConfig {
  name: string;
  ablation?: string;
  label: Record<string, string | number>;
  env: Record<string, string>;
  selects: (item: EvalItem) => boolean;
}

const retrievalBearing = (i: EvalItem) => i.gold_citations.length > 0;
const toolBearing = (i: EvalItem) => i.category === 'tool_workflow' || i.category === 'authorization_audience';

export const BASE_CONFIG: EvalConfig = { name: 'base', label: { k: 6, mode: 'hybrid', chunking: 'heading-aware', hr_mcp: 'up' }, env: {}, selects: () => true };

export const ABLATION_CONFIGS: EvalConfig[] = [
  { name: 'k3', ablation: 'retrieval k', label: { k: 3 }, env: { RETRIEVAL_K_OVERRIDE: '3' }, selects: retrievalBearing },
  { name: 'k10', ablation: 'retrieval k', label: { k: 10 }, env: { RETRIEVAL_K_OVERRIDE: '10' }, selects: retrievalBearing },
  { name: 'chunk-fixed', ablation: 'chunking', label: { chunking: 'fixed 400-token window' }, env: { CHUNK_STRATEGY: 'fixed', INDEX_PATH: 'data/index-fixed.sqlite' }, selects: retrievalBearing },
  { name: 'mode-vector', ablation: 'retrieval mode', label: { mode: 'vector' }, env: { RETRIEVAL_MODE_OVERRIDE: 'vector' }, selects: retrievalBearing },
  { name: 'mode-bm25', ablation: 'retrieval mode', label: { mode: 'bm25' }, env: { RETRIEVAL_MODE_OVERRIDE: 'bm25' }, selects: retrievalBearing },
  { name: 'chaos-hr', ablation: 'tool availability', label: { hr_mcp: 'down (CHAOS_DISABLE_HR_MCP)' }, env: { CHAOS_DISABLE_HR_MCP: 'true' }, selects: toolBearing },
];

/**
 * Boot the real app in-process with one configuration's env on an ephemeral port. Ablations that
 * need a different index (chunking) or a retrieval override cannot be run against the deployed URL,
 * so `--target deployed` measures the base configuration only.
 */
export async function startLocal(config: EvalConfig, baseEnv: NodeJS.ProcessEnv = process.env): Promise<WestlineServer> {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    MCP_MODE: 'inprocess',
    MCP_SHARED_SECRET: baseEnv.MCP_SHARED_SECRET ?? 'eval-local-secret',
    DESK_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    WEB_DIST_DIR: 'does-not-exist',
    ...config.env,
  };
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required to run the eval locally');
  return startServer({ env, port: 0, host: '127.0.0.1', log: () => {} });
}
