# DevOps Control Plane — Database Schema Design
> Version: 1.0 | Database: PostgreSQL 15 | Multi-Tenant Architecture

---

## DESIGN PRINCIPLES

1. **Tenant Isolation**: Every table with org-scoped data includes `org_id` as a non-nullable foreign key
2. **Soft Deletes**: Sensitive records use `deleted_at` rather than hard DELETE
3. **Immutable Audit**: The `audit_logs` table is append-only — no UPDATE or DELETE permitted via application
4. **Row-Level Security**: PostgreSQL RLS policies enforce `org_id` scoping at the DB layer as a secondary defense
5. **Indexing Strategy**: Composite indexes on `(org_id, <entity_id>)` for all frequently-queried paths
6. **UUID Primary Keys**: Prevents enumeration attacks
7. **Encrypted Columns**: Secret values stored via `pgcrypto` with application-layer AES-256 fallback

---

## SCHEMA OVERVIEW

```
organizations ──┬── users
                ├── org_members (junction)
                ├── servers
                │     ├── server_agents
                │     ├── containers
                │     ├── server_metrics (time-series ref)
                │     └── server_logs (ref to Loki)
                ├── jobs
                │     ├── job_steps
                │     └── job_approvals
                ├── deployments
                │     └── deployment_versions
                ├── installed_tools
                ├── backups
                │     └── backup_restores
                ├── secrets
                ├── ssl_certificates
                ├── incidents
                │     └── incident_comments
                └── audit_logs
```

---

## TABLE DEFINITIONS

### organizations
```sql
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    plan            VARCHAR(50)  NOT NULL DEFAULT 'starter',  -- starter|pro|enterprise
    status          VARCHAR(50)  NOT NULL DEFAULT 'active',   -- active|suspended|deleted
    max_servers     INT          NOT NULL DEFAULT 5,
    max_users       INT          NOT NULL DEFAULT 10,
    settings        JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;
```

### users
```sql
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(320) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    full_name           VARCHAR(255) NOT NULL,
    avatar_url          TEXT,
    totp_secret         TEXT,                          -- AES-256 encrypted
    totp_enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
    email_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
    status              VARCHAR(50)  NOT NULL DEFAULT 'active', -- active|suspended|deleted
    last_login_at       TIMESTAMPTZ,
    last_login_ip       INET,
    failed_login_count  INT          NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status);
```

### org_members
```sql
CREATE TABLE org_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL,  -- owner|admin|devops_engineer|viewer
    invited_by      UUID REFERENCES users(id),
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending|active|revoked
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);

CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_role ON org_members(org_id, role);
```

### auth_sessions
```sql
CREATE TABLE auth_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id              UUID REFERENCES organizations(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL UNIQUE,
    access_token_jti    VARCHAR(255),          -- JWT ID for revocation
    ip_address          INET,
    user_agent          TEXT,
    device_fingerprint  VARCHAR(255),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    last_used_at        TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON auth_sessions(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_sessions_token ON auth_sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires ON auth_sessions(expires_at);
```

### servers
```sql
CREATE TABLE servers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    hostname            VARCHAR(255) NOT NULL,
    ip_address          INET,
    os_type             VARCHAR(50),          -- ubuntu|debian|centos|rhel|alpine
    os_version          VARCHAR(50),
    arch                VARCHAR(20),          -- amd64|arm64
    region              VARCHAR(100),
    provider            VARCHAR(100),         -- aws|gcp|azure|hetzner|custom
    tags                JSONB        NOT NULL DEFAULT '[]',
    status              VARCHAR(50)  NOT NULL DEFAULT 'pending',
    -- pending|connected|disconnected|unreachable|maintenance
    agent_version       VARCHAR(50),
    last_heartbeat_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_servers_org ON servers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_servers_status ON servers(org_id, status);
CREATE INDEX idx_servers_heartbeat ON servers(last_heartbeat_at);
```

### server_agents
```sql
CREATE TABLE server_agents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id           UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES organizations(id),
    token_hash          VARCHAR(255) NOT NULL UNIQUE,    -- rotating signed token hash
    certificate_serial  VARCHAR(255),                    -- mTLS cert serial
    certificate_expiry  TIMESTAMPTZ,
    last_connected_at   TIMESTAMPTZ,
    last_ip             INET,
    agent_version       VARCHAR(50),
    capabilities        JSONB NOT NULL DEFAULT '[]',
    revoked             BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_server ON server_agents(server_id);
CREATE INDEX idx_agents_token ON server_agents(token_hash) WHERE revoked = FALSE;
```

