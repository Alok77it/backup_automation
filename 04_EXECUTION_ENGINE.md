# DevOps Control Plane — Execution Engine & Agent Architecture
> Version: 1.0 | Critical Infrastructure Component

---

## 1. OVERVIEW

The Execution Engine is the nervous system of the platform. It is responsible for safely transporting commands from user intent (dashboard) to physical execution on remote servers — with full security, audit, rollback, and retry guarantees.

```
User Dashboard
     │ (REST API — HTTPS)
     ▼
Control Plane API (NestJS)
     │ (creates Job record)
     ▼
Approval Engine (if HIGH/MEDIUM risk)
     │ (APPROVED state)
     ▼
Redis Streams (Job Queue)
     │ (Worker picks up job)
     ▼
Worker Pool (Node.js workers)
     │ (dispatches via mTLS gRPC)
     ▼
Server Agent (Go binary on target server)
     │ (executes in sandbox)
     ▼
Execution Result → Job completion → Audit log → Notification
```

---

## 2. SERVER AGENT ARCHITECTURE

### 2.1 Agent Overview
- **Language**: Go 1.22 (single static binary, ~15MB)
- **Memory footprint**: ~30MB RAM at idle
- **Transport**: mTLS gRPC (port 9100, internal only)
- **Authentication**: Mutual TLS + rotating signed JWT (HMAC-SHA256)
- **No inbound public port**: Agent initiates outbound connections only (polling or persistent gRPC stream)

### 2.2 Agent Components

```
┌─────────────────────────────────────────────────────────────┐
│                     SERVER AGENT (Go)                        │
│                                                              │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────┐ │
│  │  AgentCore   │   │   mTLS Client   │   │  Token Mgr   │ │
│  │  (main loop) │   │  (gRPC + certs) │   │  (rotation)  │ │
│  └──────┬───────┘   └─────────────────┘   └──────────────┘ │
│         │                                                    │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │                  Command Router                       │   │
│  │  Routes incoming jobs to appropriate executor        │   │
│  └──────┬──────┬──────┬──────┬──────┬──────────────────┘   │
│         │      │      │      │      │                        │
│  ┌──────▼─┐ ┌──▼──┐ ┌─▼──┐ ┌▼────┐ ┌▼──────────────────┐  │
│  │Command │ │Cont.│ │Pkg │ │Svc  │ │   Metrics/Log     │  │
│  │Executor│ │Mgr  │ │Mgr │ │Mgr  │ │   Collector       │  │
│  └────────┘ └─────┘ └────┘ └─────┘ └───────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Sandbox (namespaced, resource-limited)     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Agent Installation

```bash
# Generated per-server install command
curl -sSL https://agent.devops-os.io/install.sh \
  | AGENT_TOKEN="<one-time-registration-token>" \
    CONTROL_PLANE_URL="https://api.devops-os.io" \
    bash

# install.sh does:
# 1. Download agent binary matching OS/arch
# 2. Verify SHA256 checksum
# 3. Register with control plane (exchanges registration token for mTLS cert)
# 4. Install as systemd service (or launchd on Mac, NSSM on Windows)
# 5. Start agent + send initial heartbeat
```

### 2.4 Agent Registration Flow

```
1. Install script sends POST /agent/register with one-time token
2. Control plane validates token (expires in 24h, single-use)
3. Control plane issues:
   - mTLS client certificate (signed by internal CA, 90-day TTL)
   - Service account JWT (30-day TTL, rotates automatically)
4. Agent stores certs in /etc/devops-agent/certs/ (root-only)
5. Agent opens persistent gRPC stream to control plane
6. Control plane marks server as "connected"
7. Registration token is permanently invalidated
```

### 2.5 Agent Security Constraints

```
WHITELIST of permitted operations (everything else = DENIED):
┌──────────────────────────────────────────────────────────────┐
│  ALLOWED                           DENIED                     │
│  ─────────────────────────────     ─────────────────────────  │
│  systemctl start/stop/restart      rm -rf / (destructive)     │
│  docker start/stop/restart         passwd/useradd (user mgmt) │
│  docker pull (specific image)      raw network access         │
│  docker-compose up/down            crontab modification        │
│  apt-get install (via plugin)      SSH config modification     │
│  mkdir/cp/mv (in allowed paths)    iptables modification       │
│  read logs (allowed paths only)    kernel parameter changes    │
│  nginx/traefik config reload       arbitrary curl/wget        │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. JOB QUEUE SYSTEM

### 3.1 Architecture — Redis Streams

```
Producer (API Worker):
  XADD jobs:org_<org_id>:server_<server_id> * job_id <uuid> payload <json>

Consumer Group:
  XGROUP CREATE jobs:org_<org_id>:server_<server_id> workers $ MKSTREAM
  
Workers:
  XREADGROUP GROUP workers worker-<id> COUNT 1 BLOCK 5000
  STREAMS jobs:org_<org_id>:server_<server_id> >
```

