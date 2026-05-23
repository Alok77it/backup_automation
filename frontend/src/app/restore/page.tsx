"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Shield, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Backup { id: string; name: string; restore_confidence: number; risk_level: string }
interface RestoreAnalysis {
  restore_confidence: number;
  estimated_duration_seconds: number;
  dependency_warnings: string[];
  corruption_risks: string[];
  health_score: number;
  risk_level: string;
  ai_summary: string | null;
}
interface RestoreJob { id: string; backup_id: string; status: string; target_path: string; restore_confidence: number; created_at: string }

export default function RestorePage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [jobs, setJobs] = useState<RestoreJob[]>([]);
  const [selected, setSelected] = useState("");
  const [targetPath, setTargetPath] = useState("/restore");
  const [analysis, setAnalysis] = useState<RestoreAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    api<Backup[]>("/backups").then(setBackups);
    api<RestoreJob[]>("/restore/jobs").then(setJobs);
  }, []);

  async function runAnalysis() {
    if (!selected) return;
    setAnalyzing(true);
    const result = await api<RestoreAnalysis>("/restore/analyze", {
      method: "POST",
      body: JSON.stringify({ backup_id: selected, target_path: targetPath, overwrite_protection: true }),
    });
    setAnalysis(result);
    setAnalyzing(false);
  }

  async function startRestore() {
    await api("/restore", {
      method: "POST",
      body: JSON.stringify({ backup_id: selected, target_path: targetPath, overwrite_protection: true }),
    });
    api<RestoreJob[]>("/restore/jobs").then(setJobs);
  }

  return (
    <DashboardLayout title="Restore Center">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader><CardTitle>Restore Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <select className="h-10 w-full rounded-xl border px-4" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select backup...</option>
              {backups.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Input placeholder="Target path" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={runAnalysis} disabled={!selected || analyzing}>AI Analysis</Button>
              <Button onClick={startRestore} disabled={!selected || !analysis}><RotateCcw className="h-4 w-4" /> Start Restore</Button>
            </div>
          </CardContent>
        </Card>

        {analysis && (
          <Card className="glass border-emerald-200">
            <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-[#10B981]" /> AI Restore Analysis</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-[#D1FAE5] p-4 text-center dark:bg-emerald-950">
                  <p className="text-xs text-gray-500">Restore Confidence</p>
                  <p className="text-2xl font-bold text-[#047857]">{analysis.restore_confidence.toFixed(0)}%</p>
                </div>
                <div className="rounded-xl bg-[#D1FAE5] p-4 text-center dark:bg-emerald-950">
                  <p className="text-xs text-gray-500">Est. Duration</p>
                  <p className="text-2xl font-bold text-[#047857]">{Math.round(analysis.estimated_duration_seconds / 60)}m</p>
                </div>
              </div>
              <Badge variant={analysis.risk_level === "low" ? "success" : "warning"}>Risk: {analysis.risk_level}</Badge>
              {analysis.corruption_risks.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" />{r}</div>
              ))}
              {analysis.dependency_warnings.map((w, i) => (
                <div key={i} className="text-sm text-gray-600">{w}</div>
              ))}
              {analysis.ai_summary && <div className="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800 whitespace-pre-wrap">{analysis.ai_summary}</div>}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-8 glass">
        <CardHeader><CardTitle>Restore Jobs</CardTitle></CardHeader>
        <CardContent>
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between border-b py-3 last:border-0">
              <div>
                <p className="font-medium">{j.target_path}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleString()}</p>
              </div>
              <Badge variant={j.status === "completed" ? "success" : j.status === "failed" ? "error" : "info"}>{j.status}</Badge>
            </div>
          ))}
          {jobs.length === 0 && <p className="text-gray-500">No restore jobs yet</p>}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
