"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Send,
  Brain,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Terminal,
  ShieldCheck,
  ShieldX,
  Clock,
  Loader2,
  ServerCog,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIAction {
  id: string;
  title: string;
  description: string | null;
  command: string;
  server_id: string | null;
  server_name: string | null;
  risk_level: string;
  status: string;
  result_output: string | null;
  error_message: string | null;
  created_at: string;
}

interface Message {
  role: string;
  content: string;
  actions?: AIAction[];
}

interface AIStatus {
  provider: string;
  configured: boolean;
  anthropic: boolean;
  openai: boolean;
}

interface DevOpsApproval {
  id: string;
  title: string;
  description: string | null;
  action_type: string;
  action_payload: Record<string, unknown> | null;
  risk_level: string;
  server_id: string | null;
  status: string;
  created_at: string;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Analyze recent backup failures",
  "Show server health status",
  "Check storage usage",
  "Which backups are at risk?",
  "Review unresolved alerts",
  "Suggest disk cleanup commands",
];

// ── Risk badge ────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    low: "bg-emerald-100 text-emerald-800 border-emerald-200",
    medium: "bg-amber-100 text-amber-800 border-amber-200",
    high: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = map[level] ?? map.medium;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {level.toUpperCase()} RISK
    </span>
  );
}

// ── Action status icon ────────────────────────────────────────────────────────

