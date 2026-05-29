"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  RotateCcw, Shield, AlertTriangle, Lock, LockOpen,
  CheckCircle2, XCircle, Clock, Loader2, RefreshCw,
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

type DestMode = "same" | "server" | "custom";

interface Backup {
  id: string; name: string; server_id: string | null; server_name: string | null;
  backup_type?: string;
  source_paths: string[] | null; restore_confidence: number; risk_level: string;
}
interface RestoreAnalysis {
  restore_confidence: number; estimated_duration_seconds: number;
  dependency_warnings: string[]; corruption_risks: string[];
  health_score: number; risk_level: string; ai_summary: string | null;
}
interface RestoreJob {
  id: string; backup_id: string; status: string;
  target_path: string; restore_confidence: number; created_at: string;
}
interface RestoreProgress {
  job_id: string; status: string; progress_pct: number | null;
  elapsed_seconds: number; started_at: string | null;
  completed_at: string | null; error_message: string | null; log_tail: string | null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[#f36458]" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  return <Clock className="h-4 w-4 text-amber-400" />;
}

function RestoreProgressBar({ jobId }: { jobId: string }) {
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const p = await api<RestoreProgress>(`/restore/jobs/${jobId}/progress`);
        setProgress(p);
        if (p.status === "completed" || p.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (elapsedRef.current) clearInterval(elapsedRef.current);
        }
      } catch {}
    };
    fetch();
    pollRef.current = setInterval(fetch, 2000);
    elapsedRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [jobId]);

  if (!progress) return (
    <div className="mt-1">
      <div className="h-1.5 w-32 rounded-full bg-gray-100 overflow-hidden">
        <motion.div className="h-full w-8 rounded-full bg-amber-400" animate={{ x: [0, 96, 0] }} transition={{ duration: 1.5, repeat: Infinity }} />
      </div>
    </div>
  );

  const status = progress.status;
  const pct = progress.progress_pct ?? Math.min(90, (progress.elapsed_seconds / 120) * 60);

  if (status === "completed") return (
    <div className="mt-1 space-y-0.5">
      <div className="flex justify-between text-xs text-[#f36458]"><span>✓ Complete</span><span>100%</span></div>
      <div className="h-2 w-full rounded-full bg-[#212121]"><div className="h-2 w-full rounded-full bg-[#212121]0" /></div>
    </div>
  );

  if (status === "failed") return (
    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
      {progress.error_message?.slice(0, 100) || "Restore failed"}
    </div>
  );

  if (status === "running") return (
    <div className="mt-1 space-y-0.5">
      <div className="flex justify-between text-xs text-blue-600">
        <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{Math.round(progress.elapsed_seconds || elapsed)}s</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
        <motion.div className="h-2 rounded-full bg-blue-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
      </div>
    </div>
  );

  return null;
}

