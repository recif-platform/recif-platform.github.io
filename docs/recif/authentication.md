---
sidebar_position: 3
---

# Authentication & Users

Récif uses JWT-based authentication. On first startup, an admin user is bootstrapped from environment variables. All subsequent users are created via the API or dashboard.

## Quick Start

### 1. Set Admin Credentials

When deploying via Helm, create a Kubernetes secret with your admin credentials:

```bash
kubectl create secret generic recif-api-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=ADMIN_EMAIL="you@example.com" \
  --from-literal=ADMIN_PASSWORD="your-secure-password" \
  --from-literal=ADMIN_NAME="Your Name" \
  -n recif-system
```

The API pod automatically picks up this secret via `envFrom`.

### 2. Enable Authentication

Set `AUTH_ENABLED=true` in your Helm values:

```yaml
api:
  env:
    AUTH_ENABLED: "true"
```

Or via kubectl:

```bash
kubectl set env deployment/recif-api AUTH_ENABLED=true -n recif-system
```

### 3. Login

Open the dashboard and sign in with the admin email and password you configured.

The API endpoint is:

```bash
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

Response:

```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "us_...",
    "email": "you@example.com",
    "name": "Your Name",
    "role": "admin"
  }
}
```

Use the token in subsequent requests:

```bash
curl http://localhost:8080/api/v1/agents \
  -H "Authorization: Bearer <token>"
```

## How Bootstrap Works

On startup, the API checks:

1. If `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, look for a user with that email.
2. If the user exists but has no password (seeded by migration), set the password and name.
3. If no user exists and the DB is empty, create the admin user.
4. If users already exist, do nothing.

This means you only need the env vars for initial setup. After that, users are managed through the API.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_ENABLED` | No | Set to `"true"` to require JWT on all API calls. Default: `"false"` (dev mode). |
| `JWT_SECRET` | Yes (prod) | Secret key for signing JWT tokens. Use a random 32+ byte string. |
| `ADMIN_EMAIL` | Yes (first run) | Email for the bootstrap admin user. |
| `ADMIN_PASSWORD` | Yes (first run) | Password for the bootstrap admin user (bcrypt hashed at rest). |
| `ADMIN_NAME` | No | Display name for the admin. Default: `"Admin"`. |

## Dev Mode (AUTH_ENABLED=false)

When auth is disabled (default for local development):

- Requests **without** a token proceed with default dev claims (admin role, default team).
- Requests **with** a valid token are still validated and use the real user claims.

This means you can develop without auth but still test login flows by providing a token.

## Roles & Permissions

| Role | Permissions |
|------|-------------|
| `admin` | Full access: create/delete agents, teams, manage members, run evals, deploy |
| `developer` | Read/write agents, deploy, run evals. Cannot manage teams. |
| `viewer` | Read-only access to agents and dashboards. |
| `platform_admin` | Same as admin + all platform operations. |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/login` | Public | Login with email + password, returns JWT |
| `GET` | `/api/v1/auth/me` | Required | Current user profile |
| `PATCH` | `/api/v1/auth/me` | Required | Update display name |
| `POST` | `/api/v1/auth/me/password` | Required | Change password (requires current password) |
| `GET` | `/api/v1/users` | Admin | List all platform users |

## Teams & Access Control

Teams group users and agents. See [Teams](/docs/recif/teams) for full documentation.

- Admins see all agents across all teams.
- Non-admin users see only their team's agents.
- Team admins can manage members within their team.
- The default team cannot be deleted.

## Dashboard Auth Flow

1. User visits any page.
2. Next.js middleware checks for `recif_token` cookie.
3. If missing and `NEXT_PUBLIC_AUTH_ENABLED=true`, redirects to `/login`.
4. After login, token is stored in both `localStorage` (for API calls) and a cookie (for middleware).
5. All API calls include the token via the `apiFetch` wrapper.
6. On 401 response, the token is cleared and user is redirected to login.
