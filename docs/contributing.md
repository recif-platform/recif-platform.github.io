---
sidebar_position: 10
---

# Contributing & Testing

This guide covers how to run tests and contribute to the Récif platform.

## CI Pipeline

Every push to `main` and every pull request triggers the CI pipeline (GitHub Actions):

| Job | What it does |
|-----|-------------|
| **Go Build & Test** | `go build ./...`, `go test -race ./...`, `go vet ./...` |
| **Python Lint & Test** | `ruff check`, `ruff format --check`, `pytest` for Corail |
| **Dashboard Build** | TypeScript check (`tsc --noEmit`) + Next.js production build |

PRs cannot merge if any job fails.

## Running Tests Locally

### Go (Récif API)

```bash
cd recif
go test ./...          # unit tests
go test -race ./...    # with race detector
go vet ./...           # static analysis
```

Key test files:
- `internal/auth/handler_test.go` — login, me, password change, RBAC
- `internal/auth/jwt_test.go` — JWT issue/validate/expiry
- `internal/auth/rbac_test.go` — role permissions
- `internal/server/server_test.go` — HTTP health, request IDs
- `internal/agent/proxy_test.go` — agent proxy routing, SSE

### Python (Corail)

```bash
cd corail
uv run ruff check .                    # lint
uv run ruff format --check .           # format check
pytest tests/ -x -q --ignore=tests/integration  # unit tests
```

### Dashboard (E2E with Playwright)

The dashboard has a full Playwright E2E test suite that runs against the real API.

**Prerequisites:**
- API running on `http://localhost:8080` (K8s port-forward or local binary)
- Auth enabled with a known admin user

```bash
cd recif/dashboard

# Install Playwright (first time only)
npm install -D @playwright/test
npx playwright install chromium

# Run all tests
NEXT_PUBLIC_API_URL=http://localhost:8080 \
NEXT_PUBLIC_AUTH_ENABLED=true \
node_modules/.bin/playwright test

# Run specific suite
node_modules/.bin/playwright test auth
node_modules/.bin/playwright test agents
node_modules/.bin/playwright test navigation

# Interactive UI mode
node_modules/.bin/playwright test --ui

# View HTML report after failures
npx playwright show-report
```

**Test suites (36 tests):**

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `auth.spec.ts` | 6 | Login, wrong password, redirect, topbar user info, sign out |
| `agents.spec.ts` | 4 | List, click to detail, config tab, API response validation |
| `chat.spec.ts` | 4 | Page load, agent selector, agent restore, conversation restore |
| `knowledge.spec.ts` | 3 | Page load, KB API validation, create/delete KB |
| `navigation.spec.ts` | 13 | All 12 pages load without errors, sidebar links |
| `settings.spec.ts` | 4 | Platform config, teams API, default team protection, team CRUD |

**Error detection:** The `trackErrors()` helper intercepts 5xx API responses and console errors during every UI test. If the backend returns a server error while Playwright clicks a button, the test fails with the exact error.

**Auth setup:** Tests log in once via `auth.setup.ts` and share the session across all suites (Playwright's `storageState` pattern). No login repetition.

**Cleanup:** `global.teardown.ts` deletes any test data (teams prefixed with `E2E-`, skills prefixed with `e2e-`) after all tests complete.

## Test Data Conventions

- Test teams: prefix name with `E2E-` (auto-cleaned)
- Test skills: prefix name with `e2e-` (auto-cleaned)
- Test credentials: use env vars `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` or defaults (`adham@recif.dev` / `recif_admin_2026`)

## Code Style

- **Go**: `go vet`, no `if/elif` chains (registry pattern), SOLID/DRY/KISS
- **Python**: `ruff` for lint + format
- **TypeScript**: strict mode, no `any` where avoidable
- **Tests**: write tests before implementing (TDD when possible)
