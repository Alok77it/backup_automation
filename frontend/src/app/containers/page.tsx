"use client";

import { useEffect, useState, useCallback } from "react";
import { Container, RefreshCw, Play, Square } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface ContainerSnapshot {
  id: string;
  server_id: string;
  container_id: string;
  name: string;
  image: string;
  image_tag: string | null;
  state: string;
  status: string | null;
  exit_code: number | null;
  ports: Record<string, unknown> | null;
  cpu_percent: number | null;
  memory_mb: number | null;
  memory_limit_mb: number | null;
  started_at: string | null;
  captured_at: string;
}

interface ContainerSummary {
  total: number;
  running: number;
  stopped: number;
  exited: number;
  dead: number;
  paused: number;
  restarting: number;
}

const STATE_COLOURS: Record<string, "outline" | "secondary" | "destructive"> = {
  running:    "outline",
  stopped:    "secondary",
  exited:     "secondary",
  dead:       "destructive",
  paused:     "secondary",
  restarting: "secondary",
};

export default function ContainersPage() {
  const [containers, setContainers] = useState<ContainerSnapshot[]>([]);
  const [summary, setSummary] = useState<ContainerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadData = useCallback(() => {
    setLoading(true);
    const qs = stateFilter ? `?state=${stateFilter}&limit=200` : "?limit=200";
    Promise.all([
      api<ContainerSnapshot[]>(`/containers${qs}`),
      api<ContainerSummary>("/containers/summary"),
    ])
      .then(([c, s]) => { setContainers(c); setSummary(s); })
      .finally(() => setLoading(false));
  }, [stateFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const triggerRefresh = async (serverId: string) => {
    await api(`/containers/refresh/${serverId}`, { method: "POST" });
    setTimeout(loadData, 3000);
  };

  const restartContainer = async (serverId: string, name: string) => {
    if (!confirm(`Restart container "${name}"?`)) return;
    await api(`/containers/restart/${serverId}/${encodeURIComponent(name)}`, { method: "POST" });
  };

  const filtered = containers.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.image.toLowerCase().includes(search.toLowerCase())
  );

  const memPercent = (c: ContainerSnapshot) =>
    c.memory_mb && c.memory_limit_mb
      ? Math.round((c.memory_mb / c.memory_limit_mb) * 100)
      : null;

  return (
    <DashboardLayout title="Container Management">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Container Management</h1>
          <p className="text-muted-foreground mt-1">Read-only container visibility across all servers</p>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Total", value: summary.total, colour: "bg-muted" },
              { label: "Running", value: summary.running, colour: "bg-green-500/10" },
              { label: "Stopped", value: summary.stopped, colour: "bg-yellow-500/10" },
              { label: "Exited", value: summary.exited, colour: "bg-orange-500/10" },
              { label: "Dead", value: summary.dead, colour: "bg-red-500/10" },
              { label: "Paused", value: summary.paused, colour: "bg-blue-500/10" },
              { label: "Restarting", value: summary.restarting, colour: "bg-purple-500/10" },
            ].map(({ label, value, colour }) => (
              <div
                key={label}
                className={`rounded-lg p-3 ${colour} cursor-pointer border transition-all hover:border-primary`}
                onClick={() => setStateFilter(label.toLowerCase() === "total" ? null : label.toLowerCase())}
              >
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name or image…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          {stateFilter && (
            <Button variant="outline" size="sm" onClick={() => setStateFilter(null)}>
              Clear filter
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Container list */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Container className="h-5 w-5 inline mr-2" />
              {stateFilter ? `${stateFilter} containers` : "All containers"}
              <span className="text-muted-foreground text-sm font-normal ml-2">({filtered.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-muted-foreground text-sm py-8 text-center">
                No containers found. Make sure the agent is running and refresh.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Image</th>
                      <th className="pb-2 pr-4">State</th>
                      <th className="pb-2 pr-4">CPU %</th>
                      <th className="pb-2 pr-4">Mem %</th>
                      <th className="pb-2 pr-4">Captured</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">{c.name}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                          {c.image}{c.image_tag ? `:${c.image_tag}` : ""}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={STATE_COLOURS[c.state] ?? "outline"}>{c.state}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {c.cpu_percent != null ? `${c.cpu_percent.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {memPercent(c) != null ? `${memPercent(c)}%` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {new Date(c.captured_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Refresh this server's containers"
                              onClick={() => triggerRefresh(c.server_id)}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                            {c.state === "running" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Restart container (MEDIUM risk)"
                                onClick={() => restartContainer(c.server_id, c.name)}
                              >
                                <Play className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
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
