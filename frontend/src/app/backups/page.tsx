"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Play, Trash2, HardDrive, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError, Server } from "@/lib/api";

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
  server_id: string | null;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    server_id: "",
    backup_type: "full",
    engine: "restic",
    source_paths: "/var/www",
    schedule_cron: "0 2 * * *",
  });

  const load = () => {
    api<Backup[]>("/backups").then(setBackups).catch((e) => setError(e.message));
    api<Server[]>("/servers").then(setServers).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api("/backups", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          server_id: form.server_id || null,
          source_paths: form.source_paths.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      setSuccess(`Backup job "${form.name}" created.`);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create backup");
    } finally {
      setSubmitting(false);
    }
  }

  async function runBackup(id: string) {
    setRunning(id);
    setError("");
    try {
      await api(`/backups/${id}/run`, { method: "POST" });
      setSuccess("Backup run queued.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start backup");
    } finally {
      setRunning(null);
    }
  }

  return (
    <DashboardLayout title="Backups">
      <PageHero
        icon={HardDrive}
        title="Backup jobs"
        description="Full, incremental, database, Docker, and path-based protection"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> New Backup
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-6 glass">
              <CardHeader>
                <CardTitle>Create Backup Job</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="Backup name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  <SelectField
                    label="Target server"
                    hint="Where source data lives (SSH)"
                    value={form.server_id}
                    onChange={(e) => setForm({ ...form, server_id: e.target.value })}
                  >
                    <option value="">No server (local paths only)</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.hostname})
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Backup type" value={form.backup_type} onChange={(e) => setForm({ ...form, backup_type: e.target.value })}>
                    {["full", "incremental", "differential", "snapshot", "database", "docker", "path"].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Engine" value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })}>
                    {["restic", "rsync", "rclone", "borg"].map((eng) => (
                      <option key={eng} value={eng}>
                        {eng}
                      </option>
                    ))}
                  </SelectField>
                  <Input
                    placeholder="Source paths (comma-separated)"
                    value={form.source_paths}
                    onChange={(e) => setForm({ ...form, source_paths: e.target.value })}
                    className="md:col-span-2"
                  />
                  <Input
                    placeholder="Cron schedule"
                    value={form.schedule_cron}
                    onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}
                    className="md:col-span-2"
                  />
                  <Button type="submit" className="md:col-span-2" disabled={submitting}>
                    {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Create Backup
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-x-auto rounded-2xl border border-emerald-100 bg-white dark:border-emerald-900 dark:bg-card">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50 dark:bg-emerald-950/50">
            <tr>
              <th className="px-6 py-4 text-left font-semibold">Name</th>
              <th className="px-6 py-4 text-left">Server</th>
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
              <tr key={b.id} className="border-t border-emerald-50 transition hover:bg-emerald-50/50 dark:border-emerald-900/50 dark:hover:bg-emerald-950/20">
                <td className="px-6 py-4 font-medium">{b.name}</td>
                <td className="px-6 py-4 text-muted-foreground">{b.server_name || "—"}</td>
                <td className="px-6 py-4">
                  <Badge>{b.backup_type}</Badge>
                </td>
                <td className="px-6 py-4">{b.engine}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900">
                      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${b.health_score}%` }} />
                    </div>
                    <span>{b.health_score.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={b.risk_level === "low" ? "success" : b.risk_level === "critical" ? "error" : "warning"}>
                    {b.risk_level}
                  </Badge>
                </td>
                <td className="px-6 py-4">{b.last_run_status || "—"}</td>
                <td className="px-6 py-4 text-right">
                  <Button size="sm" variant="outline" onClick={() => runBackup(b.id)} disabled={running === b.id}>
                    {running === b.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this backup job?")) {
                        api(`/backups/${b.id}`, { method: "DELETE" }).then(load).catch((e) => setError(e.message));
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {backups.length === 0 && <p className="py-12 text-center text-muted-foreground">No backup jobs yet.</p>}
      </motion.div>
    </DashboardLayout>
  );
}
