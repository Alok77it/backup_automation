"use client";

import { useEffect, useState } from "react";
import { Plus, Play, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Backup {
  id: string;
  name: string;
  backup_type: string;
  engine: string;
  health_score: number;
  restore_confidence: number;
  risk_level: string;
  corruption_probability: number;
  is_active: boolean;
  last_run_status: string | null;
  server_name: string | null;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", backup_type: "full", engine: "restic", source_paths: "/var/www", schedule_cron: "0 2 * * *",
  });

  const load = () => api<Backup[]>("/backups").then(setBackups);
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api("/backups", {
      method: "POST",
      body: JSON.stringify({ ...form, source_paths: form.source_paths.split(",").map((s) => s.trim()) }),
    });
    setShowForm(false);
    load();
  }

  return (
    <DashboardLayout title="Backups">
      <div className="mb-6 flex justify-between">
        <p className="text-gray-500">Full, incremental, database, Docker, and path-based backups</p>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> New Backup</Button>
      </div>

      {showForm && (
        <Card className="mb-6 glass">
          <CardHeader><CardTitle>Create Backup Job</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
              <Input placeholder="Backup name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <select className="h-10 rounded-xl border px-4" value={form.backup_type} onChange={(e) => setForm({ ...form, backup_type: e.target.value })}>
                {["full", "incremental", "differential", "snapshot", "database", "docker", "path"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select className="h-10 rounded-xl border px-4" value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })}>
                {["restic", "rsync", "rclone", "borg"].map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <Input placeholder="Source paths (comma-separated)" value={form.source_paths} onChange={(e) => setForm({ ...form, source_paths: e.target.value })} />
              <Input placeholder="Cron schedule" value={form.schedule_cron} onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })} className="md:col-span-2" />
              <Button type="submit" className="md:col-span-2">Create Backup</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-white dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#D1FAE5] dark:bg-emerald-950">
            <tr>
              <th className="px-6 py-4 text-left font-semibold">Name</th>
              <th className="px-6 py-4 text-left">Type</th>
              <th className="px-6 py-4 text-left">Engine</th>
              <th className="px-6 py-4 text-left">Health</th>
              <th className="px-6 py-4 text-left">Risk</th>
              <th className="px-6 py-4 text-left">Last Run</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-6 py-4 font-medium">{b.name}{b.server_name && <span className="ml-2 text-xs text-gray-400">({b.server_name})</span>}</td>
                <td className="px-6 py-4"><Badge>{b.backup_type}</Badge></td>
                <td className="px-6 py-4">{b.engine}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded-full bg-gray-200"><div className="h-2 rounded-full bg-[#10B981]" style={{ width: `${b.health_score}%` }} /></div>
                    <span>{b.health_score.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-6 py-4"><Badge variant={b.risk_level === "low" ? "success" : b.risk_level === "critical" ? "error" : "warning"}>{b.risk_level}</Badge></td>
                <td className="px-6 py-4">{b.last_run_status || "—"}</td>
                <td className="px-6 py-4 text-right">
                  <Button size="sm" variant="outline" onClick={() => api(`/backups/${b.id}/run`, { method: "POST" }).then(load)}><Play className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => api(`/backups/${b.id}`, { method: "DELETE" }).then(load)}><Trash2 className="h-3 w-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
