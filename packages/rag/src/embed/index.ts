import {
  EMBEDDING_PROVIDER_IDS,
  EmbeddingError,
  type EmbeddingProvider,
  type EmbeddingProviderId,
} from './provider.js';
import { StubEmbeddingProvider } from './stub.js';
import { VoyageEmbeddingProvider } from './voyage.js';

export * from './provider.js';
export * from './stub.js';
export * from './voyage.js';

export interface EmbeddingEnv {
  EMBEDDING_PROVIDER?: string;
  VOYAGE_API_KEY?: string;
  VOYAGE_MODEL?: string;
}

/**
 * Build the provider named by `EMBEDDING_PROVIDER` (PRD §18: `voyage` default, `local` for
 * ablation 5, `stub` for tests). Fails loudly on an unknown name or a missing key rather than
 * falling back: a silently different embedding model would invalidate every eval number.
 */
export function createEmbeddingProvider(env: EmbeddingEnv = process.env): EmbeddingProvider {
  const id = (env.EMBEDDING_PROVIDER ?? 'voyage') as EmbeddingProviderId;
  if (!EMBEDDING_PROVIDER_IDS.includes(id)) {
    throw new Error(
      `EMBEDDING_PROVIDER="${env.EMBEDDING_PROVIDER}" is not one of ${EMBEDDING_PROVIDER_IDS.join(', ')}`,
    );
  }
  switch (id) {
    case 'stub':
      return new StubEmbeddingProvider();
    case 'voyage':
      return new VoyageEmbeddingProvider({
        apiKey: env.VOYAGE_API_KEY ?? '',
        model: env.VOYAGE_MODEL,
      });
    case 'local':
      // PRD §16 cut order item 1 (optional ablation 5). Built last, if at all.
      throw new EmbeddingError('local', 'the transformers.js provider is not implemented yet');
  }
}
