# DevOps Control Plane — DevOps Tool Plugin System
> Version: 1.0 | Plugin Architecture & Installation Lifecycle

---

## 1. PLUGIN ARCHITECTURE OVERVIEW

```
┌────────────────────────────────────────────────────────────────┐
│                     PLUGIN REGISTRY                             │
│  (Platform-managed catalog of available DevOps tools)          │
└──────────────────────────┬─────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │    PluginManager        │
              │    (NestJS Service)     │
              │  - resolve deps         │
              │  - validate config      │
              │  - generate job payload │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   Job Queue → Worker    │
              │   → Agent Executor      │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │  Target Server          │
              │  - OS detection         │
              │  - Dependency install   │
              │  - Template rendering   │
              │  - Service start        │
              │  - Health check         │
              └─────────────────────────┘
```

---

## 2. PLUGIN STRUCTURE

Each plugin lives in `backend/src/plugins/<plugin-name>/`:

```
plugins/
└── n8n/
    ├── plugin.manifest.ts       ← Plugin metadata and schema
    ├── install.sh               ← Bash install script (templated)
    ├── uninstall.sh             ← Uninstall + cleanup script
    ├── health-check.sh          ← Health verification script
    ├── docker-compose.tmpl.yml  ← Docker Compose template (Handlebars)
    ├── nginx.tmpl.conf          ← Nginx reverse proxy config template
    ├── upgrade.sh               ← Version upgrade script
    └── rollback.sh              ← Rollback to previous version
```

### plugin.manifest.ts interface

```typescript
export interface PluginManifest {
  id: string;                     // e.g. "n8n"
  displayName: string;            // "n8n Workflow Automation"
  version: string;                // Plugin definition version "1.0.0"
  category: PluginCategory;       // container | ci-cd | automation | monitoring | proxy
  description: string;
  iconUrl: string;
  
  // System requirements
  requirements: {
    minRam: number;               // MB
    minDisk: number;              // MB
    minCpu: number;               // cores
    ports: number[];              // ports that will be opened
    osSupport: OsType[];
  };
  
  // Dependencies (other plugins that must be installed first)
  dependencies: string[];         // e.g. ["docker"]
  
  // Config schema — rendered as form in the dashboard
  configSchema: JSONSchema;
  
  // Default config values
  defaultConfig: Record<string, unknown>;
  
  // Exposed service info (for container linking and SSL)
  servicePort: number;
  serviceProtocol: 'http' | 'https';
  supportsSSL: boolean;
  supportsReverseProxy: boolean;
  
  // Risk level for install
  installRisk: 'MEDIUM' | 'HIGH';
  
  // Health check endpoint
  healthCheckPath: string;        // e.g. "/healthz"
  healthCheckInterval: number;    // seconds
}
```

---

## 3. INSTALLATION LIFECYCLE

```
Phase 1: PRE-FLIGHT
────────────────────
1. Validate user has admin+ role on server
2. Check server is connected and healthy
3. Load plugin manifest
4. Validate user config against configSchema
5. Check plugin not already installed (prevent duplicates)
6. Resolve dependency chain
7. Check server has sufficient resources (RAM, disk, ports)
8. Create ApprovalRecord (HIGH risk)

Phase 2: APPROVAL GATE
────────────────────────
[Wait for admin approval — see approval state machine]

Phase 3: DEPENDENCY RESOLUTION
────────────────────────────────
For each dependency (e.g. Docker):
  IF dependency not installed:
    → Create nested install job for dependency
    → Mark current job as blocked until dep completes

Phase 4: OS DETECTION
──────────────────────
Agent runs: lsb_release -a || cat /etc/os-release
Stores: { os_type, os_version, arch, package_manager }

Phase 5: TEMPLATE RENDERING
─────────────────────────────
Control plane renders templates with user config:
  docker-compose.tmpl.yml → docker-compose.yml
  nginx.tmpl.conf         → /etc/nginx/sites-available/<domain>.conf
  
Template variables:
  {{ domain }}
  {{ service_port }}
  {{ ssl_cert_path }}
  {{ data_directory }}
  {{ env_vars }}

Phase 6: EXECUTION (on agent)
──────────────────────────────
Step 1: Create data directory
  mkdir -p /opt/devops-os/tools/<tool-id>/data

Step 2: Write rendered docker-compose.yml
  cat > /opt/devops-os/tools/<tool-id>/docker-compose.yml

Step 3: Write environment file (secrets injected here — not in compose file)
  cat > /opt/devops-os/tools/<tool-id>/.env
  chmod 600 /opt/devops-os/tools/<tool-id>/.env

Step 4: Pull Docker images
  docker compose pull

Step 5: Start service
  docker compose up -d

Step 6: Configure reverse proxy
  Install nginx config → nginx -t → systemctl reload nginx
  OR: Configure Traefik dynamic config

Step 7: SSL certificate (if domain provided)
  Trigger SSLService.issueCertificate(domain, server_id)

Phase 7: HEALTH CHECK
──────────────────────
Retry health check every 10s for 2 minutes:
  curl -sf http://localhost:<port><healthCheckPath>
  
If fails after 2 minutes:
  → Mark installation FAILED
  → Run uninstall.sh to clean up
  → Create incident record
  → Notify user

Phase 8: POST-INSTALL
──────────────────────
1. Update installed_tools record with status=healthy
2. Record container IDs in containers table
3. Store service_url and public_url
4. Write audit log: tool.install.completed
5. Emit real-time event to dashboard
```