### 3.2 Queue Design

```
Redis Streams structure:
  jobs:server:<server_id>         ← per-server queue (ensures ordered execution)
  jobs:priority:high              ← high-priority cross-server queue
  jobs:dead-letter                ← failed jobs after max retries
  jobs:scheduled                  ← future-scheduled jobs (sorted set by execution time)
  results:<job_id>                ← job result stream (TTL 24h)
```

### 3.3 Job Lifecycle

```
                    ┌─── CREATED ──►── DB record created ───┐
                    │                                         │
                    │                                         ▼
                    │                              [Risk Assessment]
                    │                                    │
                    │                     ┌──────────────┤
                    │                     │              │
                    │                  LOW risk       MEDIUM/HIGH risk
                    │                     │              │
                    │                     │              ▼
                    │                     │    AWAITING_APPROVAL
                    │                     │    (human must approve)
                    │                     │              │
                    │                     │         ─────┴─────
                    │                     │        │           │
                    │                     │     Approved    Rejected
                    │                     │        │           │
                    │                     │        ▼           ▼
                    │                     └──► QUEUED      REJECTED
                    │                          │            (notified)
                    │                          ▼
                    │                     Worker picks up
                    │                          │
                    │                          ▼
                    │                      EXECUTING
                    │                    /           \
                    │                COMPLETED      FAILED
                    │                    │              │
                    │                    │         [retry_count < max]
                    │                    │              │
                    │                    │         ──────────
                    │                    │        │          │
                    │                    │    retry     max exceeded
                    │                    │    (back     │
                    │                    │   to queue)  ▼
                    │                    │         ROLLED_BACK
                    └────────────────────┘         (if rollback exists)
```

### 3.4 Worker Pool

```typescript
// Worker configuration
const WORKER_CONFIG = {
  concurrency: 10,              // jobs processed simultaneously
  maxRetries: 3,
  retryDelay: exponentialBackoff,  // 1s, 2s, 4s
  timeout: 300_000,             // 5 minute default
  heartbeatInterval: 10_000,    // 10s worker heartbeat
};

// Worker isolation:
// - Each job runs in isolated async context
// - No shared mutable state between jobs
// - Worker crash = job marked FAILED, re-queued by health monitor
```

---

## 4. EXECUTION SECURITY MODEL

### 4.1 Pre-Execution Validation

```
Before ANY command is dispatched to an agent:

Step 1: Token Validation
  → Verify worker service account JWT is valid and not revoked

Step 2: Job Ownership Validation
  → job.org_id == agent.org_id (HARD BLOCK if mismatch)
  → job.server_id == agent.server_id (HARD BLOCK if mismatch)

Step 3: Approval Verification
  → For MEDIUM/HIGH jobs: verify approval record exists with status=APPROVED
  → Approval must be by a user with sufficient role
  → Approval must not be expired (default 24h window)

Step 4: Command Sanitization
  → Validate command against whitelist
  → Strip/reject shell injection patterns
  → Validate file paths against allowed-paths list

Step 5: Audit Log (before execution)
  → Write EXECUTING audit record BEFORE dispatching
  → If this write fails → abort job
```

### 4.2 mTLS Configuration

```yaml
# Control Plane CA setup (one-time)
Internal CA:
  algorithm: ECDSA P-384
  validity: 10 years
  stored in: HashiCorp Vault (or encrypted HSM)

Agent Certificates:
  algorithm: ECDSA P-256
  validity: 90 days
  CN: "agent-<server_id>"
  SANs: IP of server
  signed-by: Internal CA

Certificate Rotation:
  - Agent auto-renews 7 days before expiry
  - Control plane validates cert against CRL (Certificate Revocation List)
  - Revoked certs = agent disconnected immediately
```

### 4.3 Command Injection Prevention

```go
// Go agent — command execution (safe pattern)
func (e *Executor) Run(job *Job) error {
    // NEVER use shell interpolation
    // NEVER: exec.Command("bash", "-c", userInput)
    
    // Parse command into argv array
    args, err := shellquote.Split(job.Command)
    if err != nil {
        return fmt.Errorf("invalid command format: %w", err)
    }
    
    // Validate binary against whitelist
    if !e.whitelist.IsAllowed(args[0]) {
        return fmt.Errorf("command not in whitelist: %s", args[0])
    }
    
    // Execute with explicit binary path (no PATH injection)
    cmd := exec.CommandContext(ctx, e.resolveBinary(args[0]), args[1:]...)
    cmd.Env = e.buildSafeEnv(job.EnvVars)  // filtered, no secrets in logs
    cmd.Dir = e.validateWorkDir(job.WorkDir)
    
    // Resource limits via cgroups
    cmd.SysProcAttr = &syscall.SysProcAttr{
        Setpgid:    true,
        Pdeathsig:  syscall.SIGKILL,
        CgroupFD:   e.cgroupFD,  // CPU + memory limits
    }
    
    return e.captureAndStream(cmd, job.ID)
}
```

