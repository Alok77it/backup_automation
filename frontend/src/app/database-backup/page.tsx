"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, Play, RefreshCw, CheckCircle2, XCircle, Clock,
  Loader2, ChevronDown, ChevronUp, Plus, Server,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError, Server as ServerType } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

interface DBRun {
  id: string; backup_id: string; status: string;
  started_at: string | null; completed_at: string | null;
  bytes_processed: number; duration_seconds: number | null;
  error_message: string | null; failed_chunks: number;
  log_output: string | null;
  metadata_json?: {
    backup_name?: string; db_type?: string; db_name?: string;
    db_host?: string; target_path?: string;
  } | null;
}

const DB_TYPES = [
  { value: "postgresql", label: "PostgreSQL", port: 5432, icon: "🐘" },
  { value: "mysql", label: "MySQL", port: 3306, icon: "🐬" },
  { value: "mariadb", label: "MariaDB", port: 3306, icon: "🦭" },
  { value: "mongodb", label: "MongoDB", port: 27017, icon: "🍃" },
];

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  return <Clock className="h-4 w-4 text-amber-400" />;
}

interface ProgressInfo {
  status: string; progress_pct: number | null;
  elapsed_seconds: number; bytes_processed: number;
  error_message: string | null; log_tail: string | null;
}

function LiveProgress({ backupId, runId, initialStatus }: { backupId: string; runId: string; initialStatus: string }) {
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const p = await api<ProgressInfo>(`/backups/${backupId}/runs/${runId}/progress`);
        setProgress(p);
        if (p.status === "completed" || p.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (elapsedRef.current) clearInterval(elapsedRef.current);
        }
      } catch {}
    };
    if (initialStatus === "running" || initialStatus === "pending") {
      fetch();
      pollRef.current = setInterval(fetch, 2000);
      elapsedRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [backupId, runId, initialStatus]);

  const pct = progress?.progress_pct ?? (initialStatus === "running" ? Math.min(90, elapsed / 60 * 20) : initialStatus === "completed" ? 100 : 0);
  const status = progress?.status || initialStatus;

  if (status === "pending" && !progress) {
    return (
      <div className="mt-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Queued — waiting for worker…</span><span>0%</span></div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <motion.div className="h-2 w-8 rounded-full bg-amber-400" animate={{ x: [0, 200, 0] }} transition={{ duration: 1.5, repeat: Infinity }} />
        </div>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="mt-2 space-y-1">
        <div className="flex justify-between text-xs text-blue-600 mb-1">
          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Running… {Math.round(progress?.elapsed_seconds || elapsed)}s</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-blue-100 overflow-hidden">
          <motion.div className="h-2.5 rounded-full bg-blue-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
        </div>
        {progress?.bytes_processed ? (
          <p className="text-xs text-gray-400">{formatBytes(progress.bytes_processed)} transferred</p>
        ) : null}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="mt-2">
        <div className="flex justify-between text-xs text-emerald-600 mb-1"><span>✓ Complete</span><span>100%</span></div>
        <div className="h-2 w-full rounded-full bg-emerald-100 overflow-hidden">
          <div className="h-2 rounded-full bg-emerald-500 w-full" />
        </div>
        {progress?.bytes_processed ? <p className="text-xs text-gray-400 mt-0.5">{formatBytes(progress.bytes_processed)} dumped</p> : null}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
        {progress?.error_message || "Backup failed"}
      </div>
    );
  }
  return null;
}

const emptyForm = {
  name: "", server_id: "", db_type: "postgresql",
  db_host: "localhost", db_port: 5432,
  db_user: "", db_password: "", db_name: "",
  target_path: "", compression: true,
};