### server_metrics_snapshots
```sql
-- Lightweight snapshot table; full time-series lives in VictoriaMetrics
-- This table stores latest state for dashboard quick-load
CREATE TABLE server_metrics_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id),
    cpu_percent     NUMERIC(5,2),
    ram_percent     NUMERIC(5,2),
    disk_percent    NUMERIC(5,2),
    network_in_kbps BIGINT,
    network_out_kbps BIGINT,
    load_avg_1m     NUMERIC(6,2),
    load_avg_5m     NUMERIC(6,2),
    load_avg_15m    NUMERIC(6,2),
    uptime_seconds  BIGINT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retain only latest per server (upsert pattern)
CREATE UNIQUE INDEX idx_metrics_snap_server ON server_metrics_snapshots(server_id);
```

### containers
```sql
CREATE TABLE containers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id           UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES organizations(id),
    docker_id           VARCHAR(128) NOT NULL,
    name                VARCHAR(255) NOT NULL,
    image               VARCHAR(500) NOT NULL,
    image_tag           VARCHAR(255),
    status              VARCHAR(50)  NOT NULL,
    -- running|stopped|failed|restarting|paused|exited|dead
    tool_id             UUID REFERENCES installed_tools(id),   -- link to managed tool
    ports               JSONB NOT NULL DEFAULT '[]',
    env_vars_redacted   JSONB NOT NULL DEFAULT '{}',           -- NO raw secrets
    labels              JSONB NOT NULL DEFAULT '{}',
    cpu_percent         NUMERIC(5,2),
    mem_usage_mb        BIGINT,
    mem_limit_mb        BIGINT,
    restart_count       INT NOT NULL DEFAULT 0,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_containers_server ON containers(server_id);
CREATE INDEX idx_containers_org ON containers(org_id);
CREATE INDEX idx_containers_status ON containers(org_id, status);
CREATE INDEX idx_containers_tool ON containers(tool_id) WHERE tool_id IS NOT NULL;
CREATE INDEX idx_containers_docker_id ON containers(server_id, docker_id);
```

### jobs
```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID REFERENCES servers(id),
    created_by      UUID NOT NULL REFERENCES users(id),
    job_type        VARCHAR(100) NOT NULL,
    -- TOOL_INSTALL|TOOL_UNINSTALL|CONTAINER_RESTART|CONTAINER_STOP|
    -- SCRIPT_RUN|DEPLOY|SERVICE_RESTART|CONFIG_UPDATE|BACKUP|RESTORE
    risk_level      VARCHAR(20)  NOT NULL DEFAULT 'LOW',  -- LOW|MEDIUM|HIGH
    status          VARCHAR(50)  NOT NULL DEFAULT 'PENDING',
    -- PENDING|AWAITING_APPROVAL|APPROVED|REJECTED|EXECUTING|COMPLETED|FAILED|ROLLED_BACK|CANCELLED
    payload         JSONB        NOT NULL DEFAULT '{}',
    result          JSONB,
    error_message   TEXT,
    retry_count     INT          NOT NULL DEFAULT 0,
    max_retries     INT          NOT NULL DEFAULT 3,
    timeout_seconds INT          NOT NULL DEFAULT 300,
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_org ON jobs(org_id);
CREATE INDEX idx_jobs_server ON jobs(server_id);
CREATE INDEX idx_jobs_status ON jobs(org_id, status);
CREATE INDEX idx_jobs_created_by ON jobs(created_by);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

### job_steps
```sql
CREATE TABLE job_steps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    step_index  INT  NOT NULL,
    name        VARCHAR(255) NOT NULL,
    command     TEXT,
    status      VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    output      TEXT,
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_job_steps_job ON job_steps(job_id);
```

### job_approvals
```sql
CREATE TABLE job_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id),
    requested_by    UUID NOT NULL REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    status          VARCHAR(50) NOT NULL DEFAULT 'PENDING',  -- PENDING|APPROVED|REJECTED
    notes           TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at      TIMESTAMPTZ
);

CREATE INDEX idx_approvals_job ON job_approvals(job_id);
CREATE INDEX idx_approvals_org_pending ON job_approvals(org_id, status)
    WHERE status = 'PENDING';
