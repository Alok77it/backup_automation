"use client";

import { useEffect, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface LogEntry { id: string; source: string; level: string; message: string; created_at: string }

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (source) params.set("source", source);
    api<{ items: LogEntry[] }>(`/logs?${params}`).then((d) => setLogs(d.items));
  };

  useEffect(() => { load(); }, []);

  async function summarize() {
    const res = await api<{ summary: string }>("/logs/summarize", { method: "POST" });
    setSummary(res.summary);
  }

  return (
    <DashboardLayout title="Logs">
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-10" placeholder="Search logs..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        </div>
        <select className="h-10 rounded-xl border px-4" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {["backup", "restore", "infrastructure", "ai", "audit"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" onClick={load}>Search</Button>
        <Button onClick={summarize}><Sparkles className="h-4 w-4" /> AI Summary</Button>
      </div>

      {summary && (
        <Card className="mb-6 glass border-emerald-200">
          <CardHeader><CardTitle>AI Log Summary</CardTitle></CardHeader>
          <CardContent><div className="text-sm whitespace-pre-wrap">{summary}</div></CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {logs.map((l) => (
          <div key={l.id} className="flex items-start gap-4 rounded-xl border bg-white p-4 dark:bg-gray-900">
            <Badge variant={l.level === "error" ? "error" : l.level === "warning" ? "warning" : "default"}>{l.level}</Badge>
            <Badge variant="info">{l.source}</Badge>
            <div className="flex-1">
              <p className="text-sm">{l.message}</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(l.created_at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