export default function DatabaseBackupPage() {
  const [servers, setServers] = useState<ServerType[]>([]);
  const [jobs, setJobs] = useState<DBRun[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function loadJobs() {
    api<DBRun[]>("/backups/database/jobs").then(setJobs).catch(() => {});
  }

  useEffect(() => {
    api<ServerType[]>("/servers").then(setServers).catch(() => {});
    loadJobs();
    pollRef.current = setInterval(loadJobs, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Update default port when db_type changes
  function changeDbType(type: string) {
    const def = DB_TYPES.find((d) => d.value === type);
    setForm((f) => ({ ...f, db_type: type, db_port: def?.port ?? 5432 }));
  }

  async function runBackup(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api("/backups/database", {
        method: "POST",
        body: JSON.stringify({
          name: form.name || undefined,
          server_id: form.server_id || null,
          db_type: form.db_type,
          db_host: form.db_host,
          db_port: form.db_port,
          db_user: form.db_user,
          db_password: form.db_password,
          db_name: form.db_name,
          target_path: form.target_path || null,
          compression: form.compression,
        }),
      });
      setSuccess(`Database backup started for "${form.db_name}".`);
      setShowForm(false);
      setTimeout(loadJobs, 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start database backup");
    } finally {
      setSubmitting(false);
    }
  }

  const activeCount = jobs.filter((j) => j.status === "running" || j.status === "pending").length;

  return (
    <DashboardLayout title="Database Backup">
      <PageHero
        icon={Database}
        title="Database Backup"
        description="Directly dump PostgreSQL, MySQL, MariaDB, or MongoDB via SSH — stored securely on your backup server"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" /> New Database Backup
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      {activeCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          {activeCount} database backup{activeCount > 1 ? "s" : ""} running — progress updates every 2s
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-6 glass border-emerald-200">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-emerald-600" /> Configure Database Backup
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={runBackup} className="space-y-5">
                  {/* Row 1: Name + Server */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Backup Name (optional)</label>
                      <Input placeholder="e.g. Production DB Daily" value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })} />
                      <p className="text-xs text-gray-500 mt-1">Leave blank to auto-name from DB type + date</p>
                    </div>
                    <SelectField label="SSH Server" hint="Connect to this server via SSH to run the dump"
                      value={form.server_id} onChange={(e) => setForm({ ...form, server_id: e.target.value })}>
                      <option value="">No SSH (run locally on this server)</option>
                      {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
                    </SelectField>
                  </div>

                  {/* Row 2: DB type */}
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-4">
                    <p className="text-sm font-semibold text-blue-800">🗄 Database Connection</p>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="md:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Database Type *</label>
                        <select
                          className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={form.db_type} onChange={(e) => changeDbType(e.target.value)}>
                          {DB_TYPES.map((d) => (
                            <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Database Host</label>
                        <Input placeholder="localhost or 127.0.0.1" value={form.db_host}
                          onChange={(e) => setForm({ ...form, db_host: e.target.value })} />
                        <p className="text-xs text-gray-500 mt-1">Host as seen FROM the SSH server (usually localhost)</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                        <Input type="number" value={form.db_port}
                          onChange={(e) => setForm({ ...form, db_port: +e.target.value })} />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Database Name *</label>
                        <Input placeholder="myapp_production" value={form.db_name}
                          onChange={(e) => setForm({ ...form, db_name: e.target.value })} required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                        <Input placeholder={form.db_type === "postgresql" ? "postgres" : "root"}
                          value={form.db_user}
                          onChange={(e) => setForm({ ...form, db_user: e.target.value })} required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <div className="relative">
                          <Input type={showPass ? "text" : "password"}
                            placeholder="Database password"
                            value={form.db_password}
                            onChange={(e) => setForm({ ...form, db_password: e.target.value })} />
                          <button type="button" onClick={() => setShowPass(!showPass)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                            {showPass ? "hide" : "show"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Storage + Options */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Storage Path (optional)</label>
                      <Input placeholder="/backups/databases  or  leave blank"
                        value={form.target_path}
                        onChange={(e) => setForm({ ...form, target_path: e.target.value })} />
                      <p className="text-xs text-gray-500 mt-1">Where the dump file is saved. Blank = default storage.</p>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={form.compression}
                          onChange={(e) => setForm({ ...form, compression: e.target.checked })}
                          className="h-4 w-4 rounded accent-emerald-600" />
                        Compress dump (gzip)
                      </label>
                    </div>
                  </div>

                  {/* How it works info */}
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 space-y-1">
                    <p className="font-semibold text-gray-700">How it works:</p>
                    {form.db_type === "postgresql" && <p>🐘 Connects via SSH to your server → runs <code className="bg-gray-200 px-1 rounded">pg_dump</code> → streams dump file to backup storage</p>}
                    {(form.db_type === "mysql" || form.db_type === "mariadb") && <p>🐬 Connects via SSH → runs <code className="bg-gray-200 px-1 rounded">mysqldump</code> → saves .sql dump to backup storage</p>}
                    {form.db_type === "mongodb" && <p>🍃 Connects via SSH → runs <code className="bg-gray-200 px-1 rounded">mongodump --archive</code> → saves to backup storage</p>}
                    <p className="text-gray-500">The dump command runs on the remote server (via SSH) so the DB stays internal — no external access needed.</p>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {submitting ? "Starting…" : "Start Database Backup"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Jobs list */}
      {jobs.length === 0 ? (
        <div className="py-20 text-center">
          <Database className="mx-auto h-12 w-12 text-emerald-200 mb-4" />
          <p className="text-muted-foreground">No database backups yet.</p>
          <p className="text-sm text-muted-foreground mt-1">Click "New Database Backup" to dump your first database.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-100 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Backup / Database</th>
                <th className="px-5 py-3 text-left">Status &amp; Progress</th>
                <th className="px-5 py-3 text-left">Started</th>
                <th className="px-5 py-3 text-left">Duration</th>
                <th className="px-5 py-3 text-left">Size</th>
                <th className="px-5 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const meta = j.metadata_json || {};
                const dbIcon = DB_TYPES.find((d) => d.value === meta.db_type)?.icon || "🗄";
                const isExpanded = expandedId === j.id;
                return (
                  <React.Fragment key={j.id}>
                    <tr className={`border-t border-emerald-50 hover:bg-emerald-50/40 cursor-pointer transition ${
                      j.status === "running" ? "bg-blue-50/20" : j.status === "failed" ? "bg-red-50/20" : ""
                    }`} onClick={() => setExpandedId(isExpanded ? null : j.id)}>
                      <td className="px-5 py-3">
                        <div className="font-medium">{meta.backup_name || "Database backup"}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {dbIcon} {meta.db_type?.toUpperCase()} · <span className="font-mono">{meta.db_name}</span>
                          {meta.db_host && meta.db_host !== "localhost" && ` @ ${meta.db_host}`}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={j.status} />
                          <Badge variant={
                            j.status === "completed" ? "success" :
                            j.status === "failed" ? "error" :
                            j.status === "running" ? "info" : "default"
                          }>{j.status}</Badge>
                        </div>
                        {(j.status === "running" || j.status === "pending") && (
                          <div className="w-48">
                            <LiveProgress backupId={j.backup_id} runId={j.id} initialStatus={j.status} />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500">
                        {j.started_at ? new Date(j.started_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-600">
                        {j.duration_seconds != null ? (
                          j.duration_seconds < 60 ? `${j.duration_seconds.toFixed(0)}s` : `${(j.duration_seconds / 60).toFixed(1)}m`
                        ) : j.status === "running" ? <span className="text-blue-500">…</span> : "—"}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {j.bytes_processed > 0 ? formatBytes(j.bytes_processed) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-400">
                        {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50 border-t border-emerald-50">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="grid gap-3 md:grid-cols-2 text-xs">
                            <div>
                              <p className="font-semibold text-gray-600 mb-1">Details</p>
                              <div className="bg-white rounded-lg border border-gray-100 p-3 space-y-1">
                                <p><span className="text-gray-400">Run ID:</span> <code>{j.id}</code></p>
                                <p><span className="text-gray-400">Storage path:</span> {meta.target_path || "/opt/backups (default)"}</p>
                                {j.error_message && (
                                  <p className="text-red-600"><span className="text-gray-400">Error:</span> {j.error_message}</p>
                                )}
                              </div>
                            </div>
                            {j.log_output && (
                              <div>
                                <p className="font-semibold text-gray-600 mb-1">Log output</p>
                                <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 text-emerald-300 text-[11px] p-3 whitespace-pre-wrap">
                                  {j.log_output.slice(-2000)}
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
        </div>
      )}
    </DashboardLayout>
  );
}
