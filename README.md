# Daily Work Log + AI Reporting

> “I want to build a system where I can log my daily updates.”  
> “Generate a report from my last 30 days updates with citations.”  
> “We should not leak any company data.”

This is a self-hosted, privacy-first, multi-tenant Daily Work Log + AI Reporting system built with FastAPI, Next.js, PostgreSQL (pgvector), LlamaIndex, and Ollama.

***

## 1. Goals & Non‑Goals

### Goals

- Log daily work: tasks, bugs, blockers, PRs, meetings, decisions.
- Ask natural-language questions like:
  - “What did I do in the last 30 days?”
  - “Generate a manager report from my last 30 days with citations.”
- Strict privacy:
  - All data (logs, embeddings, prompts, completions) stays in your own infrastructure.
  - Local LLM only (Ollama), no external LLM or SaaS calls.
- Multi-tenant from day one:
  - tenants → users → work_logs with strict isolation at DB, API, and retrieval layers.
- Strictly grounded AI:
  - Every claim in AI-generated output must be backed by explicit citations to log entries.
  - No hallucinations; if not in logs, the system must say “Not found in logs.”
- Observability:
  - Prometheus + Grafana dashboards for API latency, retrieval, LLM latency, token usage, and validation failures.
  - Metrics broken down by tenant where possible.

### Non‑Goals

- No external AI APIs (OpenAI, Anthropic, etc.).
- No centralized telemetry; no phone-home or usage analytics.
- Not a full project management tool (deliberately focused on daily logs + reporting).

***

## 2. High‑Level Architecture

### Stack

