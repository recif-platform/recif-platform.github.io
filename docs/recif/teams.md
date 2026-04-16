---
sidebar_position: 4
---

# Teams & Access Control

Teams are the multi-tenancy unit in Récif. Every user belongs to at least one team, and every agent is owned by a team. Teams control who can see, deploy, and manage which agents.

## Default Team

On first install, a `Default` team is created automatically (ID: `tk_DEFAULT000000000000000000`). The bootstrap admin user is added as a member. This team cannot be deleted.

## Creating Teams

Admins can create teams via the dashboard (Teams page) or the API:

```bash
curl -X POST http://localhost:8080/api/v1/teams \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Engineering", "description": "Core engineering team"}'
```

Each team gets:
- A unique ID (`tk_...`)
- A slug derived from the name (e.g., `engineering`)
- A K8s namespace convention: `team-{slug}`

## Managing Members

### Add a Member

The user must already exist in the platform (created via bootstrap or future user management):

```bash
curl -X POST http://localhost:8080/api/v1/teams/{teamId}/members \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@example.com", "role": "developer"}'
```

### Update Role

```bash
curl -X PATCH http://localhost:8080/api/v1/teams/{teamId}/members/{userId} \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

### Remove Member

```bash
curl -X DELETE http://localhost:8080/api/v1/teams/{teamId}/members/{userId} \
  -H "Authorization: Bearer <token>"
```

## Agent Visibility

When a user creates an agent, the agent is tagged with their team's ID (stored as a K8s label `recif.dev/team-id`).

| User Role | Sees |
|-----------|------|
| Admin / Platform Admin | All agents across all teams |
| Developer / Viewer | Only agents from their own team |

This applies to listing, viewing details, deploying, stopping, restarting, and deleting agents. Non-team-members get a 404 (no information leak about agents in other teams).

## Who Can Do What

| Action | Admin | Team Admin | Developer | Viewer |
|--------|-------|------------|-----------|--------|
| Create team | Yes | No | No | No |
| Delete team | Yes | No | No | No |
| Add/remove members | Yes | Own team | No | No |
| Change member roles | Yes | Own team | No | No |
| Create agents | Yes | Yes | Yes | No |
| Deploy/stop agents | Yes | Yes | Yes | No |
| View agents | All teams | Own team | Own team | Own team |
| Delete agents | Yes | Own team | Own team | No |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/teams` | Required | List teams (admins: all, others: own team) |
| `POST` | `/api/v1/teams` | Admin | Create a team |
| `GET` | `/api/v1/teams/{id}` | Required | Team details + member list |
| `DELETE` | `/api/v1/teams/{id}` | Admin | Delete a team (not default) |
| `POST` | `/api/v1/teams/{id}/members` | Admin or Team Admin | Add member by email |
| `DELETE` | `/api/v1/teams/{id}/members/{userId}` | Admin or Team Admin | Remove member |
| `PATCH` | `/api/v1/teams/{id}/members/{userId}` | Admin or Team Admin | Update member role |

## Database Schema

Teams and memberships are stored in PostgreSQL (not K8s CRDs):

- `teams` table: id, name, slug, description, created_at, updated_at
- `team_memberships` table: id, user_id (FK), team_id (FK), role, created_at
- Unique constraint on (user_id, team_id) prevents duplicate memberships
- `ON DELETE CASCADE` on both FKs ensures cleanup
