# Blockers

Items that require Micah's accounts or values not available to the build agent.
Everything not listed here has been built. Update/remove entries as they are resolved.

## Open

### 1. `ANTHROPIC_API_KEY` — required for any model call
- Needed for: the agent loop (`/chat`), the eval harness, the LLM judge.
- Without it: everything builds and all non-model tests pass. Model-calling tests are skipped
  (`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`), and `scripts/demo.sh` cannot run.
- Action: put it in `.env` locally, and add it as a GitHub Actions secret + a Render env var on `westline-app`.

### 2. `VOYAGE_API_KEY` — required for production-quality embeddings
- Needed for: `npm run index:build` with `EMBEDDING_PROVIDER=voyage`.
- Without it: set `EMBEDDING_PROVIDER=local` to build the index with the bundled
  transformers.js ONNX model (slower, lower recall — this is ablation 5's "local" arm),
  or `EMBEDDING_PROVIDER=stub` for deterministic hash embeddings used by the test suite.
- Action: free-tier key from https://voyageai.com, then `.env` + GitHub secret + both Render services.

### 3. Render services not yet created
- Needed for: `deployed.md` URLs, `MCP_BASE_URL`, deploy hooks, the live demo.
- Action: follow PRD §19 "Render" and §10. Then set GitHub secrets
  `RENDER_DEPLOY_HOOK_APP`, `RENDER_DEPLOY_HOOK_MCP`, `DEPLOYED_APP_URL`.

### 4. GitHub repo + grader access
- Action: create `westline-hr-agent`, push, add `quantic-grader` as collaborator,
  set Actions workflow permissions to read+write (needed by `eval.yml` to commit results).

### 5. Typeface pairing — decided, no action needed
- Chosen (Micah, 2026-09-04): **PP Editorial Old** display / **PP Neue Montreal** body + UI.
  Installed at `~/Library/Fonts` as `.otf`/`.ttf`; the build converts them to `.woff2` and
  self-hosts them from `apps/web/public/fonts/` (gitignored, not committed).
- Micah holds a general licence for the Pangram Pangram pack and has confirmed it covers this use.
- Fallback stack is commented in `apps/web/src/styles/tokens.css` if the files are ever absent.

## Resolved

_(none yet)_
