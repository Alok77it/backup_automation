"use client";

import { useEffect, useState } from "react";
import { Package, Download, CheckCircle, Loader2, AlertCircle, Lock, Globe } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Plugin {
  id: string;
  name: string;
  description: string | null;
  version: string;
  category: string;
  icon_url: string | null;
  docs_url: string | null;
  requires_docker: boolean;
  min_memory_mb: number;
  risk_level: string;
}

interface PluginInstallation {
  id: string;
  server_id: string;
  plugin_id: string;
  status: string;
  access_url: string | null;
  health_status: string | null;
  error_message: string | null;
  installed_at: string | null;
}

interface SSLCert {
  id: string;
  domain: string;
  status: string;
  expires_at: string | null;
  auto_renew: boolean;
}

const CATEGORY_COLOURS: Record<string, string> = {
  tool:       "bg-blue-500/10 text-blue-700",
  ci_cd:      "bg-purple-500/10 text-purple-700",
  workflow:   "bg-green-500/10 text-green-700",
  monitoring: "bg-yellow-500/10 text-yellow-700",
};

export default function DevOpsToolsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [installations, setInstallations] = useState<PluginInstallation[]>([]);
  const [certs, setCerts] = useState<SSLCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState("");
  const [activeTab, setActiveTab] = useState<"plugins" | "ssl">("plugins");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api<Plugin[]>("/plugins/catalog"),
      api<PluginInstallation[]>("/plugins/installations"),
      api<SSLCert[]>("/devops-tools/ssl/certificates"),
    ])
      .then(([p, i, c]) => { setPlugins(p); setInstallations(i); setCerts(c); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const installPlugin = async (pluginId: string) => {
    if (!selectedServer) { setError("Select a server ID first"); return; }
    setInstalling(pluginId);
    setError(null);
    setSuccess(null);
    try {
      await api(`/plugins/${pluginId}/install`, {
        method: "POST",
        body: JSON.stringify({ server_id: selectedServer }),
      });
      setSuccess(`Install job submitted for ${pluginId}. Awaiting approval in the Approvals page.`);
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };

  const getInstallStatus = (pluginId: string, serverId: string) =>
    installations.find((i) => i.plugin_id === pluginId && i.server_id === serverId);

  const statusIcon = (status: string) => {
    if (status === "installed") return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (status === "installing") return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    if (status === "failed") return <AlertCircle className="h-4 w-4 text-red-500" />;
    return null;
  };

  const expiryWarning = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
    if (days < 0) return <Badge variant="destructive">Expired</Badge>;
    if (days < 30) return <Badge variant="secondary">{days}d left</Badge>;
    return <Badge variant="outline">{days}d left</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">DevOps Tools</h1>
          <p className="text-muted-foreground mt-1">Install tools, manage SSL certificates and reverse proxy configs</p>
        </div>

        {error && (
          <div className="rounded border border-destructive bg-destructive/10 p-4 text-destructive text-sm">{error}</div>
        )}
        {success && (
          <div className="rounded border border-green-500 bg-green-500/10 p-4 text-green-700 text-sm">{success}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b pb-0">
          {([["plugins", "Plugin Store"], ["ssl", "SSL & Proxy"]] as const).map(([tab, label]) => (
            <button
              key={tab}
              className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 -mb-px
                ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "plugins" && (
          <>
            {/* Server selector */}
            <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
              <Package className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">Target Server</div>
                <div className="text-xs text-muted-foreground">All installs will be sent to this server</div>
              </div>
              <Input
                placeholder="Server UUID…"
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
                className="max-w-xs font-mono text-xs"
              />
            </div>

            {loading ? (
              <div className="text-muted-foreground text-sm">Loading plugin catalog…</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plugins.map((plugin) => {
                  const install = selectedServer ? getInstallStatus(plugin.id, selectedServer) : null;
                  return (
                    <Card key={plugin.id} className="flex flex-col">
                      <CardHeader className="pb-2">
                        <div className="flex items-start gap-3">
                          {plugin.icon_url && (
                            <img src={plugin.icon_url} alt={plugin.name} className="h-8 w-8 rounded" />
                          )}
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base">{plugin.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLOURS[plugin.category] ?? "bg-muted"}`}>
                                {plugin.category}
                              </span>
                              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 flex flex-col">
                        <p className="text-xs text-muted-foreground mb-3 flex-1">{plugin.description}</p>
                        <div className="flex items-center gap-2 mb-3">
                          {plugin.requires_docker && (
                            <Badge variant="outline" className="text-xs">Requires Docker</Badge>
                          )}
                          <Badge
                            variant={plugin.risk_level === "high" ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {plugin.risk_level} risk
                          </Badge>
                          <span className="text-xs text-muted-foreground ml-auto">{plugin.min_memory_mb}MB min</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {install ? (
                            <div className="flex items-center gap-2 flex-1">
                              {statusIcon(install.status)}
                              <span className="text-xs font-medium capitalize">{install.status}</span>
                              {install.access_url && (
                                <a
                                  href={install.access_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-auto text-xs text-primary"
                                >
                                  Open <Globe className="h-3 w-3 inline" />
                                </a>
                              )}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={!selectedServer || installing === plugin.id}
                              onClick={() => installPlugin(plugin.id)}
                            >
                              {installing === plugin.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <Download className="h-4 w-4 mr-2" />
                              )}
                              Install
                              <Lock className="h-3 w-3 ml-1 opacity-50" title="Requires approval" />
                            </Button>
                          )}
                          {plugin.docs_url && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={plugin.docs_url} target="_blank" rel="noopener noreferrer">Docs</a>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "ssl" && (
          <Card>
            <CardHeader>
              <CardTitle>SSL Certificates</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : certs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No SSL certificates yet. Use the API or go to /devops-tools/ssl to issue certificates.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Domain</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Expiry</th>
                      <th className="pb-2">Auto-renew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certs.map((cert) => (
                      <tr key={cert.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono text-xs">{cert.domain}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={cert.status === "active" ? "outline" : cert.status === "failed" ? "destructive" : "secondary"}>
                            {cert.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{expiryWarning(cert.expires_at)}</td>
                        <td className="py-2">
                          <Badge variant={cert.auto_renew ? "outline" : "secondary"}>
                            {cert.auto_renew ? "Yes" : "No"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