```

### tool_plugins
```sql
-- Central registry of available tool plugins (platform-managed)
CREATE TABLE tool_plugins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,    -- docker|kubernetes|n8n|jenkins|etc.
    display_name    VARCHAR(255) NOT NULL,
    version         VARCHAR(50)  NOT NULL,
    category        VARCHAR(100),                    -- container|ci-cd|automation|monitoring
    description     TEXT,
    icon_url        TEXT,
    install_script  TEXT         NOT NULL,
    uninstall_script TEXT        NOT NULL,
    health_check_cmd TEXT        NOT NULL,
    compose_template TEXT,                           -- docker-compose.yml template
    config_schema   JSONB        NOT NULL DEFAULT '{}',
    requirements    JSONB        NOT NULL DEFAULT '{}',  -- min RAM, disk, etc.
    os_support      JSONB        NOT NULL DEFAULT '[]',  -- ubuntu|debian|etc.
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plugins_name ON tool_plugins(name) WHERE is_active = TRUE;
CREATE INDEX idx_plugins_category ON tool_plugins(category);
```

### installed_tools
```sql
CREATE TABLE installed_tools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID NOT NULL REFERENCES servers(id),
    plugin_id       UUID NOT NULL REFERENCES tool_plugins(id),
    installed_by    UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(50)  NOT NULL DEFAULT 'installing',
    -- installing|healthy|degraded|stopped|uninstalling|failed
    version         VARCHAR(50),
    config          JSONB        NOT NULL DEFAULT '{}',  -- user-provided config
    install_job_id  UUID REFERENCES jobs(id),
    service_url     TEXT,                                -- internal service endpoint
    public_url      TEXT,                                -- if publicly exposed via SSL proxy
    ssl_cert_id     UUID,                                -- FK to ssl_certificates
    health_last_checked_at TIMESTAMPTZ,
    health_status   VARCHAR(50),
    installed_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_installed_tools_org ON installed_tools(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_installed_tools_server ON installed_tools(server_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_installed_tools_unique ON installed_tools(server_id, plugin_id)
    WHERE deleted_at IS NULL;
```

### deployments
```sql
CREATE TABLE deployments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID NOT NULL REFERENCES servers(id),
    name            VARCHAR(255) NOT NULL,
    environment     VARCHAR(50)  NOT NULL DEFAULT 'production',
    type            VARCHAR(50)  NOT NULL,   -- docker|compose|k8s|script|binary
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
    -- pending|deploying|live|failed|rolling_back|rolled_back
    current_version_id UUID,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_deployments_org ON deployments(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_deployments_server ON deployments(server_id);
```

### deployment_versions
```sql
CREATE TABLE deployment_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id   UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id),
    version         VARCHAR(100) NOT NULL,
    image           TEXT,
    config          JSONB        NOT NULL DEFAULT '{}',
    env_vars        JSONB        NOT NULL DEFAULT '{}',   -- reference to secrets, not raw
    rollback_to_id  UUID REFERENCES deployment_versions(id),
    deployed_by     UUID REFERENCES users(id),
    job_id          UUID REFERENCES jobs(id),
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
    deployed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dep_versions_deployment ON deployment_versions(deployment_id);
```

### backups
```sql
CREATE TABLE backups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID NOT NULL REFERENCES servers(id),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50)  NOT NULL,   -- full|incremental|differential|snapshot
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
    -- pending|running|completed|failed|expired
    target_path     TEXT,                    -- what was backed up
    storage_path    TEXT,                    -- where (S3/MinIO path, encrypted)
    size_bytes      BIGINT,
    checksum        VARCHAR(255),
    encryption_key_id VARCHAR(255),          -- reference to vault key, not raw key
    retention_days  INT          NOT NULL DEFAULT 30,
    created_by      UUID REFERENCES users(id),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backups_org ON backups(org_id);
CREATE INDEX idx_backups_server ON backups(server_id);
CREATE INDEX idx_backups_status ON backups(org_id, status);
CREATE INDEX idx_backups_expires ON backups(expires_at) WHERE status = 'completed';
```

### backup_restores
```sql
CREATE TABLE backup_restores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id       UUID NOT NULL REFERENCES backups(id),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID NOT NULL REFERENCES servers(id),
    requested_by    UUID NOT NULL REFERENCES users(id),
    job_id          UUID REFERENCES jobs(id),
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
    target_path     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_restores_backup ON backup_restores(backup_id);
CREATE INDEX idx_restores_org ON backup_restores(org_id);
```

### secrets
```sql
CREATE TABLE secrets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    server_id       UUID REFERENCES servers(id),           -- NULL = org-wide secret
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50)  NOT NULL,
    -- ssh_key|api_key|password|token|tls_cert|env_var|cloud_credential
    encrypted_value TEXT         NOT NULL,                  -- AES-256-GCM encrypted
    key_version     INT          NOT NULL DEFAULT 1,        -- for key rotation
    description     TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    last_accessed_at TIMESTAMPTZ,
    last_rotated_at TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(org_id, name, server_id)
);

-- NOTE: encrypted_value is NEVER exposed in logs, AI context, or API responses
-- API returns secret metadata only; value returned via separate /reveal endpoint
-- with audit logging and rate limiting

