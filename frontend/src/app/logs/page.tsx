"use client";

import { useEffect, useState } from "react";
import { Search, Sparkles, RefreshCw, ScrollText } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError } from "@/lib/api";

interface LogEntry {
  id: string;
  source: string;
  level: string;
  message: string;
  created_at: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (source) params.set("source", source);
      const data = await api<{ items: LogEntry[] }>(`/logs?${params}`);
      setLogs(data.items || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  async function summarize() {
    setSummarizing(true);
    setError("");
    try {
      const res = await api<{ summary: string }>("/logs/summarize", { method: "POST" });
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "AI summary failed");
    } finally {
      setSummarizing(false);
    }
  }

  function levelColor(level: string): "error" | "warning" | "info" | "default" {
    if (level === "error" || level === "critical") return "error";
    if (level === "warning" || level === "warn") return "warning";
    if (level === "info") return "info";
    return "default";
  }

  return (
    <DashboardLayout title="Logs">
      <PageHero
        icon={ScrollText}
        title="System Logs"
        description="Backup, restore, infrastructure, AI and audit events"
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />

      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search logs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </div>
        <div className="w-48">
          <SelectField value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {["backup", "restore", "infrastructure", "ai", "audit"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Search
        </Button>
        <Button onClick={summarize} disabled={summarizing}>
          <Sparkles className="h-4 w-4" />
          {summarizing ? "Analyzing…" : "AI Summary"}
        </Button>
      </div>

      {summary && (
        <Card className="mb-6 glass border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" /> AI Log Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{summary}</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2">
            <ScrollText className="h-10 w-10 text-emerald-200" />
            <p className="text-muted-foreground">No log entries found.</p>
          </div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-white p-4 transition hover:bg-emerald-50/40">
              <Badge variant={levelColor(l.level)}>{l.level}</Badge>
              <Badge variant="info">{l.source}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{l.message}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(l.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