export default function RestorePage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [jobs, setJobs] = useState<RestoreJob[]>([]);
  const [selected, setSelected] = useState("");
  const [destMode, setDestMode] = useState<DestMode>("same");
  const [targetServerId, setTargetServerId] = useState("");
  const [targetPath, setTargetPath] = useState("/restore");
  const [analysis, setAnalysis] = useState<RestoreAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [overwriteProtection, setOverwriteProtection] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedBackup = backups.find((b) => b.id === selected);
  const hasActiveJobs = jobs.some((j) => j.status === "running" || j.status === "pending");

  function loadJobs() {
    api<RestoreJob[]>("/restore/jobs").then(setJobs).catch(() => {});
  }

  useEffect(() => {
    api<Backup[]>("/backups").then(setBackups).catch((e) => setError(e.message));
    api<Server[]>("/servers").then(setServers).catch(() => {});
    loadJobs();
  }, []);

  useEffect(() => {
    if (hasActiveJobs) {
      pollRef.current = setInterval(loadJobs, 4000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasActiveJobs]);

  useEffect(() => {
    if (!selectedBackup) return;
    if (destMode === "same" && selectedBackup.server_id) {
      void Promise.resolve().then(() => {
        setTargetServerId(selectedBackup.server_id || "");
        setTargetPath(selectedBackup.source_paths?.[0] || "/restore");
      });
    }
  }, [selected, destMode]);

  function buildPayload() {
    let serverId: string | null = null;
    if (destMode === "same") serverId = selectedBackup?.server_id || null;
    else if (destMode === "server") serverId = targetServerId || null;
    return { backup_id: selected, target_path: targetPath, target_server_id: serverId, overwrite_protection: overwriteProtection };
  }

  async function runAnalysis() {
    if (!selected) return;
    setAnalyzing(true); setError("");
    try {
      const result = await api<RestoreAnalysis>("/restore/analyze", { method: "POST", body: JSON.stringify(buildPayload()) });
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed");
    } finally { setAnalyzing(false); }
  }

  async function startRestore() {
    if (!selected) return;
    setRestoring(true); setError("");
    try {
      await api("/restore", { method: "POST", body: JSON.stringify(buildPayload()) });
      setSuccess("Restore job started. Progress shown below.");
      setAnalysis(null);
      setTimeout(loadJobs, 600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restore failed");
    } finally { setRestoring(false); }
  }

  return (
    <DashboardLayout title="Restore Center">
      <PageHero icon={RotateCcw} title="Disaster Recovery"
        description="Restore to the original server, another host, or a custom path — with live progress tracking" />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <Card className="glass">
          <CardHeader><CardTitle>Restore Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <SelectField label="Backup to restore" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select backup…</option>
              {backups.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.server_name ? ` · ${b.server_name}` : ""}
                </option>
              ))}
            </SelectField>

            {selectedBackup && (
              <div className="flex items-center gap-3 rounded-xl border border-[#353535] bg-[#212121] px-4 py-3 text-sm">
                <Shield className="h-4 w-4 text-[#f36458] shrink-0" />
                <div>
                  <span className="font-medium">Restore confidence: </span>
                  <span className="text-[#f36458] font-bold">{selectedBackup.restore_confidence.toFixed(0)}%</span>
                  <span className="mx-2 text-gray-300">·</span>
                  <Badge variant={selectedBackup.risk_level === "low" ? "success" : "warning"} >{selectedBackup.risk_level} risk</Badge>
                  {selectedBackup.backup_type === "docker" && (
                    <p className="mt-1 text-xs text-[#f36458]">Container backup selected. Restore will target the selected remote server/path for Docker archive recovery.</p>
                  )}
                </div>
              </div>
            )}

            <SelectField label="Destination" value={destMode} onChange={(e) => setDestMode(e.target.value as DestMode)}>
              <option value="same">Same server as backup source</option>
              <option value="server">Different server</option>
              <option value="custom">Custom path only (no SSH)</option>
            </SelectField>

            {destMode === "same" && (
              <div className="rounded-xl border border-[#353535] bg-[#212121]/60 p-3 text-sm">
                {selectedBackup?.server_name
                  ? <p>Restoring to <strong>{selectedBackup.server_name}</strong></p>
                  : <p className="text-amber-700">No server linked — choose another destination mode.</p>}
              </div>
            )}
            {destMode === "server" && (
              <SelectField label="Target server" value={targetServerId} onChange={(e) => setTargetServerId(e.target.value)}>
                <option value="">Select server…</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.hostname})</option>)}
              </SelectField>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Restore Path</label>
              <Input placeholder="/restore" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} />
              <p className="text-xs text-gray-500 mt-1">Files will be restored into this directory on the target</p>
            </div>

            <button type="button" onClick={() => setOverwriteProtection((p) => !p)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-sm font-medium transition-all ${
                overwriteProtection ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"
              }`}>
              {overwriteProtection ? <Lock className="h-4 w-4 shrink-0 text-amber-600" /> : <LockOpen className="h-4 w-4 shrink-0 text-red-500" />}
              <span className="flex-1 text-left">
                {overwriteProtection ? "Overwrite protection ON — fails if target not empty" : "Overwrite protection OFF — existing files will be overwritten"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${overwriteProtection ? "bg-amber-200 text-amber-800" : "bg-red-200 text-red-700"}`}>
                {overwriteProtection ? "Protected" : "Overwrite"}
              </span>
            </button>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={runAnalysis} disabled={!selected || analyzing}>
                {analyzing ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Analyzing…</> : "AI Analysis"}
              </Button>
              <Button onClick={startRestore} disabled={!selected || restoring}>
                {restoring ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Starting…</> : <><RotateCcw className="h-4 w-4 mr-1" />Start Restore</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {analysis && (
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
            <Card className="glass border-[#353535]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-[#f36458]" /> AI Restore Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[#353535] bg-[#212121] p-4 text-center">
                    <p className="text-xs text-muted-foreground">Restore Confidence</p>
                    <p className="text-3xl font-bold text-[#f36458]">{analysis.restore_confidence.toFixed(0)}%</p>
                  </div>
                  <div className="rounded-xl border border-[#353535] bg-[#212121] p-4 text-center">
                    <p className="text-xs text-muted-foreground">Est. Duration</p>
                    <p className="text-3xl font-bold text-[#f36458]">{Math.round(analysis.estimated_duration_seconds / 60)}m</p>
                  </div>
                </div>
                <Badge variant={analysis.risk_level === "low" ? "success" : "warning"}>Risk: {analysis.risk_level}</Badge>
                {analysis.corruption_risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{r}
                  </div>
                ))}
                {analysis.dependency_warnings.map((w, i) => (
                  <div key={i} className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{w}</div>
                ))}
                {analysis.ai_summary && (
                  <div className="rounded-xl border border-[#353535] bg-[#212121] p-4 text-sm whitespace-pre-wrap">{analysis.ai_summary}</div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Restore jobs with progress */}
      <Card className="glass">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Restore Jobs</CardTitle>
          <Button variant="outline" size="sm" onClick={loadJobs}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">
              <RotateCcw className="mx-auto h-10 w-10 text-gray-200 mb-3" />
              No restore jobs yet
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((j) => (
                <div key={j.id} className={`rounded-xl border p-4 transition ${
                  j.status === "completed" ? "border-[#353535] bg-[#212121]/50" :
                  j.status === "failed" ? "border-red-200 bg-red-50/50" :
                  j.status === "running" ? "border-blue-200 bg-blue-50/50" :
                  "border-gray-100 bg-gray-50/50"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={j.status} />
                      <span className="font-medium text-sm font-mono">{j.target_path}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={j.status === "completed" ? "success" : j.status === "failed" ? "error" : j.status === "running" ? "info" : "default"}>
                        {j.status}
                      </Badge>
                      <span className="text-xs text-gray-400">{new Date(j.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  {(j.status === "running" || j.status === "pending") && (
                    <RestoreProgressBar jobId={j.id} />
                  )}
                  {j.status === "completed" && (
                    <div className="mt-1">
                      <div className="h-2 w-full rounded-full bg-[#212121]">
                        <div className="h-2 w-full rounded-full bg-[#212121]0" />
                      </div>
                      <p className="text-xs text-[#f36458] mt-0.5">100% — Restore complete</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
