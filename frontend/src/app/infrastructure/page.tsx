"use client";

import { useEffect, useState } from "react";
import { Plus, Wifi, Trash2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatPercent } from "@/lib/utils";

interface Server {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  status: string;
  os_info: string | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_percent: number | null;
}

export default function InfrastructurePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", hostname: "", port: 22, username: "root", password: "", auth_method: "password" });
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => api<Server[]>("/servers").then(setServers);
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api("/servers", { method: "POST", body: JSON.stringify(form) });
    setShowForm(false);
    load();
  }

  async function testConnection(id: string) {
    setTesting(id);
    await api(`/servers/${id}/test`, { method: "POST" });
    setTesting(null);
    load();
  }

  return (
    <DashboardLayout title="Infrastructure">
      <div className="mb-6 flex justify-between">
        <p className="text-gray-500">Manage Linux servers via SSH with encrypted credentials</p>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> Add Server</Button>
      </div>

      {showForm && (
        <Card className="mb-6 glass">
          <CardHeader><CardTitle>Add Linux Server</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
              <Input placeholder="Server name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input placeholder="Hostname / IP" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} required />
              <Input type="number" placeholder="Port" value={form.port} onChange={(e) => setForm({ ...form, port: +e.target.value })} />
              <Input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              <Input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="md:col-span-2" />
              <Button type="submit" className="md:col-span-2">Connect Server</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {servers.map((s) => (
          <Card key={s.id} className="glass card-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{s.name}</h3>
                  <p className="text-sm text-gray-500">{s.username}@{s.hostname}:{s.port}</p>
                </div>
                <Badge variant={s.status === "online" ? "success" : s.status === "error" ? "error" : "warning"}>{s.status}</Badge>
              </div>
              {s.os_info && <p className="mt-2 text-xs text-gray-400 truncate">{s.os_info}</p>}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#D1FAE5] p-2 dark:bg-emerald-950">
                  <p className="text-xs text-gray-500">CPU</p>
                  <p className="font-bold text-[#047857]">{s.cpu_percent != null ? formatPercent(s.cpu_percent) : "—"}</p>
                </div>
                <div className="rounded-lg bg-[#D1FAE5] p-2 dark:bg-emerald-950">
                  <p className="text-xs text-gray-500">RAM</p>
                  <p className="font-bold text-[#047857]">{s.memory_percent != null ? formatPercent(s.memory_percent) : "—"}</p>
                </div>
                <div className="rounded-lg bg-[#D1FAE5] p-2 dark:bg-emerald-950">
                  <p className="text-xs text-gray-500">Disk</p>
                  <p className="font-bold text-[#047857]">{s.disk_percent != null ? formatPercent(s.disk_percent) : "—"}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => testConnection(s.id)} disabled={testing === s.id}>
                  {testing === s.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => api(`/servers/${s.id}/collect-metrics`, { method: "POST" }).then(load)}>
                  <RefreshCw className="h-3 w-3" /> Metrics
                </Button>
                <Button size="sm" variant="destructive" onClick={() => api(`/servers/${s.id}`, { method: "DELETE" }).then(load)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {servers.length === 0 && <p className="text-center text-gray-500 py-12">No servers connected. Add your first Linux server.</p>}
    </DashboardLayout>
  );
}
