"use client";

import { useEffect, useState } from "react";
import { Server, Tag, Plus, Trash2, FolderOpen } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface ServerGroup {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  member_count: number;
}

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  outcome: string;
  risk_level: string | null;
  created_at: string;
}

export default function ControlPlanePage() {
  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api<ServerGroup[]>("/control-plane/groups"),
      api<AuditLog[]>("/control-plane/audit-logs?limit=20"),
    ])
      .then(([g, a]) => { setGroups(g); setAuditLogs(a); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      await api("/control-plane/groups", {
        method: "POST",
        body: JSON.stringify({ name: newGroupName }),
      });
      setNewGroupName("");
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm("Delete this server group?")) return;
    try {
      await api(`/control-plane/groups/${id}`, { method: "DELETE" });
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const riskBadge = (level: string | null) => {
    const colours: Record<string, string> = { high: "destructive", medium: "secondary", low: "outline" };
    return <Badge variant={(colours[level ?? "low"] as "destructive" | "secondary" | "outline") ?? "outline"}>{level ?? "low"}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Control Plane</h1>
          <p className="text-muted-foreground mt-1">Server groups, tags, and DevOps audit trail</p>
        </div>

        {error && (
          <div className="rounded border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Server Groups */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" /> Server Groups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="New group name…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createGroup()}
                className="max-w-xs"
              />
              <Button onClick={createGroup} disabled={creating || !newGroupName.trim()} size="sm">
                <Plus className="h-4 w-4 mr-1" /> Create
              </Button>
            </div>

            {loading ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : groups.length === 0 ? (
              <div className="text-muted-foreground text-sm py-6 text-center">
                No server groups yet. Create one to organise your fleet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-start justify-between rounded-lg border p-4"
                    style={{ borderLeftColor: g.color ?? "#6366f1", borderLeftWidth: 4 }}
                  >
                    <div>
                      <div className="font-medium">{g.name}</div>
                      {g.description && <div className="text-xs text-muted-foreground mt-0.5">{g.description}</div>}
                      <div className="text-xs text-muted-foreground mt-1">
                        <Server className="h-3 w-3 inline mr-1" />
                        {g.member_count} server{g.member_count !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteGroup(g.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audit Logs */}
        <Card>
          <CardHeader>
            <CardTitle>DevOps Audit Trail</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : auditLogs.length === 0 ? (
              <div className="text-muted-foreground text-sm py-4 text-center">No audit entries yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Time</th>
                      <th className="pb-2 pr-4">Action</th>
                      <th className="pb-2 pr-4">Resource</th>
                      <th className="pb-2 pr-4">Risk</th>
                      <th className="pb-2 pr-4">IP</th>
                      <th className="pb-2">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{log.action}</td>
                        <td className="py-2 pr-4 text-xs">{log.resource_type}</td>
                        <td className="py-2 pr-4">{riskBadge(log.risk_level)}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{log.ip_address ?? "—"}</td>
                        <td className="py-2">
                          <Badge variant={log.outcome === "success" ? "outline" : "destructive"}>
                            {log.outcome}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
