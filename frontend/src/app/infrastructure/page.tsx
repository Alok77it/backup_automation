"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Wifi, Trash2, RefreshCw, Server } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError } from "@/lib/api";
import { formatPercent } from "@/lib/utils";

interface ServerRow {
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
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    hostname: "",
    port: 22,
    username: "root",
    password: "",
    auth_method: "password",
  });
  const [testing, setTesting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () =>
    api<ServerRow[]>("/servers")
      .then(setServers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load servers"));

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api("/servers", { method: "POST", body: JSON.stringify(form) });
      setSuccess(`Server "${form.name}" connected successfully.`);
      setForm({ name: "", hostname: "", port: 22, username: "root", password: "", auth_method: "password" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  }

  async function testConnection(id: string) {
    setTesting(id);
    setError("");
    try {
      const res = await api<{ success: boolean; message: string }>(`/servers/${id}/test`, { method: "POST" });
      setSuccess(res.message || (res.success ? "Connection successful" : "Connection failed"));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connection test failed");
    } finally {
      setTesting(null);
    }
  }

  async function deleteServer(id: string) {
    if (!confirm("Remove this server?")) return;
    setError("");
    try {
      await api(`/servers/${id}`, { method: "DELETE" });
      setSuccess("Server removed.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete server");
    }
  }

  return (
    <DashboardLayout title="Infrastructure">
      <PageHero
        icon={Server}
        title="Linux server fleet"
        description="Manage SSH targets for backups, restores, and live metrics"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> Add Server
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="mb-6 glass">
              <CardHeader>
                <CardTitle>Add Linux Server</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="Server name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  <Input placeholder="Hostname / IP" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} required />
                  <Input type="number" placeholder="Port" value={form.port} onChange={(e) => setForm({ ...form, port: +e.target.value })} />
                  <Input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                  <Input
                    type="password"
                    placeholder="SSH password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="md:col-span-2"
                    required
                  />
                  <Button type="submit" className="md:col-span-2" disabled={submitting}>
                    {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    {submitting ? "Connecting…" : "Connect Server"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {servers.map((s, i) => (
          <motion.div key={s.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="glass card-shadow overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-[#f36458] to-[#e05448]" />
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">{s.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {s.username}@{s.hostname}:{s.port}
                    </p>
                  </div>
                  <Badge variant={s.status === "online" ? "success" : s.status === "error" ? "error" : "warning"}>
                    {s.status}
                  </Badge>
                </div>
                {s.os_info && <p className="mt-2 truncate text-xs text-muted-foreground">{s.os_info}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["CPU", s.cpu_percent],
                      ["RAM", s.memory_percent],
                      ["Disk", s.disk_percent],
                    ] as [string, number | null][]
                  ).map(([label, val]) => (
                    <div key={label} className="rounded-xl border border-[#353535] bg-[#212121] p-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-bold text-[#f36458]">{val != null ? formatPercent(val) : "—"}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => testConnection(s.id)} disabled={testing === s.id}>
                    {testing === s.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => api(`/servers/${s.id}/collect-metrics`, { method: "POST" }).then(load).catch((e) => setError(e.message))}
                  >
                    <RefreshCw className="h-3 w-3" /> Metrics
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteServer(s.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
      {servers.length === 0 && !error && (
        <p className="py-16 text-center text-muted-foreground">No servers connected. Add your first Linux server.</p>
      )}
    </DashboardLayout>
  );
}
