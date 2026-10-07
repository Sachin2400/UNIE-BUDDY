import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { resetAdaptiveDifficulty } from "@/lib/mcqs.functions";
import { BarChart3, RotateCcw, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

type Row = {
  is_correct: boolean;
  topic: string | null;
  subject: string | null;
  difficulty: string | null;
  created_at: string;
};

function AnalyticsPage() {
  const qc = useQueryClient();
  const reset = useServerFn(resetAdaptiveDifficulty);
  const [busy, setBusy] = useState<string | null>(null);

  const attempts = useQuery({
    queryKey: ["mcq-attempts", "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcq_attempts")
        .select("is_correct, topic, subject, difficulty, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { byTopic, bySubject, byDifficulty, overall } = useMemo(() => {
    const rows = attempts.data ?? [];
    const agg = (key: keyof Row) => {
      const m = new Map<string, { total: number; correct: number }>();
      for (const r of rows) {
        const k = (r[key] as string | null) ?? "Unclassified";
        const cur = m.get(k) ?? { total: 0, correct: 0 };
        cur.total++;
        if (r.is_correct) cur.correct++;
        m.set(k, cur);
      }
      return [...m.entries()]
        .map(([name, v]) => ({ name, total: v.total, correct: v.correct, accuracy: v.correct / v.total }))
        .sort((a, b) => a.accuracy - b.accuracy);
    };
    const total = rows.length;
    const correct = rows.filter((r) => r.is_correct).length;
    return {
      byTopic: agg("topic"),
      bySubject: agg("subject"),
      byDifficulty: agg("difficulty"),
      overall: { total, correct, accuracy: total > 0 ? correct / total : 0 },
    };
  }, [attempts.data]);

  async function doReset(scope: "all" | "subject" | "topic", label: string, subject?: string, topic?: string) {
    if (!confirm(`Reset adaptive difficulty for ${label}? Your attempt history for this scope will be cleared and future MCQs will re-calibrate from a baseline.`)) return;
    setBusy(label);
    try {
      const res = await reset({ data: { scope, subject, topic } });
      toast.success(`Cleared ${res.cleared} attempt${res.cleared === 1 ? "" : "s"} for ${label}.`);
      qc.invalidateQueries({ queryKey: ["mcq-attempts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Analytics</p>
          <h1 className="mt-1 font-serif text-3xl md:text-4xl">Topic performance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Accuracy across every MCQ you've attempted, weakest first. This drives the adaptive difficulty mix.
          </p>
        </div>
        <button
          onClick={() => doReset("all", "all topics")}
          disabled={busy !== null || overall.total === 0}
          className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
        >
          {busy === "all topics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reset all difficulty
        </button>
      </div>

      {attempts.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!attempts.isLoading && overall.total === 0 && (
        <p className="text-sm text-muted-foreground">No attempts yet — answer a few MCQs and come back.</p>
      )}

      {overall.total > 0 && (
        <>
          <div className="mb-8 grid grid-cols-3 gap-4">
            <Stat label="Attempts" value={overall.total.toString()} />
            <Stat label="Correct" value={overall.correct.toString()} />
            <Stat label="Accuracy" value={`${(overall.accuracy * 100).toFixed(0)}%`} />
          </div>

          <Group title="By subject" rows={bySubject} onReset={(name) => doReset("subject", name, name)} busy={busy} />
          <Group title="By topic" rows={byTopic} onReset={(name) => doReset("topic", name, undefined, name)} busy={busy} />
          <Group title="By difficulty" rows={byDifficulty} />
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-2xl">{value}</p>
    </div>
  );
}

function Group({
  title,
  rows,
  onReset,
  busy,
}: {
  title: string;
  rows: { name: string; total: number; correct: number; accuracy: number }[];
  onReset?: (name: string) => void;
  busy?: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-accent" />
        <h2 className="font-serif text-lg">{title}</h2>
      </div>
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {rows.map((r) => {
          const pct = Math.round(r.accuracy * 100);
          const tone =
            pct < 40 ? "bg-destructive" : pct < 70 ? "bg-amber-500" : "bg-emerald-500";
          return (
            <div key={r.name} className="flex items-center gap-4 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="w-16 text-right text-sm tabular-nums">
                <span className="font-semibold">{pct}%</span>
                <span className="ml-1 text-xs text-muted-foreground">({r.total})</span>
              </div>
              {onReset && (
                <button
                  onClick={() => onReset(r.name)}
                  disabled={busy === r.name}
                  title={`Reset difficulty for ${r.name}`}
                  className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  {busy === r.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
