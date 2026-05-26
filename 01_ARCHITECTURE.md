# DevOps Control Plane — System Architecture Design
> Version: 1.0 | Classification: Internal Engineering Specification

---

## 1. PRODUCT OVERVIEW

A unified, dashboard-driven DevOps Operating System (DevOps-OS) built as a multi-tenant SaaS platform. It allows engineering teams to manage servers, deploy tools, run automation workflows, monitor infrastructure, and leverage AI-assisted operations — all without requiring CLI access.

---

## 2. FOUR-LAYER ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 4: AI ORCHESTRATION                        │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │ Context Eng. │  │ Prompt Builder  │  │ Structured Output Engine │   │
│  │ (per-server) │  │ (role-aware)    │  │ (JSON suggestion only)   │   │
│  └──────────────┘  └─────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
         │ SUGGESTIONS ONLY — never direct execution
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 3: EXECUTION ENGINE                        │
│  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Job Queue  │  │ Worker Pool  │  │ Approval │  │  Audit Logger    │ │
│  │ (Redis)    │  │ (N workers)  │  │ Engine   │  │  (immutable)     │ │
│  └────────────┘  └──────────────┘  └──────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    SERVER AGENT MESH (mTLS)                       │  │
│  │  [Agent@Server1]  [Agent@Server2]  [Agent@ServerN]               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
         ▲ command dispatch / result collection
         │
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 2: CONTROL PLANE                           │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Multi-Tenant │  │ RBAC Engine  │  │ Tool Manager │  │  Secrets  │ │
│  │  Org Manager  │  │ (per-action) │  │ (plugins)    │  │  Vault    │ │
│  └───────────────┘  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │  Deployment   │  │  SSL/Proxy   │  │  Approval Workflow Engine     │ │
│  │  Manager      │  │  Automation  │  │  (PENDING→APPROVED→EXEC)     │ │
│  └───────────────┘  └──────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
         ▲ data queries / ingestion
         │
┌─────────────────────────────────────────────────────────────────────────┐
│                       LAYER 1: OBSERVABILITY                             │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Metrics    │  │    Logs    │  │  Container   │  │    Backup     │ │
│  │  Pipeline   │  │  Pipeline  │  │  Monitor     │  │    Tracker    │ │
│  │(Prometheus) │  │  (Loki)    │  │  (Docker API)│  │               │ │
│  └─────────────┘  └────────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. COMPONENT CATALOGUE

### 3.1 Frontend (Next.js 14 App Router)
| Component | Responsibility |
|---|---|
| `DashboardShell` | Org/server selector, global nav, notifications |
| `ServerGrid` | Multi-server overview with health status |
| `ToolMarketplace` | Browse/install/remove DevOps tools |
| `ContainerPanel` | Running/stopped/failed container view with filters |
| `LogViewer` | Streaming log display with search |
| `MetricsDashboard` | CPU/RAM/Disk/Network time-series charts |
| `AIAssistant` | Context-locked chat interface, approval preview |
| `ApprovalQueue` | Pending actions requiring human sign-off |
| `AuditLog` | Searchable, tamper-evident action history |
| `SecretManager` | Encrypted credential store UI |
| `DeploymentManager` | App deploy wizard with rollback control |
| `OrgSettings` | Members, roles, billing, network settings |

### 3.2 Backend API (NestJS / FastAPI)
| Service | Responsibility |
|---|---|
| `AuthService` | JWT + refresh rotation, 2FA, session tracking |
| `OrgService` | Tenant lifecycle, member management |
| `ServerService` | Server registration, health tracking |
| `JobService` | Job creation, dispatch, status tracking |
| `ToolService` | Plugin lifecycle orchestration |
| `DeploymentService` | Deployment pipeline management |
| `AIService` | Context assembly, LLM proxy, output validation |
| `ApprovalService` | Approval state machine |
| `SecretService` | AES-256 encrypted vault operations |
| `AuditService` | Immutable log writes |
| `MonitoringService` | Metrics ingestion, alerting |
| `ContainerService` | Docker/k8s container data aggregation |
| `BackupService` | Backup scheduling, tracking, restore |
| `SSLService` | Certificate issuance, renewal, validation |
| `NotificationService` | Email/Slack/webhook alerts |

### 3.3 Server Agent (Go binary)
| Component | Responsibility |
|---|---|
| `AgentCore` | Main loop, heartbeat, command listener |
| `CommandExecutor` | Sandboxed execution of whitelisted ops |
| `MetricsCollector` | Push CPU/RAM/Disk/Network to control plane |
| `ContainerWatcher` | Docker daemon socket reader |
| `LogStreamer` | Tail and ship logs to aggregator |
| `mTLSClient` | Mutual TLS auth with control plane |
| `JobWorker` | Execute jobs received from queue |