CREATE INDEX idx_secrets_org ON secrets(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_secrets_server ON secrets(server_id) WHERE deleted_at IS NULL;
```

### ssl_certificates
```sql
CREATE TABLE ssl_certificates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID NOT NULL REFERENCES servers(id),
    domain          VARCHAR(255) NOT NULL,
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
    -- pending|issuing|active|expiring_soon|expired|revoked|failed
    provider        VARCHAR(50)  NOT NULL DEFAULT 'letsencrypt',
    cert_serial     VARCHAR(255),
    issued_at       TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    auto_renew      BOOLEAN      NOT NULL DEFAULT TRUE,
    last_renewed_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    challenge_type  VARCHAR(50)  DEFAULT 'http-01',   -- http-01|dns-01
    error_message   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ssl_org ON ssl_certificates(org_id);
CREATE INDEX idx_ssl_domain ON ssl_certificates(domain);
CREATE INDEX idx_ssl_expiry ON ssl_certificates(expires_at) WHERE status = 'active';
```

### incidents
```sql
CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    server_id       UUID REFERENCES servers(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    severity        VARCHAR(20)  NOT NULL DEFAULT 'medium',  -- critical|high|medium|low
    status          VARCHAR(50)  NOT NULL DEFAULT 'open',    -- open|acknowledged|resolved
    source          VARCHAR(50)  NOT NULL DEFAULT 'auto',    -- auto|manual|ai
    acknowledged_by UUID REFERENCES users(id),
    resolved_by     UUID REFERENCES users(id),
    opened_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_incidents_org ON incidents(org_id);
CREATE INDEX idx_incidents_server ON incidents(server_id);
CREATE INDEX idx_incidents_status ON incidents(org_id, status);
```

### audit_logs
```sql
-- IMMUTABLE TABLE: Application MUST NOT perform UPDATE or DELETE on this table.
-- Enforce via PostgreSQL trigger + role permissions.
CREATE TABLE audit_logs (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID         NOT NULL,     -- no FK — must survive org deletion
    user_id         UUID,                       -- no FK — must survive user deletion
    server_id       UUID,
    action          VARCHAR(200) NOT NULL,
    -- e.g. job.create, tool.install, user.login, secret.reveal, approval.approve
    resource_type   VARCHAR(100),
    resource_id     UUID,
    ip_address      INET,
    user_agent      TEXT,
    request_id      UUID,
    before_state    JSONB,
    after_state     JSONB,
    metadata        JSONB        NOT NULL DEFAULT '{}',
    status          VARCHAR(50)  NOT NULL DEFAULT 'success',  -- success|failure|denied
    error_message   TEXT,
    duration_ms     INT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Immutability enforcement
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is immutable — modifications not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Partitioning by month for query performance at scale
-- (implement with pg_partman for production)
CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_server ON audit_logs(server_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
```

---

## ROW-LEVEL SECURITY POLICIES

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE installed_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Application connects with a role that has current_org_id set via session variable
-- SET LOCAL app.current_org_id = '<org_id>';

CREATE POLICY org_isolation ON servers
    USING (org_id = current_setting('app.current_org_id')::UUID);

CREATE POLICY org_isolation ON jobs
    USING (org_id = current_setting('app.current_org_id')::UUID);

-- Similarly for all tenant-scoped tables
-- This is a SECONDARY enforcement layer (primary = application ORM filter)
```

---

## INDEXING STRATEGY SUMMARY

| Table | Key Indexes | Reasoning |
|---|---|---|
| servers | (org_id, status), (last_heartbeat_at) | Dashboard filter, stale agent detection |
| jobs | (org_id, status), (created_at DESC) | Queue poll, history view |
| containers | (org_id, status), (server_id) | Dashboard filter, server drill-down |
| audit_logs | (org_id, created_at DESC), (user_id) | Compliance queries, user history |
| secrets | (org_id) with partial WHERE deleted_at IS NULL | Vault listing |
| ssl_certificates | (expires_at) WHERE active | Auto-renewal job query |
| server_metrics_snapshots | UNIQUE (server_id) | Upsert latest snapshot |

---

## DATA RETENTION POLICY

| Table | Retention | Mechanism |
|---|---|---|
| audit_logs | 7 years | Partition + archive to S3 |
| server_metrics_snapshots | Latest only | Upsert |
| job_steps | 90 days | Cron cleanup job |
| containers | 30 days after last_updated | Soft purge |
| backups (metadata) | Follows backup retention_days | Scheduled expiry |
| auth_sessions | 30 days after expiry | Cron cleanup |