---

## 4. BUILT-IN PLUGINS

### 4.1 Docker Plugin
```yaml
id: docker
displayName: "Docker Engine"
category: container
requirements:
  minRam: 512
  minDisk: 2000
  osSupport: [ubuntu-20.04, ubuntu-22.04, debian-11, debian-12, centos-7, centos-8]
dependencies: []
installScript: |
  # Phase 1: Remove old versions
  apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
  
  # Phase 2: Add Docker repo
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  
  # Phase 3: Install Docker CE
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  
  # Phase 4: Enable and start
  systemctl enable docker
  systemctl start docker
  
  # Phase 5: Verify
  docker --version
healthCheck: "docker info"
```

### 4.2 n8n Plugin
```yaml
id: n8n
displayName: "n8n Workflow Automation"
category: automation
requirements:
  minRam: 1024
  minDisk: 5000
  ports: [5678]
dependencies: [docker]
configSchema:
  properties:
    domain:
      type: string
      description: "Public domain for n8n (e.g. n8n.mycompany.com)"
    enableSsl:
      type: boolean
      default: true
    adminEmail:
      type: string
    basicAuthUser:
      type: string
    basicAuthPasswordSecretId:
      type: string
      description: "Reference to a secret containing the password"
    timezone:
      type: string
      default: "UTC"
    dataDirectory:
      type: string
      default: "/opt/devops-os/tools/n8n/data"

dockerComposeTemplate: |
  version: "3.8"
  services:
    n8n:
      image: n8nio/n8n:latest
      container_name: devops-n8n-{{ toolId }}
      restart: unless-stopped
      ports:
        - "127.0.0.1:{{ servicePort }}:5678"
      environment:
        - N8N_BASIC_AUTH_ACTIVE=true
        - N8N_BASIC_AUTH_USER={{ basicAuthUser }}
        - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
        - N8N_HOST={{ domain }}
        - N8N_PROTOCOL={{ protocol }}
        - WEBHOOK_URL=https://{{ domain }}
        - GENERIC_TIMEZONE={{ timezone }}
        - N8N_LOG_LEVEL=info
        - N8N_METRICS=true
      volumes:
        - {{ dataDirectory }}:/home/node/.n8n
      labels:
        - devops-os.managed=true
        - devops-os.tool=n8n
        - devops-os.org={{ orgId }}
        - devops-os.server={{ serverId }}
      networks:
        - devops-os-net
  networks:
    devops-os-net:
      external: true
      name: devops-os-net

nginxTemplate: |
  server {
      listen 80;
      server_name {{ domain }};
      return 301 https://$host$request_uri;
  }
  server {
      listen 443 ssl http2;
      server_name {{ domain }};
      
      ssl_certificate /etc/letsencrypt/live/{{ domain }}/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/{{ domain }}/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
      
      location / {
          proxy_pass http://127.0.0.1:{{ servicePort }};
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 86400s;
      }
  }
```

### 4.3 Jenkins Plugin
```yaml
id: jenkins
displayName: "Jenkins CI/CD"
category: ci-cd
requirements:
  minRam: 2048
  minDisk: 10000
  ports: [8080, 50000]
dependencies: [docker]
dockerComposeTemplate: |
  version: "3.8"
  services:
    jenkins:
      image: jenkins/jenkins:lts-jdk17
      container_name: devops-jenkins-{{ toolId }}
      restart: unless-stopped
      user: root
      ports:
        - "127.0.0.1:{{ servicePort }}:8080"
        - "127.0.0.1:50000:50000"
      volumes:
        - {{ dataDirectory }}:/var/jenkins_home
        - /var/run/docker.sock:/var/run/docker.sock
      environment:
        - JAVA_OPTS=-Djenkins.install.runSetupWizard=false
      labels:
        - devops-os.managed=true
        - devops-os.tool=jenkins
healthCheckPath: "/login"
```

### 4.4 GitHub Actions Runner Plugin
```yaml
id: github-runner
displayName: "GitHub Actions Self-Hosted Runner"
category: ci-cd
requirements:
  minRam: 2048
  minDisk: 20000
  ports: []
dependencies: [docker]
configSchema:
  properties:
    githubUrl:
      type: string
      description: "GitHub repo or org URL"
    runnerToken:
      type: string
      description: "Reference to secret containing runner registration token"
    runnerLabels:
      type: string
      default: "self-hosted,linux,x64"
    runnerName:
      type: string
dockerComposeTemplate: |
  version: "3.8"
  services:
    github-runner:
      image: myoung34/github-runner:latest
      container_name: devops-ghrunner-{{ toolId }}
      restart: unless-stopped
      environment:
        - REPO_URL={{ githubUrl }}
        - RUNNER_TOKEN=${RUNNER_TOKEN}
        - RUNNER_NAME={{ runnerName }}-{{ serverId }}
        - LABELS={{ runnerLabels }}
        - RUNNER_WORKDIR=/tmp/runner/work
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
        - {{ dataDirectory }}:/tmp/runner
```