---

## 5. RETRY & ROLLBACK LOGIC

### 5.1 Retry Strategy

```
RetryPolicy per job type:
┌────────────────────┬────────┬─────────────────────┬──────────────────────┐
│ Job Type           │ Max    │ Backoff             │ Conditions           │
│                    │ Retry  │                     │                      │
├────────────────────┼────────┼─────────────────────┼──────────────────────┤
│ TOOL_INSTALL       │ 3      │ Exponential (1m,2m,4m)│ Network timeout OK │
│ TOOL_UNINSTALL     │ 2      │ Fixed (30s)         │ Never on DENIED      │
│ CONTAINER_RESTART  │ 3      │ Linear (10s)        │ Always               │
│ SCRIPT_RUN         │ 0      │ N/A                 │ User must re-submit  │
│ DEPLOY             │ 2      │ Exponential         │ Pre-deploy check OK  │
│ BACKUP             │ 3      │ Exponential         │ Always               │
│ RESTORE            │ 1      │ Fixed (5m)          │ Manual verify needed │
│ SSL_ISSUE          │ 5      │ Exponential (1h max)│ Always               │
└────────────────────┴────────┴─────────────────────┴──────────────────────┘
```

### 5.2 Rollback System

```
Each HIGH-risk job must declare a rollback_spec:

interface RollbackSpec {
  strategy: 'SCRIPT' | 'PREVIOUS_VERSION' | 'SNAPSHOT' | 'NONE';
  rollback_script?: string;     // reversal script
  snapshot_id?: string;         // pre-execution snapshot reference
  version_id?: string;          // for deployments: version to revert to
  timeout_seconds: number;
}

Rollback Triggers:
  1. Job fails after max retries
  2. Health check fails post-execution (within 5 min grace period)
  3. Manual rollback triggered by user
  4. AI assistant flags post-deployment anomaly

Rollback process:
  1. Create ROLLBACK job (approved automatically if parent was approved)
  2. Agent executes rollback_script OR restores snapshot
  3. Health check runs to verify rollback success
  4. Incident created if rollback also fails
```

---

## 6. JOB OUTPUT STREAMING

```
1. Agent captures stdout/stderr of executing command
2. Output chunked into 4KB blocks
3. Chunks streamed to control plane via gRPC stream
4. Control plane writes to Redis Stream: results:<job_id>
5. Frontend subscribes via WebSocket: /ws/jobs/:job_id/stream
6. Results persisted to PostgreSQL job_steps.output after completion
7. Redis stream TTL: 24h (raw stream)
8. PostgreSQL: retained per data retention policy (90 days)

Sensitive output filtering:
- Agent applies regex patterns to mask common secret formats in output:
  AWS keys: AKIA[A-Z0-9]{16}
  Passwords: password=<REDACTED>
  API tokens: token=[A-Za-z0-9_-]{20,}
  Private keys: -----BEGIN.*KEY-----
```

---

## 7. AGENT HEALTH MONITORING

```
Heartbeat flow:
  - Agent sends heartbeat every 30 seconds
  - Control plane updates server.last_heartbeat_at
  
  Staleness detection (background cron, every 60s):
    IF now() - last_heartbeat_at > 90s:
      server.status = 'unreachable'
      Create incident (severity=high)
      Notify org admin

  Reconnection:
    - Agent uses exponential backoff (5s, 10s, 20s... max 5m)
    - On reconnect: re-validates mTLS cert, sends full status sync
    - Pending jobs in queue remain; agent fetches on reconnect
```

---

## 8. WORKER POOL SCALING

```
Worker scaling strategy:
  - Default: 3 worker processes per API pod
  - Auto-scale: based on Redis stream queue depth
    - queue_depth > 50 → scale up workers
    - queue_depth < 5 for 5m → scale down
  - Max: 20 workers (configurable)
  - Per-server concurrency: 1 (jobs on same server are serialized by default)
    - Can be overridden per org setting (allow parallel jobs = true)

Worker process isolation:
  - Each worker is a separate Node.js child process
  - Crash isolation: one worker crash doesn't affect others
  - Memory limit: 512MB per worker (configurable)
  - Worker recycled after 1000 jobs (prevents memory leaks)
```

---

## 9. AUDIT LOGGING FOR EXECUTION

Every execution event writes to audit_logs:
```
Events written:
  job.created         → job submitted
  job.approval_req    → approval requested
  job.approved        → approved by user X
  job.rejected        → rejected by user X
  job.dispatched      → sent to agent
  job.executing       → agent confirmed start
  job.step_complete   → each step finishes
  job.completed       → final success
  job.failed          → failure with error
  job.retry           → retry attempt N
  job.rollback_start  → rollback initiated
  job.rollback_done   → rollback completed
  job.cancelled       → cancelled by user
  
Fields always present:
  org_id, server_id, job_id, user_id, ip_address,
  timestamp, duration_ms, before_state, after_state
```