### 3.4 Infrastructure Services
| Service | Technology | Purpose |
|---|---|---|
| Job Queue | Redis Streams | Async job dispatch |
| Log Store | Loki + S3 | Structured log storage |
| Metrics Store | VictoriaMetrics | Time-series metrics |
| Relational DB | PostgreSQL 15 | Core application data |
| Cache | Redis | Sessions, rate limits, locks |
| Secrets Vault | HashiCorp Vault (or custom AES module) | Encrypted secrets |
| Object Store | S3/MinIO | Backups, artifacts |
| Message Bus | Redis Pub/Sub | Real-time events to frontend |
| Reverse Proxy | Traefik v3 | SSL, routing, load balancing |

---

## 4. DATA FLOW DIAGRAMS

### 4.1 Tool Installation Flow
```
User Dashboard
    │
    ▼
[POST /api/tools/install] ──► AuthService (verify JWT + RBAC)
    │
    ▼
ApprovalService (create PENDING approval record)
    │
    │── [Viewer/non-admin] ──► REJECTED
    │── [Admin/Owner] ──────► APPROVED instantly OR requires peer approval
    │
    ▼
JobService.createJob({type: TOOL_INSTALL, server_id, tool_id, params})
    │
    ▼
Redis Streams (job enqueued)
    │
    ▼
Worker picks up job
    │
    ▼
Worker → Agent@TargetServer (mTLS gRPC call)
    │
    ▼
Agent executes: OS detect → dependency check → template render → docker-compose up
    │
    ▼
Agent streams execution logs back via WebSocket
    │
    ▼
JobService updates status (COMPLETED/FAILED)
    │
    ▼
AuditService writes immutable record
    │
    ▼
NotificationService fires alert
    │
    ▼
ContainerService detects new container → refreshes dashboard
```

### 4.2 AI Suggestion Flow (Strictly Non-Executing)
```
User selects Server X in dashboard
    │
    ▼
AIService.buildContext({
    server_id: X,
    org_id: current_org,         ← SCOPED — no other org data
    metrics: last_30min,
    logs: last_500_lines,
    containers: current_state,
    role: user_role              ← viewer cannot trigger approvals
})
    │
    ▼
LLM API call (OpenAI/Anthropic) with system prompt:
    "You are an infrastructure assistant. Only analyze the provided
     context. Output structured JSON only. NEVER include executable
     commands as final actions. Always output suggestions."
    │
    ▼
Output validation: parse JSON, redact any secret patterns
    │
    ▼
Structured suggestion returned to dashboard:
{
  "analysis": "...",
  "suggestions": [
    {
      "title": "Restart nginx container",
      "risk_level": "MEDIUM",
      "requires_approval": true,
      "proposed_job": { "type": "CONTAINER_RESTART", "target": "nginx" }
    }
  ]
}
    │
    ▼
User reviews → clicks Approve
    │
    ▼
ApprovalService creates approval record → JobService dispatches
```

### 4.3 Monitoring Ingestion Flow
```
Agent@Server (every 15s)
    │
    ├── MetricsCollector → POST /api/ingest/metrics (mTLS)
    │       └── VictoriaMetrics write
    │
    ├── LogStreamer → POST /api/ingest/logs (mTLS, batched)
    │       └── Loki write
    │
    └── ContainerWatcher → POST /api/ingest/containers (mTLS)
            └── PostgreSQL containers table update
                    └── Redis Pub/Sub → WebSocket → Dashboard real-time update
```

### 4.4 Multi-Tenant Isolation Flow
```
Every API request:
    │
    ▼
JWT validation (AuthMiddleware)
    │
    ▼
Extract {user_id, org_id, role} from token
    │
    ▼
RBACGuard validates permission matrix
    │
    ▼
TenantScopeFilter appends WHERE org_id = :org_id to ALL queries
    │
    ▼
ResourceOwnershipCheck: does server/job/secret belong to this org?
    │
    ├── YES → proceed
    └── NO  → 403 Forbidden + AuditLog.write(UNAUTHORIZED_CROSS_ORG_ACCESS)
```

---

## 5. ZERO-TRUST SECURITY MODEL

```
┌───────────────────────────────────────────────────────┐
│                  ZERO TRUST PERIMETER                  │
│                                                        │
│  Identity: Every actor (user, agent, worker, service) │
│            must present a verifiable identity token    │
│                                                        │
│  Device:   Server agents use rotating signed tokens   │
│            + mTLS certificates                         │
│                                                        │
│  Network:  TLS 1.3 everywhere. No plaintext channels. │
│            Agent traffic goes through authenticated   │
│            control plane API only.                     │
│                                                        │
│  Workload: Every job is scoped to exactly one server  │
│            in exactly one org. Cross-scope is blocked. │
│                                                        │
│  Data:     All secrets AES-256 at rest.               │
│            Never in logs. Never in AI context.         │
└───────────────────────────────────────────────────────┘
```

