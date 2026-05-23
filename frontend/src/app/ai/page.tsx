"use client";

import { useEffect, useState, useRef } from "react";
import { Send, Brain, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

interface Message {
  role: string;
  content: string;
}

interface AIStatus {
  provider: string;
  configured: boolean;
  anthropic: boolean;
  openai: boolean;
}

const SUGGESTIONS = [
  "Why did backup fail?",
  "Why are backups slow?",
  "Which server is risky?",
  "Is restore safe?",
  "How to optimize storage?",
];

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "I'm your Backup Intelligence AI assistant. I analyze logs, metrics, backup history, and infrastructure events. How can I help?",
    },
  ]);
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
      .catch(() => setAiStatus({ provider: "none", configured: false, anthropic: false, openai: false }));
  }, []);

  async function sendMessage(text?: string) {
    const msg = text || input;
    if (!msg.trim()) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await api<{ conversation_id: string; message: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: msg, conversation_id: conversationId }),
      });
      setConversationId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: res.message }]);
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Request failed";
      if (detail.includes("CSRF")) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: "Session expired. Please sign out and sign in again, then retry.",
          },
        ]);
      } else if (detail.includes("Insufficient permissions")) {
        setMessages((m) => [...m, { role: "assistant", content: "Your role does not have AI access. Contact an admin." }]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Error: ${detail}${!aiStatus?.configured ? "\n\nTip: Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env and run: docker compose restart api" : ""}`,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout title="AI Intelligence">
      <PageHero icon={Brain} title="Backup Intelligence AI" description="Ask about failures, risks, restores, and optimization" />

      {aiStatus && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-2 text-sm ${
            aiStatus.configured
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          {aiStatus.configured ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              AI provider active: <strong className="capitalize">{aiStatus.provider}</strong>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              Using built-in heuristics — add API keys to .env and restart API for Claude/GPT
            </>
          )}
        </motion.div>
      )}

      <div className="flex h-[calc(100vh-14rem)] flex-col">
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => sendMessage(s)}
              className="rounded-full border border-emerald-200 bg-white px-4 py-1.5 text-sm text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              {s}
            </motion.button>
          ))}
        </div>

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
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                      m.role === "user"
                        ? "gradient-primary text-white shadow-md"
                        : "border border-emerald-100 bg-white text-foreground dark:border-emerald-900 dark:bg-emerald-950/40"
                    }`}
                  >
                    {m.role === "assistant" && <Brain className="mb-1 inline h-4 w-4 text-emerald-600" />}
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                </motion.div>
              ))}
              {loading && (
                <div className="flex gap-1 text-sm text-muted-foreground">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse delay-75">●</span>
                  <span className="animate-pulse delay-150">●</span>
                  <span className="ml-2">Analyzing infrastructure…</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 border-t border-emerald-100 p-4 dark:border-emerald-900">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Ask about backups, restores, risks…"
                className="flex-1"
              />
              <Button onClick={() => sendMessage()} disabled={loading}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
