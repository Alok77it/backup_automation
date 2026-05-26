# DevOps Control Plane — REST API Specification
> Version: 1.0 | Base URL: `https://api.devops-os.io/v1`

---

## GLOBAL CONVENTIONS

### Authentication
All endpoints (except `/auth/login`, `/auth/register`, `/auth/refresh`) require:
```
Authorization: Bearer <access_token>
X-Org-ID: <org_uuid>           ← required for org-scoped endpoints
X-Request-ID: <uuid>           ← for tracing (auto-generated if omitted)
```

### Standard Response Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "per_page": 20, "total": 150 },
  "request_id": "uuid"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to install tools on this server",
    "details": {}
  },
  "request_id": "uuid"
}
```

### Standard Error Codes
| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Valid JWT but insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found or not in your org |
| `VALIDATION_ERROR` | 422 | Request body/param validation failure |
| `CONFLICT` | 409 | Duplicate resource or state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `APPROVAL_REQUIRED` | 202 | Action queued, awaiting approval |
| `INTERNAL_ERROR` | 500 | Server error |

---

## MODULE 1: AUTHENTICATION

### POST /auth/register
Register a new user account.
```json
// Request
{
  "email": "user@example.com",
  "password": "min-12-chars",
  "full_name": "Jane Doe"
}
// Response 201
{
  "user": { "id": "uuid", "email": "...", "full_name": "..." },
  "message": "Verification email sent"
}
```

### POST /auth/login
```json
// Request
{
  "email": "user@example.com",
  "password": "...",
  "totp_code": "123456"        // optional if 2FA enabled
}
// Response 200
{
  "access_token": "<JWT, 15min TTL>",
  "refresh_token": "<opaque, 30-day TTL>",
  "user": { "id": "...", "email": "...", "full_name": "..." },
  "orgs": [ { "id": "...", "name": "...", "role": "admin" } ]
}
// On brute-force: 429 + account lockout after 5 failures
```

### POST /auth/refresh
```json
// Request
{ "refresh_token": "..." }
// Response 200 — new access_token + rotated refresh_token
// Old refresh_token is immediately invalidated
```

### POST /auth/logout
```json
// Invalidates current session's refresh_token
// Response 204
```

### POST /auth/2fa/enable
```json
// Response 200
{ "totp_uri": "otpauth://...", "backup_codes": ["...", "..."] }
```

### POST /auth/2fa/verify
```json
{ "totp_code": "123456" }
// Response 200 — 2FA confirmed and enabled
```

### GET /auth/sessions
Returns all active sessions for current user.

### DELETE /auth/sessions/:session_id
Revoke a specific session.

---

## MODULE 2: ORGANIZATIONS

### GET /orgs
List organizations the current user belongs to.

### POST /orgs
Create a new organization (owner role assigned automatically).
```json
{ "name": "Acme Corp", "slug": "acme-corp" }
```

### GET /orgs/:org_id
Get organization details.

### PATCH /orgs/:org_id
Update org settings. Requires `owner` role.

### DELETE /orgs/:org_id
Soft-delete org. Requires `owner` role + 2FA confirmation.

### GET /orgs/:org_id/members
List all members with roles.

### POST /orgs/:org_id/members/invite
```json
{ "email": "dev@example.com", "role": "devops_engineer" }
// Response 201 — invite email sent
```

### PATCH /orgs/:org_id/members/:user_id
Change member role. Requires `owner` or `admin`.
```json
{ "role": "admin" }
```

### DELETE /orgs/:org_id/members/:user_id
Remove member. Requires `owner` or `admin`.

---

## MODULE 3: SERVERS

### GET /orgs/:org_id/servers
List all servers in the org.
```
Query params: status, region, provider, tags, page, per_page
```
```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "name": "prod-web-01",
      "hostname": "10.0.0.1",
      "status": "connected",
      "os_type": "ubuntu",
      "os_version": "22.04",
      "last_heartbeat_at": "2026-01-01T00:00:00Z",
      "metrics": { "cpu": 45.2, "ram": 68.1, "disk": 32.0 }
    }
  ]
}
```

### POST /orgs/:org_id/servers
Register a new server (generates agent installation token).
```json
{
  "name": "prod-web-01",
  "hostname": "10.0.0.1",
  "provider": "aws",
  "region": "us-east-1",
  "tags": ["production", "web"]
}
// Response 201
{
  "server": { "id": "uuid", ... },
  "agent_install_command": "curl -sSL https://agent.devops-os.io/install | AGENT_TOKEN=xxx bash"
}
```

### GET /orgs/:org_id/servers/:server_id
Get server detail including current metrics snapshot.

### PATCH /orgs/:org_id/servers/:server_id
Update server metadata (name, tags). Requires `admin`+.

### DELETE /orgs/:org_id/servers/:server_id
Deregister server. Requires `admin`+. Revokes agent token.

### POST /orgs/:org_id/servers/:server_id/maintenance
Toggle maintenance mode.
```json
{ "enabled": true, "reason": "OS upgrade", "duration_minutes": 60 }
```

### GET /orgs/:org_id/servers/:server_id/metrics
Fetch time-series metrics.
```
Query: from=2026-01-01T00:00:00Z&to=2026-01-01T01:00:00Z&step=60s&metrics=cpu,ram,disk,network
```

### GET /orgs/:org_id/servers/:server_id/logs
Fetch aggregated logs.
```
Query: from, to, level=error|warn|info, search=text, container_id, page
```

---

## MODULE 4: JOBS & EXECUTION

### GET /orgs/:org_id/jobs
List jobs with filtering.
```
Query: status, server_id, job_type, created_by, from, to, page
```

### POST /orgs/:org_id/jobs
Create and submit a job.
```json
{
  "server_id": "uuid",
  "job_type": "SCRIPT_RUN",
  "payload": {
    "script": "#!/bin/bash\necho hello",
    "timeout_seconds": 60
  }
}
// Response:
// - 201 if LOW risk and auto-approved
// - 202 if MEDIUM/HIGH risk — approval required
{
  "job": { "id": "uuid", "status": "AWAITING_APPROVAL" },
  "approval_id": "uuid",
  "message": "Job queued and awaiting approval from an admin"
}
```

### GET /orgs/:org_id/jobs/:job_id
Get job detail + steps + output.

### GET /orgs/:org_id/jobs/:job_id/stream
WebSocket endpoint — streams real-time job output.

### POST /orgs/:org_id/jobs/:job_id/cancel
Cancel a pending or executing job. Requires original submitter or admin.

### GET /orgs/:org_id/approvals
List pending approvals.
```
Query: status=PENDING, page
```

### POST /orgs/:org_id/approvals/:approval_id/approve
```json
{ "notes": "LGTM — approved for production" }
```

### POST /orgs/:org_id/approvals/:approval_id/reject
```json
{ "notes": "Not safe to run during business hours" }
```

---

## MODULE 5: DEVOPS TOOLS

### GET /tools/plugins
Browse available tool plugins (public registry).
```
Query: category, search, page
```

### GET /orgs/:org_id/tools
List installed tools across all servers.
```
Query: server_id, status, plugin_id
```

### POST /orgs/:org_id/tools/install
Install a tool on a server.
```json
{
  "plugin_id": "uuid",
  "server_id": "uuid",
  "config": {
    "domain": "n8n.mycompany.com",
    "port": 5678,
    "enable_ssl": true,
    "env_vars": {
      "N8N_BASIC_AUTH_USER": "admin"
    }
  }
}
// Response 202 — job created + approval (HIGH risk)
{
  "job": { "id": "uuid", "status": "AWAITING_APPROVAL" },
  "approval_id": "uuid"
}
```

### GET /orgs/:org_id/tools/:tool_id
Get installed tool detail + health status + container links.

### POST /orgs/:org_id/tools/:tool_id/restart
Restart the tool (MEDIUM risk — approval recommended).

### POST /orgs/:org_id/tools/:tool_id/update
Update tool to latest version (HIGH risk — approval required).

### DELETE /orgs/:org_id/tools/:tool_id
Uninstall tool (HIGH risk — approval required).

### GET /orgs/:org_id/tools/:tool_id/health
Get latest health check result.

### POST /orgs/:org_id/tools/:tool_id/health-check
Trigger an on-demand health check.

---

## MODULE 6: CONTAINERS

### GET /orgs/:org_id/containers
List all containers across all servers.
```
Query: server_id, status, tool_id, image, page
// status filter: running|stopped|failed|restarting|exited
```

### GET /orgs/:org_id/servers/:server_id/containers
List containers on a specific server.

### GET /orgs/:org_id/containers/:container_id
Get container detail + recent metrics.

### POST /orgs/:org_id/containers/:container_id/restart
Restart container (MEDIUM risk).

### POST /orgs/:org_id/containers/:container_id/stop
Stop container (MEDIUM risk).

### POST /orgs/:org_id/containers/:container_id/start
Start a stopped container (MEDIUM risk).

### DELETE /orgs/:org_id/containers/:container_id
Remove container (HIGH risk — approval required).

### GET /orgs/:org_id/containers/:container_id/logs
Stream or page container logs.
```
Query: from, tail=200, follow=true (WebSocket upgrade)
```

---

## MODULE 7: DEPLOYMENTS

### GET /orgs/:org_id/deployments
List deployments.

### POST /orgs/:org_id/deployments
Create a deployment definition.
```json
{
  "name": "api-service",
  "server_id": "uuid",
  "environment": "production",
  "type": "docker",
  "image": "myregistry.io/api:latest",
  "config": { "ports": ["8080:8080"], "replicas": 1 }
}
```

### POST /orgs/:org_id/deployments/:deployment_id/deploy
Trigger a new deployment version (HIGH risk — approval required).
```json
{
  "image": "myregistry.io/api:v2.1.0",
  "env_secret_ids": ["uuid-db-password", "uuid-jwt-secret"]
}
```

### POST /orgs/:org_id/deployments/:deployment_id/rollback
Roll back to a previous version (HIGH risk).
```json
{ "version_id": "uuid", "reason": "v2.1.0 caused 500 errors" }
```

### GET /orgs/:org_id/deployments/:deployment_id/versions
List deployment version history.

---

## MODULE 8: BACKUPS

### GET /orgs/:org_id/backups
List all backups.
```
Query: server_id, status, type, from, to
```

### POST /orgs/:org_id/backups
Schedule/trigger a backup.
```json
{
  "server_id": "uuid",
  "name": "prod-db-backup-daily",
  "type": "full",
  "target_path": "/var/lib/postgresql/data",
  "retention_days": 30
}
// Response 202 — job created
```

### GET /orgs/:org_id/backups/:backup_id
Get backup detail.

### POST /orgs/:org_id/backups/:backup_id/restore
Restore a backup (HIGH risk — approval required).
```json
{
  "server_id": "uuid",           // can restore to different server
  "target_path": "/restore/path",
  "notes": "Restoring after data corruption incident"
}
```

### DELETE /orgs/:org_id/backups/:backup_id
Delete a backup (HIGH risk).

---

## MODULE 9: SECRETS

### GET /orgs/:org_id/secrets
List secrets (metadata only — no values returned).
```
Query: server_id, type
```

### POST /orgs/:org_id/secrets
Create a new secret.
```json
{
  "name": "PROD_DB_PASSWORD",
  "type": "password",
  "value": "actual-secret-value",    // encrypted at API layer immediately
  "server_id": "uuid",               // optional — null = org-wide
  "description": "Production database password"
}
```

### GET /orgs/:org_id/secrets/:secret_id
Get secret metadata (no value).

### POST /orgs/:org_id/secrets/:secret_id/reveal
Get decrypted secret value. Requires `admin`+ role. Always audit-logged.
```json
{ "reason": "Emergency DB connection debug" }
// Response: value exposed for 60s, single-use token
```

### PUT /orgs/:org_id/secrets/:secret_id
Rotate secret value.

### DELETE /orgs/:org_id/secrets/:secret_id
Delete secret. Requires `admin`+.

---

## MODULE 10: SSL CERTIFICATES

### GET /orgs/:org_id/ssl
List certificates.

### POST /orgs/:org_id/ssl
Request a new SSL certificate.
```json
{
  "domain": "n8n.mycompany.com",
  "server_id": "uuid",
  "challenge_type": "http-01",
  "auto_renew": true
}
```

### GET /orgs/:org_id/ssl/:cert_id
Get certificate detail + expiry status.

### POST /orgs/:org_id/ssl/:cert_id/renew
Force-renew a certificate.

### DELETE /orgs/:org_id/ssl/:cert_id
Revoke and remove certificate.

---

## MODULE 11: AI ASSISTANT

### POST /orgs/:org_id/ai/analyze
Analyze a server and get structured suggestions.
```json
// Request
{
  "server_id": "uuid",
  "question": "Why is my nginx container restarting?",
  "context_window": {
    "include_metrics": true,
    "include_logs": true,
    "include_containers": true,
    "log_lines": 200
  }
}
// Response 200
{
  "analysis": "The nginx container is restarting due to ...",
  "root_cause": "OOM kill detected in logs at 14:32 UTC",
  "suggestions": [
    {
      "id": "uuid",
      "title": "Increase nginx container memory limit",
      "description": "Current limit is 128MB, container is regularly hitting it",
      "risk_level": "MEDIUM",
      "requires_approval": true,
      "estimated_downtime": "30 seconds",
      "proposed_job": {
        "job_type": "CONTAINER_UPDATE",
        "payload": { "container_id": "uuid", "mem_limit": "512m" }
      }
    }
  ],
  "related_docs": ["https://..."]
}
```

### POST /orgs/:org_id/ai/suggestions/:suggestion_id/approve
Convert an AI suggestion into a real job with approval flow.
```json
{ "notes": "Approved after reviewing the suggestion" }
// Response 202 — job + approval created
```

### GET /orgs/:org_id/ai/history
Get AI analysis history for audit trail.

---

## MODULE 12: MONITORING & ALERTS

### GET /orgs/:org_id/incidents
List incidents.

### POST /orgs/:org_id/incidents
Create a manual incident.

### PATCH /orgs/:org_id/incidents/:incident_id
Acknowledge or resolve an incident.

### GET /orgs/:org_id/alerts/rules
List alert rules.

### POST /orgs/:org_id/alerts/rules
Create an alert rule.
```json
{
  "server_id": "uuid",
  "metric": "cpu_percent",
  "condition": "gt",
  "threshold": 90,
  "duration_minutes": 5,
  "severity": "high",
  "notification_channels": ["email", "slack"]
}
```

---

## MODULE 13: AUDIT LOGS

### GET /orgs/:org_id/audit
Query audit logs (read-only, immutable).
```
Query: user_id, server_id, action, resource_type, resource_id, from, to, status, page
```
```json
// Response
{
  "data": [
    {
      "id": "uuid",
      "action": "tool.install",
      "user_id": "uuid",
      "server_id": "uuid",
      "status": "success",
      "ip_address": "1.2.3.4",
      "created_at": "2026-01-01T00:00:00Z",
      "metadata": { "tool": "n8n", "version": "1.0.0" }
    }
  ]
}
```

---

## AGENT INGEST APIS (Internal — mTLS only, not public)

These endpoints are called by server agents, not users.
They are on a separate internal port (default: 9200) not exposed publicly.

### POST /ingest/heartbeat
Agent liveness signal.
```json
{ "agent_version": "1.2.0", "server_stats": { ... } }
```

### POST /ingest/metrics
Push metrics batch.

### POST /ingest/logs
Push log entries (batched).

### POST /ingest/containers
Push container state snapshot.

### POST /ingest/job-result
Report job execution result back to control plane.

### GET /ingest/jobs/poll
Agent polls for pending jobs assigned to its server.
Long-poll or SSE (Server-Sent Events) stream.

---

## RATE LIMITS

| Endpoint Group | Limit | Window |
|---|---|---|
| /auth/login | 5 requests | 1 minute |
| /auth/* | 20 requests | 1 minute |
| /orgs/:id/ai/* | 30 requests | 1 hour |
| /ingest/* (agent) | 1000 requests | 1 minute |
| All other endpoints | 200 requests | 1 minute |
| Secret reveal | 10 requests | 1 hour |

Rate limit headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## WEBSOCKET ENDPOINTS

| Path | Purpose |
|---|---|
| `/ws/orgs/:org_id/events` | Real-time org events (job updates, alerts, container state changes) |
| `/ws/orgs/:org_id/jobs/:job_id/stream` | Live job output streaming |
| `/ws/orgs/:org_id/servers/:server_id/logs` | Live log tail |
| `/ws/orgs/:org_id/servers/:server_id/metrics` | Real-time metrics feed |

All WebSocket connections require a valid JWT passed as query param:
`?token=<access_token>` (never in path, never logged in access logs)