### Trust Levels
| Actor | Trust Level | Verification Method |
|---|---|---|
| End User | Untrusted by default | JWT + 2FA + RBAC |
| Server Agent | Untrusted by default | mTLS + rotating signed token |
| Worker Process | Internal trusted | Service account token |
| AI Service | Restricted | Context-locked, no exec rights |
| Admin User | Elevated | JWT + 2FA + approval audit |

---

## 6. APPROVAL STATE MACHINE

```
                ┌──────────────┐
                │   PENDING    │◄─────── Job submitted
                └──────┬───────┘
                       │
           ┌───────────┴───────────┐
           │                       │
    [Approved by             [Rejected by
     authorized user]         authorized user]
           │                       │
           ▼                       ▼
    ┌─────────────┐         ┌────────────┐
    │  APPROVED   │         │  REJECTED  │
    └──────┬──────┘         └────────────┘
           │
           ▼
    ┌─────────────┐
    │  EXECUTING  │◄─────── Worker picks up job
    └──────┬──────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
┌─────────┐  ┌──────────┐
│COMPLETED│  │  FAILED  │──► RetryEngine (max 3 attempts)
└─────────┘  └──────────┘         │
                                   └──► ROLLED_BACK (if rollback script exists)
```

---

## 7. NETWORK TOPOLOGY

```
                    ┌──────────────────────────┐
                    │      INTERNET / CDN        │
                    └──────────┬───────────────┘
                               │ HTTPS (TLS 1.3)
                    ┌──────────▼───────────────┐
                    │   Traefik Reverse Proxy   │
                    │   (SSL termination,       │
                    │    rate limiting,         │
                    │    WAF rules)             │
                    └──┬──────────┬────────────┘
                       │          │
              ┌────────▼──┐  ┌───▼──────────┐
              │  Frontend │  │  Backend API  │
              │ (Next.js) │  │  (NestJS)     │
              └───────────┘  └──────┬────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼────┐  ┌──────▼─────┐  ┌─────▼──────┐
              │PostgreSQL│  │   Redis     │  │VictoriaM.  │
              └──────────┘  └────────────┘  └────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │   Worker Pool        │
                         │ (job processors)     │
                         └──────────┬───────────┘
                                    │ mTLS (gRPC)
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼────┐  ┌──────▼─────┐  ┌─────▼──────┐
              │ Agent@S1 │  │  Agent@S2  │  │  Agent@SN  │
              │(port 9100│  │            │  │            │
              │ internal)│  │            │  │            │
              └──────────┘  └────────────┘  └────────────┘
                  [Customer Servers — isolated per org]
```

---

## 8. RISK CLASSIFICATION MATRIX

| Action | Risk Level | Approval Required | Rollback Support |
|---|---|---|---|
| View metrics/logs | LOW | No | N/A |
| View container state | LOW | No | N/A |
| Restart container | MEDIUM | Recommended | Yes (restart tracking) |
| Start/stop service | MEDIUM | Required | Yes |
| Install DevOps tool | HIGH | Required | Yes (uninstall script) |
| Deploy application | HIGH | Required | Yes (previous version) |
| Delete data / container | HIGH | Required | Snapshot before deletion |
| SSH key rotation | HIGH | Required | Yes |
| Run custom script | HIGH | Required | No (user responsibility) |
| Production config change | HIGH | Required + 2nd approver | Yes |

---

## 9. TECHNOLOGY STACK SUMMARY

| Layer | Technology | Justification |
|---|---|---|
| Frontend | Next.js 14 + TypeScript + TailwindCSS | SSR, App Router, type safety |
| API | NestJS (Node.js) + TypeScript | Modular, DI, enterprise patterns |
| Agent | Go 1.22 | Low memory, single binary, mTLS native |
| Database | PostgreSQL 15 | ACID, multi-tenant, JSON support |
| Cache/Queue | Redis 7 (Streams + Pub/Sub) | Job queue + real-time events |
| Metrics | VictoriaMetrics | High-cardinality, cost-efficient |
| Logs | Grafana Loki | Label-based, cheap, S3-compatible |
| Secrets | HashiCorp Vault OR custom AES-256 module | Enterprise-grade or self-hosted |
| Container Runtime | Docker + Docker Compose | Tool deployment templates |
| Reverse Proxy | Traefik v3 | Auto SSL, dashboard, middleware |
| AI | OpenAI GPT-4 / Anthropic Claude | Pluggable LLM backend |
| Object Storage | MinIO (self-hosted) or S3 | Backups, artifacts |
| Monitoring UI | Grafana (embedded iframe or API) | Rich dashboards |
| CI/CD | GitHub Actions | Platform deployments |
| Container Orchestration | Kubernetes (optional, for platform itself) | Production scale |