### 4.5 Kubernetes (k3s) Plugin
```yaml
id: kubernetes-k3s
displayName: "Kubernetes (k3s lightweight)"
category: container
requirements:
  minRam: 2048
  minDisk: 10000
  ports: [6443, 10250]
dependencies: []
installScript: |
  # Install k3s single-node
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik" sh -
  systemctl enable k3s
  systemctl start k3s
  
  # Wait for node to be ready
  timeout 120 bash -c 'until kubectl get nodes | grep -q "Ready"; do sleep 5; done'
  
  # Copy kubeconfig
  mkdir -p /opt/devops-os/tools/k3s/
  cp /etc/rancher/k3s/k3s.yaml /opt/devops-os/tools/k3s/kubeconfig.yaml
  chmod 600 /opt/devops-os/tools/k3s/kubeconfig.yaml
healthCheck: "kubectl get nodes"
```

### 4.6 Prometheus + Grafana Stack
```yaml
id: monitoring-stack
displayName: "Prometheus + Grafana Monitoring"
category: monitoring
requirements:
  minRam: 1024
  minDisk: 20000
  ports: [3000, 9090]
dependencies: [docker]
dockerComposeTemplate: |
  version: "3.8"
  services:
    prometheus:
      image: prom/prometheus:latest
      container_name: devops-prometheus-{{ toolId }}
      restart: unless-stopped
      ports: ["127.0.0.1:9090:9090"]
      volumes:
        - {{ dataDirectory }}/prometheus:/prometheus
        - {{ dataDirectory }}/prometheus.yml:/etc/prometheus/prometheus.yml
    
    grafana:
      image: grafana/grafana:latest
      container_name: devops-grafana-{{ toolId }}
      restart: unless-stopped
      ports: ["127.0.0.1:3000:3000"]
      environment:
        - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
        - GF_SERVER_ROOT_URL=https://{{ domain }}
      volumes:
        - {{ dataDirectory }}/grafana:/var/lib/grafana
      depends_on: [prometheus]
```

---

## 5. HEALTH CHECK SYSTEM

```typescript
// HealthCheckService — runs on schedule per installed tool
class HealthCheckService {
  
  async checkTool(installedTool: InstalledTool): Promise<HealthStatus> {
    const plugin = await this.pluginRegistry.get(installedTool.plugin_id);
    
    // Step 1: Container running?
    const containerStatus = await this.dockerService.getContainerStatus(
      installedTool.server_id,
      installedTool.container_id
    );
    if (containerStatus !== 'running') {
      return { status: 'degraded', reason: `Container status: ${containerStatus}` };
    }
    
    // Step 2: HTTP health endpoint
    if (plugin.healthCheckPath) {
      const response = await this.agentService.httpProbe(
        installedTool.server_id,
        `http://localhost:${plugin.servicePort}${plugin.healthCheckPath}`,
        { timeout: 5000 }
      );
      if (!response.ok) {
        return { status: 'degraded', reason: `Health endpoint returned ${response.status}` };
      }
    }
    
    // Step 3: Custom health script
    if (plugin.healthCheckCmd) {
      const result = await this.agentService.execHealthCheck(
        installedTool.server_id,
        plugin.healthCheckCmd
      );
      if (result.exitCode !== 0) {
        return { status: 'degraded', reason: result.stderr };
      }
    }
    
    return { status: 'healthy' };
  }
  
  // Health check schedule: every 30 seconds
  // Degraded for 3 consecutive checks → alert fired
  // Degraded for 10 consecutive checks → incident created
}
```

---

## 6. PLUGIN DEPENDENCY RESOLUTION

```
Example: User installs n8n
→ n8n requires: docker
→ docker requires: (none)

Resolution order:
  1. docker (install first)
  2. n8n (install after docker healthy)

Algorithm:
  function resolveDeps(pluginId: string): string[] {
    const plugin = registry.get(pluginId)
    const deps = plugin.dependencies.flatMap(dep => resolveDeps(dep))
    return [...new Set([...deps, pluginId])]  // topological order, deduplicated
  }

Circular dependency detection:
  - Build dependency graph
  - Run DFS cycle detection
  - Reject plugin if cycle detected
```

---

## 7. PLUGIN UPGRADE LIFECYCLE

```
1. User clicks "Update" on installed tool
2. System fetches latest plugin manifest version
3. Diff shown: current config vs new config requirements
4. User reviews changes + approves (HIGH risk)
5. upgrade.sh executed:
   a. Create backup snapshot of data directory
   b. docker-compose pull (new image)
   c. docker-compose up -d (rolling update)
   d. Health check for 2 minutes
   e. If fails → auto-rollback to previous image
6. Audit log: tool.upgrade.completed
```
