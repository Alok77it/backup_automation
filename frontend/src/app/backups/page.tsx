"use client";

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Play, Trash2, HardDrive, RefreshCw, FolderOpen, FolderInput,
  History, ChevronDown, ChevronUp, Filter, CheckCircle2, XCircle, Clock, Loader2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError, Server } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

interface Backup {
  id: string; name: string; backup_type: string; engine: string;
  source_paths: string[] | null; target_path: string | null;
  health_score: number; restore_confidence: number;
  risk_level: string; corruption_probability: number;
  is_active: boolean; last_run_status: string | null;
  server_name: string | null; server_id: string | null;
  destination_server_id: string | null; destination_server_name: string | null;
  schedule_cron: string | null;
}

interface BackupRun {
  id: string; backup_id: string; status: string;
  started_at: string | null; completed_at: string | null;
  bytes_processed: number; bytes_added: number;
  duration_seconds: number | null; error_message: string | null;
  failed_chunks: number; log_output: string | null;
  metadata_json?: { backup_name?: string } | null;
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[#f36458]" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  return <Clock className="h-4 w-4 text-amber-400" />;
}

function ProgressBar({ status, startedAt }: { status: string; startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== "running" && status !== "pending") return;
    const start = startedAt ? new Date(startedAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  if (status !== "running" && status !== "pending") return null;
  const fakeProgress = Math.min(95, (elapsed / 180) * 100); // caps at 95% after 3 min
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{status === "pending" ? "Queued — waiting for worker…" : `Running… ${elapsed}s elapsed`}</span>
        <span>{fakeProgress.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <motion.div
          className="h-2 rounded-full bg-[#212121]0"
          initial={{ width: 0 }}
          animate={{ width: `${fakeProgress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

const initialForm = {
  name: "", server_id: "", destination_server_id: "",
  backup_type: "full", engine: "rsync",
  source_paths: "/var/www", target_path: "",
  schedule_cron: "0 2 * * *",
  compression: true, encryption: false,
};

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ ...initialForm });

  // History tab state
  const [activeTab, setActiveTab] = useState<"jobs" | "history">("jobs");
  const [allRuns, setAllRuns] = useState<BackupRun[]>([]);
  const [filterServer, setFilterServer] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    api<Backup[]>("/backups").then(setBackups).catch((e) => setError(e.message));
    api<Server[]>("/servers").then(setServers).catch(() => {});
  };

  const loadRuns = async () => {
    setLoadingRuns(true);
    try {
      const q = filterServer ? `?server_id=${filterServer}&limit=100` : "?limit=100";
      const data = await api<BackupRun[]>(`/backups/runs/all${q}`);
      setAllRuns(data);
    } catch {
      // ignore
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (activeTab === "history") {
      loadRuns();
      pollRef.current = setInterval(loadRuns, 5000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeTab, filterServer]);

  // Poll backups list when any are running
  useEffect(() => {
    const hasRunning = backups.some(
      (b) => b.last_run_status === "running" || b.last_run_status === "pending"
    );
    if (hasRunning) {
      const id = setTimeout(load, 3000);
      return () => clearTimeout(id);
    }
  }, [backups]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api("/backups", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          server_id: form.server_id || null,
          destination_server_id: form.destination_server_id || null,
          backup_type: form.backup_type,
          engine: form.engine,
          source_paths: form.source_paths.split(",").map((s) => s.trim()).filter(Boolean),
          target_path: form.target_path || null,
          schedule_cron: form.schedule_cron || null,
          compression: form.compression,
          encryption: form.encryption,
        }),
      });
      setSuccess(`Backup job "${form.name}" created.`);
      setShowForm(false);
      setForm({ ...initialForm });
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
      setSuccess("Backup queued.");
      setTimeout(load, 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start backup");
    } finally {
      setRunning(null);
    }
  }

  async function deleteBackup(id: string, name: string) {
    if (!confirm(`Delete backup job "${name}"?`)) return;
    try {
      await api(`/backups/${id}`, { method: "DELETE" });
      setSuccess(`Backup "${name}" deleted.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete backup");
    }
  }

  const filteredRuns = allRuns.filter((r) => {
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  const runningCount = allRuns.filter((r) => r.status === "running" || r.status === "pending").length;

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
                  <Plus className="h-5 w-5 text-[#f36458]" /> Create Backup Job
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Backup Name *</label>
                    <Input placeholder="e.g. Production DB Backup" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <SelectField label="Source server (SSH)" hint="The server where your data lives"
                    value={form.server_id} onChange={(e) => setForm({ ...form, server_id: e.target.value })}>
                    <option value="">No server (local paths only)</option>
                    {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
                  </SelectField>
                  <SelectField label="Destination server (optional)"
                    hint="Push backup to this server after storing locally"
                    value={form.destination_server_id}
                    onChange={(e) => setForm({ ...form, destination_server_id: e.target.value })}>
                    <option value="">Store on this server only</option>
                    {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
                  </SelectField>
                  <SelectField label="Backup type" value={form.backup_type}
                    onChange={(e) => setForm({ ...form, backup_type: e.target.value })}>
                    {["full","incremental","differential","snapshot","database","docker","path"].map((t) =>
                      <option key={t} value={t}>{t}</option>)}
                  </SelectField>
                  <SelectField label="Backup engine" value={form.engine}
                    onChange={(e) => setForm({ ...form, engine: e.target.value })}>
                    {["rsync","rclone"].map((e) => <option key={e} value={e}>{e}</option>)}
                  </SelectField>

                  <div className="md:col-span-2 rounded-xl border border-[#353535] bg-[#212121]/50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-[#f36458] flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" /> Source &amp; Destination Paths
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Source Paths</label>
                      <Input placeholder="/var/www, /etc, /home/user/data" value={form.source_paths}
                        onChange={(e) => setForm({ ...form, source_paths: e.target.value })} />
                      <p className="text-xs text-gray-500 mt-1">Comma-separated paths on the source server</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Destination Path (optional)</label>
                      <Input placeholder="/data/backups/server-name/backup-name  or leave blank"
                        value={form.target_path}
                        onChange={(e) => setForm({ ...form, target_path: e.target.value })} />
                      <p className="text-xs text-gray-500 mt-1">Blank = /data/backups/server-name/backup-name.</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cron Schedule</label>
                    <Input placeholder="0 2 * * *" value={form.schedule_cron}
                      onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}
                      className="font-mono" />
                    <p className="text-xs text-gray-500 mt-1">UTC time — Celery Beat triggers this automatically</p>
                  </div>
                  <div className="flex items-center gap-6 rounded-xl border border-[#353535] bg-[#212121] px-4 py-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={form.compression}
                        onChange={(e) => setForm({ ...form, compression: e.target.checked })}
                        className="h-4 w-4 rounded accent-[#f36458]" />
                      Compression
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={form.encryption}
                        onChange={(e) => setForm({ ...form, encryption: e.target.checked })}
                        className="h-4 w-4 rounded accent-[#f36458]" />
                      Encryption
                    </label>
                  </div>

                  <div className="md:col-span-2 flex gap-3">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {submitting ? "Creating…" : "Create Backup Job"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-[#353535] bg-[#212121]/40 p-1 w-fit">
        <button
          onClick={() => setActiveTab("jobs")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            activeTab === "jobs" ? "bg-white shadow text-[#f36458]" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <HardDrive className="inline h-4 w-4 mr-1.5" />
          Backup Jobs ({backups.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            activeTab === "history" ? "bg-white shadow text-[#f36458]" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <History className="inline h-4 w-4 mr-1.5" />
          Run History
          {runningCount > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-[#212121]0 px-2 py-0.5 text-xs text-white">
              {runningCount} live
            </span>
          )}
        </button>
      </div>

      {/* JOBS TAB */}
      {activeTab === "jobs" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-x-auto rounded-2xl border border-[#353535] bg-[#212121]">
          <table className="w-full text-sm">
            <thead className="bg-[#212121]">
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
                  <tr className="border-t border-[#353535] transition hover:bg-[#212121]/50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
                    <td className="px-6 py-4 font-medium">{b.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{b.server_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-6 py-4 max-w-[200px]">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderOpen className="h-3 w-3 text-[#f36458] shrink-0" />
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
                      <Badge>{b.backup_type}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{b.engine}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-[#212121]">
                          <div className="h-2 rounded-full bg-[#212121]0" style={{ width: `${Math.min(b.health_score, 100)}%` }} />
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
                        <div>
                          <Badge variant={b.last_run_status === "completed" ? "success" : b.last_run_status === "failed" ? "error" : "info"}>
                            {b.last_run_status}
                          </Badge>
                          {(b.last_run_status === "running" || b.last_run_status === "pending") && (
                            <div className="mt-1 w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <motion.div className="h-full bg-[#37cd84] rounded-full"
                                animate={{ width: ["20%", "80%", "20%"] }}
                                transition={{ duration: 2, repeat: Infinity }} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">Never</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => runBackup(b.id)} disabled={running === b.id} title="Run now">
                          {running === b.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => deleteBackup(b.id, b.name)} title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === b.id && (
                    <tr className="bg-[#212121]/30">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid gap-3 text-sm md:grid-cols-3">
                          <div>
                            <p className="font-semibold text-[#f36458] mb-1">Source paths</p>
                            {b.source_paths?.map((p, i) => (
                              <p key={i} className="font-mono text-xs text-gray-600 bg-[#212121] rounded px-2 py-1 mb-1 border border-[#353535]">{p}</p>
                            )) || <p className="text-muted-foreground">None configured</p>}
                          </div>
                          <div>
                            <p className="font-semibold text-[#f36458] mb-1">Storage</p>
                            <p className="font-mono text-xs text-gray-600 bg-[#212121] rounded px-2 py-1 border border-[#353535]">
                              {b.target_path || "/data/backups (this server)"}
                            </p>
                            {b.destination_server_name && (
                              <p className="text-xs text-[#f36458] mt-1 font-medium">→ Also pushed to: <strong>{b.destination_server_name}</strong></p>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-[#f36458] mb-1">Schedule</p>
                            <p className="font-mono text-xs text-gray-600 bg-[#212121] rounded px-2 py-1 border border-[#353535]">
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
              <HardDrive className="mx-auto h-12 w-12 text-[#f36458] mb-4" />
              <p className="text-muted-foreground">No backup jobs yet.</p>
            </div>
          )}
        </motion.div>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap gap-3 items-end">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-600">Filter:</span>
            </div>
            <SelectField label="" value={filterServer} onChange={(e) => setFilterServer(e.target.value)} className="w-48">
              <option value="">All servers</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <SelectField label="" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-40">
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
            </SelectField>
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={loadingRuns}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingRuns ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <span className="text-xs text-gray-400 ml-auto">Auto-refreshes every 5s when live jobs exist</span>
          </div>

          <div className="rounded-2xl border border-[#353535] bg-[#212121] overflow-hidden">
            {loadingRuns && filteredRuns.length === 0 ? (
              <div className="py-12 flex items-center justify-center gap-2 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading history…
              </div>
            ) : filteredRuns.length === 0 ? (
              <div className="py-16 text-center">
                <History className="mx-auto h-12 w-12 text-[#f36458] mb-4" />
                <p className="text-muted-foreground">No backup runs found.</p>
                <p className="text-sm text-muted-foreground mt-1">Trigger a backup from the Jobs tab to see history here.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#212121]">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Backup</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Started</th>
                    <th className="px-5 py-3 text-left">Duration</th>
                    <th className="px-5 py-3 text-left">Data</th>
                    <th className="px-5 py-3 text-left">Error</th>
                    <th className="px-5 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((r) => {
                    const isExpanded = expandedRunId === r.id;
                    const backupName = r.metadata_json?.backup_name
                      || backups.find((b) => b.id === r.backup_id)?.name
                      || r.backup_id.slice(0, 8);
                    return (
                      <React.Fragment key={r.id}>
                        <tr
                          className={`border-t border-[#353535] transition hover:bg-[#212121]/40 cursor-pointer ${
                            r.status === "running" ? "bg-blue-50/30" : r.status === "failed" ? "bg-red-50/20" : ""
                          }`}
                          onClick={() => setExpandedRunId(isExpanded ? null : r.id)}
                        >
                          <td className="px-5 py-3 font-medium">{backupName}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <RunStatusIcon status={r.status} />
                              <Badge variant={
                                r.status === "completed" ? "success" :
                                r.status === "failed" ? "error" :
                                r.status === "running" ? "info" : "default"
                              }>
                                {r.status}
                              </Badge>
                            </div>
                            <ProgressBar status={r.status} startedAt={r.started_at} />
                          </td>
                          <td className="px-5 py-3 text-gray-500 text-xs">
                            {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-5 py-3 text-gray-600">
                            {r.status === "running" ? (
                              <span className="text-blue-600 text-xs">In progress…</span>
                            ) : r.duration_seconds != null ? (
                              <span>{r.duration_seconds < 60 ? `${r.duration_seconds.toFixed(0)}s` : `${(r.duration_seconds / 60).toFixed(1)}m`}</span>
                            ) : "—"}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-500">
                            {r.bytes_processed > 0 ? formatBytes(r.bytes_processed) : "—"}
                          </td>
                          <td className="px-5 py-3 max-w-[200px]">
                            {r.error_message ? (
                              <span className="text-xs text-red-600 truncate block">{r.error_message.slice(0, 80)}</span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-400">
                            {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50 border-t border-[#353535]">
                            <td colSpan={7} className="px-5 py-4">
                              <div className="grid gap-3 md:grid-cols-2 text-xs">
                                <div>
                                  <p className="font-semibold text-gray-600 mb-1">Run details</p>
                                  <div className="bg-white rounded-lg border border-gray-100 p-3 space-y-1">
                                    <p><span className="text-gray-400">Run ID:</span> <code>{r.id}</code></p>
                                    <p><span className="text-gray-400">Backup ID:</span> <code>{r.backup_id}</code></p>
                                    <p><span className="text-gray-400">Bytes added:</span> {r.bytes_added > 0 ? formatBytes(r.bytes_added) : "0"}</p>
                                    <p><span className="text-gray-400">Failed chunks:</span> {r.failed_chunks}</p>
                                    {r.completed_at && <p><span className="text-gray-400">Completed:</span> {new Date(r.completed_at).toLocaleString()}</p>}
                                  </div>
                                </div>
                                {r.log_output && (
                                  <div>
                                    <p className="font-semibold text-gray-600 mb-1">Log output</p>
                                    <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 text-[#f36458] text-[11px] p-3 whitespace-pre-wrap">
                                      {r.log_output.slice(-2000)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </motion.div>
      )}
    </DashboardLayout>
  );
}
