"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Play, Trash2, HardDrive, RefreshCw, FolderOpen, FolderInput } from "lucide-react";
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
  source_paths: string[] | null;
  target_path: string | null;
  health_score: number;
  restore_confidence: number;
  risk_level: string;
  corruption_probability: number;
  is_active: boolean;
  last_run_status: string | null;
  server_name: string | null;
  server_id: string | null;
  schedule_cron: string | null;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    server_id: "",
    backup_type: "full",
    engine: "rsync",
    source_paths: "/var/www",
    target_path: "",
    schedule_cron: "0 2 * * *",
    compression: true,
    encryption: false,
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
          name: form.name,
          server_id: form.server_id || null,
          backup_type: form.backup_type,
          engine: form.engine,
          source_paths: form.source_paths.split(",").map((s) => s.trim()).filter(Boolean),
          target_path: form.target_path || null,
          schedule_cron: form.schedule_cron,
          compression: form.compression,
          encryption: form.encryption,
        }),
      });
      setSuccess(`Backup job "${form.name}" created successfully.`);
      setShowForm(false);
      setForm({
        name: "",
        server_id: "",
        backup_type: "full",
        engine: "rsync",
        source_paths: "/var/www",
        target_path: "",
        schedule_cron: "0 2 * * *",
        compression: true,
        encryption: false,
      });
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
      setSuccess("Backup run queued successfully.");
      setTimeout(load, 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start backup");
    } finally {
      setRunning(null);
    }
  }

  async function deleteBackup(id: string, name: string) {
    if (!confirm(`Delete backup job "${name}"? This cannot be undone.`)) return;
    setError("");
    try {
      await api(`/backups/${id}`, { method: "DELETE" });
      setSuccess(`Backup "${name}" deleted.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete backup");
    }
  }

  return (
    <DashboardLayout title="Backups">
      <PageHero
        icon={HardDrive}
        title="Backup Jobs"
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
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-emerald-600" /> Create Backup Job
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
                  {/* Basic Info */}
                  <Input
                    label="Backup name"
                    placeholder="e.g. Production DB Backup"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                  <SelectField
                    label="Source server (SSH)"
                    hint="The server where your data lives"
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
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </SelectField>
                  <SelectField label="Backup engine" value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })}>
                    {["rsync", "rclone"].map((eng) => (
                      <option key={eng} value={eng}>{eng}</option>
                    ))}
                  </SelectField>

                  {/* Source & Destination */}
                  <div className="md:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" /> Source &amp; Destination
                    </p>
                    <Input
                      label="Source paths"
                      placeholder="/var/www, /etc, /home/user/data"
                      value={form.source_paths}
                      onChange={(e) => setForm({ ...form, source_paths: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground -mt-1">Comma-separated paths on the source server to include in this backup</p>
                    <Input
                      label="Destination path (optional)"
                      placeholder="/backups/production  or  leave blank for auto"
                      value={form.target_path}
                      onChange={(e) => setForm({ ...form, target_path: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground -mt-1">Where the backup files will be stored. Leave blank to use the default storage path.</p>
                  </div>

                  {/* Schedule & Options */}
                  <Input
                    label="Cron schedule"
                    placeholder="0 2 * * *"
                    value={form.schedule_cron}
                    onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}
                  />
                  <div className="flex items-center gap-6 rounded-xl border border-emerald-100 bg-white px-4 py-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.compression}
                        onChange={(e) => setForm({ ...form, compression: e.target.checked })}
                        className="h-4 w-4 rounded accent-emerald-600"
                      />
                      Compression
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.encryption}
                        onChange={(e) => setForm({ ...form, encryption: e.target.checked })}
                        className="h-4 w-4 rounded accent-emerald-600"
                      />
                      Encryption
                    </label>
                  </div>

                  <div className="md:col-span-2 flex gap-3">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {submitting ? "Creating…" : "Create Backup Job"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-x-auto rounded-2xl border border-emerald-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-emerald-50">
            <tr>
              <th className="px-6 py-4 text-left font-semibold">Name</th>
              <th className="px-6 py-4 text-left">Server</th>
              <th className="px-6 py-4 text-left">Source → Destination</th>
              <th className="px-6 py-4 text-left">Type / Engine</th>
              <th className="px-6 py-4 text-left">Health</th>
              <th className="px-6 py-4 text-left">Risk</th>
              <th className="px-6 py-4 text-left">Last Run</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <React.Fragment key={b.id}>
                <tr
                  className="border-t border-emerald-50 transition hover:bg-emerald-50/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                >
                  <td className="px-6 py-4 font-medium">{b.name}</td>
                  <td className="px-6 py-4 text-muted-foreground">{b.server_name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 max-w-[200px]">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FolderOpen className="h-3 w-3 text-emerald-500 shrink-0" />
                      <span className="truncate">{b.source_paths?.join(", ") || "—"}</span>
                    </div>
                    {b.target_path && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <FolderInput className="h-3 w-3 text-blue-500 shrink-0" />
                        <span className="truncate">{b.target_path}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <Badge>{b.backup_type}</Badge>
                      <div className="text-xs text-muted-foreground">{b.engine}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 rounded-full bg-emerald-100">
                        <div
                          className="h-2 rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(b.health_score, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium">{b.health_score.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={b.risk_level === "low" ? "success" : b.risk_level === "critical" ? "error" : "warning"}>
                      {b.risk_level}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    {b.last_run_status ? (
                      <Badge variant={b.last_run_status === "completed" ? "success" : b.last_run_status === "failed" ? "error" : "info"}>
                        {b.last_run_status}
                      </Badge>
                    ) : (
                      <span className="text-gray-300">Never</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => runBackup(b.id)} disabled={running === b.id} title="Run now">
                        {running === b.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => deleteBackup(b.id, b.name)}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {expandedId === b.id && (
                  <tr className="bg-emerald-50/30">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="grid gap-3 text-sm md:grid-cols-3">
                        <div>
                          <p className="font-semibold text-emerald-700 mb-1">Source paths</p>
                          {b.source_paths?.map((p, i) => (
                            <p key={i} className="font-mono text-xs text-gray-600 bg-white rounded px-2 py-1 mb-1 border border-emerald-100">{p}</p>
                          )) || <p className="text-muted-foreground">None configured</p>}
                        </div>
                        <div>
                          <p className="font-semibold text-emerald-700 mb-1">Destination path</p>
                          <p className="font-mono text-xs text-gray-600 bg-white rounded px-2 py-1 border border-emerald-100">
                            {b.target_path || "Auto (default storage)"}
                          </p>
                        </div>
                        <div>
                          <p className="font-semibold text-emerald-700 mb-1">Schedule</p>
                          <p className="font-mono text-xs text-gray-600 bg-white rounded px-2 py-1 border border-emerald-100">
                            {b.schedule_cron || "Manual only"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Restore confidence: <strong>{b.restore_confidence.toFixed(0)}%</strong>
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {backups.length === 0 && (
          <div className="py-16 text-center">
            <HardDrive className="mx-auto h-12 w-12 text-emerald-200 mb-4" />
            <p className="text-muted-foreground">No backup jobs yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Click "New Backup" to create your first backup job.</p>
          </div>
        )}
      </motion.div>
    </DashboardLayout>
  );
}
