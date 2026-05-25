"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Shield, AlertTriangle, Lock, LockOpen } from "lucide-react";
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
  id: string;
  name: string;
  server_id: string | null;
  server_name: string | null;
  source_paths: string[] | null;
  restore_confidence: number;
  risk_level: string;
}

interface RestoreAnalysis {
  restore_confidence: number;
  estimated_duration_seconds: number;
  dependency_warnings: string[];
  corruption_risks: string[];
  health_score: number;
  risk_level: string;
  ai_summary: string | null;
}

interface RestoreJob {
  id: string;
  backup_id: string;
  status: string;
  target_path: string;
  restore_confidence: number;
  created_at: string;
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

  const selectedBackup = backups.find((b) => b.id === selected);

  useEffect(() => {
    api<Backup[]>("/backups").then(setBackups).catch((e) => setError(e.message));
    api<Server[]>("/servers").then(setServers).catch(() => {});
    api<RestoreJob[]>("/restore/jobs").then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedBackup) return;
    if (destMode === "same" && selectedBackup.server_id) {
      setTargetServerId(selectedBackup.server_id);
      const path = selectedBackup.source_paths?.[0] || "/restore";
      setTargetPath(path);
    }
  }, [selected, destMode, selectedBackup]);

  function buildPayload() {
    let serverId: string | null = null;
    if (destMode === "same") serverId = selectedBackup?.server_id || null;
    else if (destMode === "server") serverId = targetServerId || null;
    return {
      backup_id: selected,
      target_path: targetPath,
      target_server_id: serverId,
      overwrite_protection: overwriteProtection,
    };
  }

  async function runAnalysis() {
    if (!selected) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await api<RestoreAnalysis>("/restore/analyze", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function startRestore() {
    if (!selected) return;
    setRestoring(true);
    setError("");
    try {
      await api("/restore", { method: "POST", body: JSON.stringify(buildPayload()) });
      setSuccess("Restore job started.");
      setAnalysis(null);
      api<RestoreJob[]>("/restore/jobs").then(setJobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <DashboardLayout title="Restore Center">
      <PageHero
        icon={RotateCcw}
        title="Disaster recovery"
        description="Restore to the original server, another host, or a custom path"
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <CardTitle>Restore Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectField label="Backup to restore" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select backup…</option>
              {backups.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.server_name ? ` · ${b.server_name}` : ""}
                </option>
              ))}
            </SelectField>

            <SelectField label="Destination" value={destMode} onChange={(e) => setDestMode(e.target.value as DestMode)}>
              <option value="same">Same server as backup source</option>
              <option value="server">Different server</option>
              <option value="custom">Custom path only (no SSH target)</option>
            </SelectField>

            {destMode === "same" && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
                {selectedBackup?.server_name ? (
                  <p>
                    Restoring to <strong>{selectedBackup.server_name}</strong>
                  </p>
                ) : (
                  <p className="text-amber-700">This backup has no linked server — pick another destination mode.</p>
                )}
              </div>
            )}

            {destMode === "server" && (
              <SelectField label="Target server" value={targetServerId} onChange={(e) => setTargetServerId(e.target.value)}>
                <option value="">Select server…</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.hostname})
                  </option>
                ))}
              </SelectField>
            )}

            <Input label="Restore path" placeholder="/restore" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} />

            {/* Overwrite protection toggle */}
            <button
              type="button"
              onClick={() => setOverwriteProtection((prev) => !prev)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-sm font-medium transition-all ${
                overwriteProtection
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {overwriteProtection ? (
                <Lock className="h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <LockOpen className="h-4 w-4 shrink-0 text-red-500" />
              )}
              <span className="flex-1 text-left">
                {overwriteProtection
                  ? "Overwrite protection ON — restore will fail if target is not empty"
                  : "Overwrite protection OFF — existing files will be overwritten"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  overwriteProtection ? "bg-amber-200 text-amber-800" : "bg-red-200 text-red-700"
                }`}
              >
                {overwriteProtection ? "Protected" : "Overwrite"}
              </span>
            </button>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={runAnalysis} disabled={!selected || analyzing}>
                {analyzing ? "Analyzing…" : "AI Analysis"}
              </Button>
              <Button onClick={startRestore} disabled={!selected || restoring}>
                <RotateCcw className="h-4 w-4" />
                {restoring ? "Starting…" : "Start Restore"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {analysis && (
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
            <Card className="glass border-emerald-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-600" /> AI Restore Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                    <p className="text-xs text-muted-foreground">Restore Confidence</p>
                    <p className="text-2xl font-bold text-emerald-700">{analysis.restore_confidence.toFixed(0)}%</p>
                  </div>
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                    <p className="text-xs text-muted-foreground">Est. Duration</p>
                    <p className="text-2xl font-bold text-emerald-700">
                      {Math.round(analysis.estimated_duration_seconds / 60)}m
                    </p>
                  </div>
                </div>
                <Badge variant={analysis.risk_level === "low" ? "success" : "warning"}>Risk: {analysis.risk_level}</Badge>
                {analysis.corruption_risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {r}
                  </div>
                ))}
                {analysis.dependency_warnings.map((w, i) => (
                  <div key={i} className="text-sm text-muted-foreground">
                    {w}
                  </div>
                ))}
                {analysis.ai_summary && (
                  <div className="rounded-xl border border-emerald-100 bg-white p-4 text-sm whitespace-pre-wrap">
                    {analysis.ai_summary}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      <Card className="mt-8 glass">
        <CardHeader>
          <CardTitle>Restore Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between border-b border-emerald-50 py-3 last:border-0">
              <div>
                <p className="font-medium">{j.target_path}</p>
                <p className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString()}</p>
              </div>
              <Badge variant={j.status === "completed" ? "success" : j.status === "failed" ? "error" : "info"}>{j.status}</Badge>
            </div>
          ))}
          {jobs.length === 0 && <p className="text-muted-foreground">No restore jobs yet</p>}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