function ActionStatusIcon({ status }: { status: string }) {
  if (status === "executed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "executing") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (status === "approved") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (status === "rejected") return <ShieldX className="h-4 w-4 text-slate-400" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

// ── Action Card ───────────────────────────────────────────────────────────────

function ActionCard({
  action: initialAction,
  onUpdate,
}: {
  action: AIAction;
  onUpdate: (updated: AIAction) => void;
}) {
  const [action, setAction] = useState(initialAction);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for result while executing
  useEffect(() => {
    if (action.status === "approved" || action.status === "executing") {
      pollRef.current = setInterval(async () => {
        try {
          const updated = await api<AIAction>(`/ai/actions/${action.id}`);
          setAction(updated);
          onUpdate(updated);
          if (updated.status === "executed" || updated.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {}
      }, 2000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [action.status]);

  async function approve() {
    setBusy(true);
    try {
      const updated = await api<AIAction>(`/ai/actions/${action.id}/approve`, {
        method: "POST",
      });
      setAction(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      const updated = await api<AIAction>(`/ai/actions/${action.id}/reject`, {
        method: "POST",
      });
      setAction(updated);
      onUpdate(updated);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Rejection failed");
    } finally {
      setBusy(false);
    }
  }

  const isPending = action.status === "pending_approval";
  const isRunning = action.status === "approved" || action.status === "executing";
  const isDone = action.status === "executed" || action.status === "failed" || action.status === "rejected";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mt-3 rounded-xl border p-4 text-sm ${
        isDone
          ? action.status === "executed"
            ? "border-emerald-200 bg-emerald-50"
            : action.status === "rejected"
            ? "border-slate-200 bg-slate-50"
            : "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ServerCog className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
          <span className="font-semibold text-slate-900">{action.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge level={action.risk_level} />
          <ActionStatusIcon status={action.status} />
        </div>
      </div>

      {/* Description */}
      {action.description && (
        <p className="mb-2 text-slate-600">{action.description}</p>
      )}

      {/* Server */}
      {action.server_name && (
        <p className="mb-2 text-xs text-slate-500">
          <span className="font-medium">Server:</span> {action.server_name}
        </p>
      )}

      {/* Command */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
        <Terminal className="mr-1.5 inline h-3 w-3 text-slate-400" />
        {action.command}
      </div>

      {/* Approve / Reject buttons */}
      {isPending && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={approve}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            Approve &amp; Run
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={reject}
            disabled={busy}
            className="border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            <ShieldX className="mr-1.5 h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      )}

      {/* Running state */}
      {isRunning && (
        <div className="flex items-center gap-2 text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Executing on server…</span>
        </div>
      )}

      {/* Result output */}
      {action.result_output && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-slate-600">Output:</p>
          <pre className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-xs text-emerald-300 whitespace-pre-wrap">
            {action.result_output}
          </pre>
        </div>
      )}

      {/* Error */}
      {action.error_message && action.status === "failed" && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-medium">Error:</span> {action.error_message}
        </div>
      )}

      {/* Rejected */}
      {action.status === "rejected" && (
        <p className="text-xs text-slate-500 italic">Action rejected — no command was executed.</p>
      )}
    </motion.div>
  );
}

function DevOpsApprovalCard({
  approval,
  onDone,
}: {
  approval: DevOpsApproval;
  onDone: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    try {
      await api(`/approvals/${approval.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: `${action}d from AI Intelligence` }),
      });
      onDone(approval.id);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 text-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{approval.title}</div>
          <div className="text-xs text-slate-500">{approval.action_type} - {new Date(approval.created_at).toLocaleString()}</div>
        </div>
        <RiskBadge level={approval.risk_level} />
      </div>
      {approval.description && (
        <pre className="mb-3 max-h-28 overflow-auto rounded-lg bg-slate-900 p-2 text-xs text-emerald-300 whitespace-pre-wrap">
          {approval.description}
        </pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide("approve")} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
          Approve &amp; Run
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("reject")}>
          <ShieldX className="mr-1.5 h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "I'm your Backup Intelligence AI. I read your live system data — servers, backups, logs, alerts — and give you actionable insights.\n\nI can also propose SSH commands to fix issues on your servers. You'll see an approval card before anything runs.",
    },
  ]);
  const [pendingActions, setPendingActions] = useState<AIAction[]>([]);
  const [pendingDevOpsApprovals, setPendingDevOpsApprovals] = useState<DevOpsApproval[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    api<AIStatus>("/ai/status")
      .then(setAiStatus)
      .catch(() =>
        setAiStatus({ provider: "none", configured: false, anthropic: false, openai: false })
      );
    // Fetch any existing pending actions from previous sessions
    api<AIAction[]>("/ai/actions?status=pending_approval")
      .then(setPendingActions)
      .catch(() => {});
    api<DevOpsApproval[]>("/approvals/pending")
      .then(setPendingDevOpsApprovals)
      .catch(() => {});
  }, []);

  function updateActionInMessages(updated: AIAction) {
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        actions: msg.actions?.map((a) => (a.id === updated.id ? updated : a)),
      }))
    );
    // Remove from pending panel if no longer pending
    if (updated.status !== "pending_approval") {
      setPendingActions((prev) => prev.filter((a) => a.id !== updated.id));
    }
  }

  async function sendMessage(text?: string) {
    const msg = text || input;
    if (!msg.trim()) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await api<{ conversation_id: string; message: string; proposed_actions: AIAction[] }>(
        "/ai/chat",
        {
          method: "POST",
          body: JSON.stringify({ message: msg, conversation_id: conversationId }),
        }
      );
      setConversationId(res.conversation_id);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.message, actions: res.proposed_actions },
      ]);
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Request failed";
      if (detail.includes("CSRF")) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Session expired. Please sign out and sign in again, then retry." },
        ]);
      } else if (detail.includes("Insufficient permissions")) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Your role does not have AI access. Contact an admin." },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Error: ${detail}${
              !aiStatus?.configured
                ? "\n\nTip: Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env and run: docker compose restart api"
                : ""
            }`,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout title="AI Intelligence">
      <PageHero
        icon={Brain}
        title="Backup Intelligence AI"
        description="Reads your live system data and proposes fixes — you approve before anything runs"
      />

      {/* Provider status banner */}
      {aiStatus && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
            aiStatus.configured
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {aiStatus.configured ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              AI provider active: <strong className="capitalize">{aiStatus.provider}</strong> — full system analysis enabled
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              Using built-in heuristics — add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env and restart API for Claude/GPT
            </>
          )}
        </motion.div>
      )}

      {/* Pending approvals from previous sessions */}
      <AnimatePresence>
        {(pendingActions.length > 0 || pendingDevOpsApprovals.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4"
          >
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="flex items-center gap-2 text-sm text-amber-800">
                  <Clock className="h-4 w-4" />
                  {pendingActions.length + pendingDevOpsApprovals.length} pending action{pendingActions.length + pendingDevOpsApprovals.length > 1 ? "s" : ""} awaiting approval
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {pendingDevOpsApprovals.map((approval) => (
                  <DevOpsApprovalCard
                    key={approval.id}
                    approval={approval}
                    onDone={(id) => setPendingDevOpsApprovals((prev) => prev.filter((a) => a.id !== id))}
                  />
                ))}
                {pendingActions.map((a) => (
                  <ActionCard key={a.id} action={a} onUpdate={updateActionInMessages} />
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex h-[calc(100vh-16rem)] flex-col">
        {/* Suggestion chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => sendMessage(s)}
              className="rounded-full border border-emerald-200 bg-white px-4 py-1.5 text-sm text-emerald-800 shadow-sm transition hover:bg-emerald-50"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {s}
            </motion.button>
          ))}
        </div>

        {/* Chat window */}
        <Card className="flex flex-1 flex-col overflow-hidden glass">
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${
                      m.role === "user"
                        ? "gradient-primary text-white shadow-md"
                        : "border border-emerald-100 bg-white text-foreground"
                    }`}
                  >
                    {m.role === "assistant" && (
                      <Brain className="mb-1 inline h-4 w-4 text-emerald-600" />
                    )}
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {/* Inline action cards */}
                    {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {m.actions.map((action) => (
                          <ActionCard
                            key={action.id}
                            action={action}
                            onUpdate={updateActionInMessages}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                  <span>Analyzing infrastructure…</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="flex gap-2 border-t border-emerald-100 p-4">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Ask about backups, servers, storage, or say 'fix disk space on web-01'…"
                className="flex-1"
              />
              <Button onClick={() => sendMessage()} disabled={loading || !input.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