- **Frontend:** Next.js (TypeScript)
- **Backend:** FastAPI (Python 3.11+)
- **Database:** PostgreSQL with `pgvector` extension for embeddings. [datacamp](https://www.datacamp.com/tutorial/pgvector-tutorial)
- **RAG:** LlamaIndex with tenant-aware metadata filtering. [developers.llamaindex](https://developers.llamaindex.ai/typescript/framework/modules/rag/query_engines/metadata_filtering/)
- **LLM Runtime:** Ollama in Docker for local model inference. [datacamp](https://www.datacamp.com/tutorial/docker-ollama-run-llms-locally)
- **Auth:** GitHub OAuth (NextAuth on frontend, FastAPI verifies JWT/session).
- **Observability:** Prometheus + Grafana.

### Logical Architecture Diagram

```text
Browser (Next.js)
  |
  | HTTPS (JWT / session)
  v
FastAPI Backend
  - Auth & tenant middleware
  - REST API for logs, search, reporting
  - LlamaIndex orchestration
  - Citation validation
  - Prometheus metrics
  |
  +--> PostgreSQL + pgvector
  |      - tenants, users, user_tenants
  |      - work_logs (RLS-enabled)
  |      - log_chunks (embeddings, RLS-enabled)
  |      - reports (structured JSON + metrics)
  |
  +--> Ollama (Docker, local only)
         - LLM inference
         - No outbound network
```

***

## 3. Multi‑Tenancy Model

### Tenancy Model

- **Tenants** represent organizations or teams.
- **Users** represent individual people (linked to GitHub accounts).
- **user_tenants** is a many-to-many mapping of users to tenants with roles.
- **work_logs** and **log_chunks** are always associated with a `tenant_id`.

### Enforcement Layers

1. **DB Layer (Row-Level Security)**  
   - PostgreSQL RLS is enabled on `work_logs` and `log_chunks`.
   - Policies ensure the current user can only access rows for tenants they belong to.
   - FastAPI sets PostgreSQL `app.current_user_id` and `app.current_tenant_id` using `SET LOCAL` per connection.

2. **API Layer**  
   - Auth middleware resolves authenticated `user_id` from the session/JWT.
   - For tenant-scoped routes, the API:
     - Validates that `user_id` belongs to `tenant_id` via `user_tenants`.
     - Injects `tenant_id` into all queries and commands, never trusts client-provided tenant IDs alone.

3. **Retrieval Layer (LlamaIndex)**  
   - Each chunk stored with `metadata = { tenant_id, log_id, date, project, tags, user_id }`.
   - All query engines are created with metadata filters like:
     - `Filters(exact_match={"tenant_id": current_tenant_id})` so retrieval is always tenant-scoped. [llamaindex](https://www.llamaindex.ai/blog/building-multi-tenancy-rag-system-with-llamaindex-0d6ab4e0c44b)

This follows the recommended pattern of storing tenant/user IDs in vector store metadata and filtering at query time to ensure isolation. [github](https://github.com/run-llama/llama_index/discussions/19607)

### Single DB vs DB‑per‑Tenant

- **MVP choice:** Single database with `tenant_id` + RLS.
- Rationale:
  - Minimal operational overhead.
  - Works well for low–medium scale.
  - Keeps queries simple and interoperable with LlamaIndex and pgvector. [severalnines](https://severalnines.com/blog/vector-similarity-search-with-postgresqls-pgvector-a-deep-dive/)
- DB-per-tenant can be added later if needed for extreme isolation or regulatory needs.

***

## 4. Data Model & Schema

### Key Tables

- `tenants`
  - `id`, `name`, `slug`.
- `users`
  - `id`, `github_id`, `email`, `name`, `avatar_url`.
- `user_tenants`
  - `user_id`, `tenant_id`, `role`.
- `work_logs`
  - `id`, `tenant_id`, `user_id`, `date`, `content` (markdown/text),
  - `summary`, `tags[]`, `project`, `prs[]`, `meetings[]`, `blockers[]`.
- `log_chunks`
  - `id`, `tenant_id`, `log_id`, `chunk_index`,
  - `content`, `embedding vector(768)`,
  - `metadata jsonb` (mirrors `tenant_id`, `user_id`, `date`, tags, etc.).
- `reports`
  - `id`, `tenant_id`, `user_id`, `query`,
  - `status`, `time_range_start`, `time_range_end`,
  - `generated_at`, `content jsonb`,
  - `total_chunks_used`, `latency_ms`, `token_count`, `model`.

The `log_chunks` table uses `pgvector` for embeddings and similarity search directly in Postgres, which keeps RAG data inside the main DB with full ACID guarantees and SQL composability. [tigerdata](https://www.tigerdata.com/learn/postgresql-extensions-pgvector)

***

## 5. Request Flows

### 5.1 Auth Flow (GitHub OAuth)

1. User clicks “Sign in with GitHub” in Next.js.
2. NextAuth exchanges code with GitHub and stores the session in a secure cookie.
3. On authenticated API calls:
   - Next.js includes a bearer token or session cookie.
   - FastAPI validates token, extracts GitHub user ID, and looks up or creates a `users` row.
   - For multi-tenant endpoints, a `tenant_id` is resolved (via query, header, or session-scoped selection in UI) and validated via `user_tenants`.

### 5.2 Daily Log Creation

1. User selects tenant and date, fills in:
   - What they worked on
   - Bugs, blockers, PR links
   - Meetings, decisions
2. Frontend sends `POST /api/v1/logs` with payload:
   - `date`, `content`, `tags`, `project`, etc.
3. Backend:
   - Authenticates user.
   - Validates `tenant_id`.
   - Inserts into `work_logs`.
   - Splits `content` into chunks (e.g., ~512–1024 tokens).
   - Generates embeddings for each chunk via local embed model (Ollama or another local embedding pipeline).
   - Inserts into `log_chunks` with metadata.
   - All operations run in a transaction.

### 5.3 Search & Retrieval

- API: `GET /api/v1/logs/search`
  - Filters: time range, tags, project, keyword, semantic text.
- Backend:
  - Uses SQL + pgvector to search `log_chunks` with metadata filters and time range.
  - Or uses LlamaIndex’s vector store integration pointed at Postgres with `tenant_id` filters. [developers.llamaindex](https://developers.llamaindex.ai/python/examples/multi_tenancy/multi_tenancy_rag/)
- Returns matching logs/chunks for UI browsing.

### 5.4 AI Reporting (7/30 Day Report)

1. User requests: “Generate a manager report for the last 30 days.”
2. Frontend calls `POST /api/v1/reports/generate` with:
   - `time_range_days: 30`, `tenant_id`, and optional `query`.
3. Backend:
   - Creates a `reports` row with `status='pending'`.
   - Option A (MVP): Process synchronously in the request.
   - Option B (v1+): Enqueue a background job via Arq or Celery (preferred for better UX).
4. Steps inside job:
   - Fetch all `log_chunks` for `tenant_id` within time range.
   - Use LlamaIndex to rank or cluster relevant chunks for the query.
   - Call Ollama with prompt + context.
   - Enforce JSON schema + run validator (see next section).
   - Save validated report JSON + metrics to `reports`.
5. Frontend polls `GET /api/v1/reports/{id}` until `status='completed'`.

***

## 6. Strict Citation & Grounding Design

### 6.1 JSON Schema for Model Output

**Citation:**

```jsonc
{
  "log_entry_id": "uuid",
  "date": "YYYY-MM-DD",
  "supporting_snippet": "exact or near-exact text from log chunk",
  "chunk_index": 0
}
```

**Claim:**

```jsonc
{
  "claim": "Implemented X feature in service Y.",
  "category": "work_completed",
  "confidence": "high",
  "citations": [Citation, ...]
}
```

**Report:**

```jsonc
{
  "summary": "High-level overview of the last N days.",
  "claims": [Claim, ...],
  "period_covered": "2026-01-01 to 2026-01-30",
  "unsupported_queries": ["Any prompts the model couldn't support"],
  "total_log_entries_considered": 42
}
```

The model is instructed to output **only** valid JSON conforming to this schema.

### 6.2 Prompt Design

System prompt (conceptual):

- Use only the provided logs.
- Every factual statement must be backed by at least one citation.
- If not supported, mark claim as `confidence="unsupported"` and include it in `unsupported_queries`.
- Never fabricate log entries or work items.
- Output strictly valid JSON.

Context rendering:

```text
[log_id=UUID, date=YYYY-MM-DD, chunk_index=0]
<chunk content...>

[log_id=UUID, date=YYYY-MM-DD, chunk_index=1]
<chunk content...>
```

### 6.3 Validator

After the LLM returns JSON:

1. Parse into a Pydantic model.
2. For each claim:
   - If `confidence != "unsupported"`:
     - Ensure `citations` list is non-empty.
     - Verify each `log_entry_id` exists in the set of retrieved chunks.
     - Optionally verify that `supporting_snippet` appears (fuzzy match) in the corresponding chunk.
3. If violations:
   - Attempt regeneration with stricter instructions, e.g., “You previously referenced invalid citations; regenerate using only these log IDs.”
   - Cap at 2 attempts.
4. If still invalid:
   - Mark all problematic claims as `confidence="unsupported"` and strip citations.
   - Return partial report with explicit “Not found in logs” annotations on the frontend.

***

## 7. LlamaIndex & RAG Design

- **Document Source:** `log_chunks` rows, not raw `work_logs`.
- **Metadata:** `tenant_id`, `log_id`, `date`, `project`, `tags`, `user_id`.
- **Indexing:**
  - Ingestion pipeline loads new/changed logs from Postgres, chunks them, and writes embeddings back into `log_chunks`.
- **Query Engines:**
  - One shared index, always queried with `tenant_id` filter:
    - Either via LlamaIndex’s `MetadataFilters` or via a Postgres vector store wrapper that enforces `tenant_id` condition. [developers.llamaindex](https://developers.llamaindex.ai/python/examples/vector_stores/nilevectorstore/)
- This pattern is consistent with multi-tenant RAG guidance where tenant-specific metadata is attached and then used for filtering at query time. [developers.llamaindex](https://developers.llamaindex.ai/python/examples/vector_stores/qdrant_hybrid_rag_multitenant_sharding/)

***

## 8. Privacy & Ollama Security

- Ollama runs in a Docker container:
  - Bound to `127.0.0.1:11434` (no external exposure).
  - No internet access: network restricted to internal Docker network.
  - Only the backend service can call the Ollama endpoint.
- Models and prompts never leave the host machine; you control the hardware and containers. [reddit](https://www.reddit.com/r/ollama/comments/1cy7dmk/running_ollama_openwebui_container_without/)
- No external instrumentation / analytics libraries included.
- Secrets for GitHub OAuth and DB connection are passed via environment variables, not hardcoded or committed.

***

## 9. Observability (Prometheus + Grafana)

### 9.1 Metrics

Key metrics (Prometheus):

- API:
  - `worklog_requests_total{method,endpoint,tenant_id,status}`
  - `worklog_request_duration_seconds{method,endpoint,tenant_id}`
- Retrieval:
  - `worklog_retrieval_duration_seconds{tenant_id,index_type}`
  - `worklog_context_chunks{tenant_id,query_type}`
  - `worklog_similarity_score{tenant_id}`
- LLM:
  - `worklog_llm_latency_seconds{model,tenant_id,operation}`
  - `worklog_tokens_total{type,model,tenant_id}`
- Reporting:
  - `worklog_report_generation_duration_seconds{tenant_id,time_range_days}`
  - `worklog_validation_failures_total{failure_type}`
- DB (optional, via SQLAlchemy / exporter):
  - `worklog_db_query_duration_seconds{table,operation}`

### 9.2 Dashboards

Suggested Grafana dashboards:

1. **API Health**
   - Requests/min by endpoint.
   - P50/P95/P99 latency by endpoint.
   - Error rate by tenant.

2. **RAG/LLM Performance**
   - Retrieval latency over time.
   - LLM latency and token usage by model.
   - Context size (#chunks) distribution.

3. **Citation Quality**
   - Validation failures over time.
   - Ratio of supported vs unsupported claims.
   - Avg. citations per claim.

### 9.3 Alerts (Examples)

- P95 latency for `/api/v1/reports/generate` > 30s for 5 minutes.
- Validation failures > X per hour.
- LLM latency > 60s for a rolling window.

***

## 10. CI/CD Blueprint

### 10.1 Repo Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/          # routers
│   │   ├── core/         # config, security, settings
│   │   ├── models/       # SQLAlchemy models & Pydantic schemas
│   │   ├── services/     # RAG, reporting, citation validator
│   │   └── metrics/      # Prometheus integration
│   ├── alembic/          # DB migrations
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   ├── app/              # Next.js app router
│   ├── components/
│   ├── lib/              # API client, auth helpers
│   ├── tests/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── dashboards/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── release.yml
│       └── security.yml
├── .env.example
└── README.md
```

### 10.2 GitHub Actions

- **ci.yml** (runs on PR):
  - Python: `ruff` (format + lint), `mypy`, `pytest`.
  - Node: `npm run lint`, `npm run type-check`, `npm test`.
  - Migrations: run `alembic upgrade head` against ephemeral Postgres.

- **release.yml** (on push to `main`):
  - Build backend and frontend Docker images.
  - Push to GitHub Container Registry.

- **security.yml** (scheduled weekly):
  - Python dependency scanning (`pip-audit` or similar).
  - `npm audit`.
  - Secret scanning (e.g., TruffleHog).

***

## 11. Local Development & Deployment

### 11.1 Prerequisites

- Docker & Docker Compose
- GitHub OAuth app configured (callback to frontend URL).
- `.env` file created using `.env.example`.

### 11.2 Running Locally

```bash
# 1. Clone repo
git clone https://github.com/niravpatidar37/logcraft-ai.git
cd logcraft-ai

# 2. Copy env
cp .env.example .env
# Fill in:
#   GITHUB_CLIENT_ID
#   GITHUB_CLIENT_SECRET
#   DATABASE_URL
#   OLLAMA_BASE_URL (e.g., http://ollama:11434)

# 3. Start services
docker compose up --build
```

Services started:

- `frontend` at `http://localhost:3000`
- `backend` at `http://localhost:8000`
- `postgres` with `pgvector`
- `ollama` local LLM
- `prometheus` and `grafana` (optional, depending on compose file)

### 11.3 Production Path

- Start with `docker-compose.prod.yml` on a single VM.
- Harden:
  - Use HTTPS (reverse proxy like Caddy/Traefik).
  - Restrict Ollama container network to backend-only.
  - Configure persistent volumes for Postgres and Ollama models.
- Future: optional Kubernetes manifests when you need scale/HA.

***

## 12. UX Examples

### 12.1 Daily Log Template (UI Concept)

- Date: `2026-01-30`
- Project: `Internal Worklog Tool`
- Tags: `["backend", "bugfix"]`
- Content (markdown):

```markdown
### What I worked on
- Implemented RLS policies for `work_logs`.
- Wired LlamaIndex metadata filters for tenant isolation.

### Bugs
- Fixed a migration issue causing log_chunks to mis-associate tenant_id.

### Blockers
- Waiting on OAuth app approval from security.

### PRs
- https://github.com/org/repo/pull/123

### Meetings
- 1:1 with manager – agreed to ship MVP this week.
```

### 12.2 30‑Day Manager Report (Conceptual Structure)

```markdown
## Summary
- Over the last 30 days, you focused on solidifying multi-tenant isolation, improving observability, and delivering a privacy-first RAG workflow.

## Work Completed
- Implemented row-level security on work logs to ensure per-tenant isolation.  
  [log_entry_id=..., date=2026-01-10, snippet="Enabled RLS on work_logs and log_chunks for tenant isolation."]

- Added tenant-scoped metadata filters to the retrieval pipeline.  
  [log_entry_id=..., date=2026-01-12, snippet="Updated LlamaIndex query engine to filter by tenant_id in metadata."]

## Bugs Fixed
- Resolved migration failures that caused incorrect tenant associations in `log_chunks`.  
  [log_entry_id=..., date=2026-01-18, snippet="Fixed Alembic migration so chunks inherit tenant_id from work_logs."]

## Blockers
- Some OAuth configuration tasks are pending security review.  
  [log_entry_id=..., date=2026-01-22, snippet="Waiting on security to approve GitHub OAuth app."]

## Items Not Found in Logs
- Any requested item not backed by log entries is listed here as “Not found in logs”.
```

Each bullet in the rendered report corresponds to one `ReportClaim` with attached citations in the JSON payload.

***

This README is designed to be your living system design document plus onboarding guide. As you iterate from MVP → v1 → v2, you can extend the sections for background jobs, Slack integration, and Kubernetes manifests while keeping the core privacy-first, multi-tenant, strictly-grounded design intact.