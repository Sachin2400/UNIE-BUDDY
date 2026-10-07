import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateMcqs, recordMcqAttempt } from "@/lib/mcqs.functions";
import { Brain, Check, Loader2, Sparkles, X, RotateCcw } from "lucide-react";

type Mcq = {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  difficulty: string | null;
  topic: string | null;
};

type Adaptive = {
  mix: { easy: number; medium: number; hard: number };
  anchorAcc: number | null;
  band?: string;
  reasoning?: string;
  weakestTopics?: { topic: string; accuracy: number; total: number }[];
};

export function McqPanel({ articleId }: { articleId: string }) {
  const qc = useQueryClient();
  const gen = useServerFn(generateMcqs);
  const record = useServerFn(recordMcqAttempt);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [cachedNotice, setCachedNotice] = useState(false);
  const [adaptive, setAdaptive] = useState<Adaptive | null>(null);


  const mcqs = useQuery({
    queryKey: ["mcqs", articleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcqs")
        .select("id, question, options, correct_index, explanation, difficulty, topic")
        .eq("article_id", articleId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Mcq[];
    },
  });

  const generate = useMutation({
    mutationFn: async (count: number) => gen({ data: { articleId, count } }),
    onSuccess: (res) => {
      setError(null);
      if (res && "adaptive" in res && res.adaptive) setAdaptive(res.adaptive as Adaptive);
      setCachedNotice(Boolean(res && "cached" in res && res.cached));
      qc.invalidateQueries({ queryKey: ["mcqs", articleId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to generate"),
  });


  const stats = useMemo(() => {
    const total = mcqs.data?.length ?? 0;
    let attempted = 0;
    let correct = 0;
    for (const m of mcqs.data ?? []) {
      if (answers[m.id] != null) {
        attempted++;
        if (answers[m.id] === m.correct_index) correct++;
      }
    }
    return { total, attempted, correct };
  }, [mcqs.data, answers]);

  function resetAll() {
    setAnswers({});
    setRevealed({});
  }

  return (
    <section id="mcqs" className="mt-10 rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          <h2 className="font-serif text-lg">Practice MCQs</h2>
          {stats.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {stats.correct}/{stats.attempted} correct · {stats.total} total
            </span>
          )}
          {adaptive && (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary-foreground"
              title={
                adaptive.anchorAcc == null
                  ? "No prior performance yet — balanced difficulty"
                  : `Tuned to your accuracy ${(adaptive.anchorAcc * 100).toFixed(0)}%`
              }
            >
              Adaptive · {adaptive.mix.easy}E / {adaptive.mix.medium}M / {adaptive.mix.hard}H
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stats.total > 0 && (
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          )}
          <button
            onClick={() => generate.mutate(5)}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {stats.total > 0 ? "Generate 5 more" : "Generate MCQs"}
          </button>
        </div>
      </div>

      <div className="p-4">
        {cachedNotice && (
          <div className="mb-3 rounded border border-accent/40 bg-accent/10 p-2 text-xs text-accent">
            Reused a cached set — no AI tokens spent. Article content is unchanged.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {mcqs.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!mcqs.isLoading && stats.total === 0 && !generate.isPending && (
          <p className="text-sm text-muted-foreground">
            No questions yet. Generate a set of UPSC-style MCQs from this article.
          </p>
        )}

        {adaptive && (adaptive.reasoning || adaptive.weakestTopics?.length) && (
          <div className="mb-4 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs">
            <p className="mb-1 font-semibold uppercase tracking-wide text-accent">
              Why this mix{adaptive.band ? ` · ${adaptive.band}` : ""}
            </p>
            {adaptive.reasoning && <p className="text-muted-foreground">{adaptive.reasoning}</p>}
            {adaptive.weakestTopics && adaptive.weakestTopics.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Weighted toward weakest topics:{" "}
                {adaptive.weakestTopics.map((t, i) => (
                  <span key={t.topic}>
                    {i > 0 && ", "}
                    <span className="text-foreground">{t.topic}</span>{" "}
                    <span className="text-muted-foreground">({(t.accuracy * 100).toFixed(0)}%)</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}

        <ol className="space-y-5">
          {mcqs.data?.map((m, idx) => {
            const picked = answers[m.id];
            const isRevealed = revealed[m.id];
            return (
              <li key={m.id} className="rounded-md border border-border/70 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xs font-semibold text-muted-foreground">Q{idx + 1}</span>
                  <div className="flex-1">
                    <p className="font-medium leading-snug">{m.question}</p>
                    {m.difficulty && (
                      <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary-foreground">
                        {m.difficulty}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {m.options.map((opt, i) => {
                    const isPicked = picked === i;
                    const isCorrect = i === m.correct_index;
                    const showResult = isRevealed;
                    const cls = [
                      "flex items-start gap-2 rounded border px-3 py-2 text-left text-sm transition-colors",
                      showResult && isCorrect
                        ? "border-emerald-500/60 bg-emerald-500/10"
                        : showResult && isPicked && !isCorrect
                          ? "border-destructive/60 bg-destructive/10"
                          : isPicked
                            ? "border-primary bg-primary/5"
                            : "border-input hover:bg-secondary",
                    ].join(" ");
                    return (
                      <button
                        key={i}
                        disabled={isRevealed}
                        onClick={() => {
                          setAnswers((a) => ({ ...a, [m.id]: i }));
                          setRevealed((r) => ({ ...r, [m.id]: true }));
                          record({ data: { mcqId: m.id, pickedIndex: i } }).catch(() => {
                            /* non-blocking: attempt logging is best-effort */
                          });
                        }}
                        className={cls}
                      >
                        <span className="mt-0.5 w-4 text-xs font-semibold text-muted-foreground">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {showResult && isCorrect && <Check className="h-4 w-4 text-emerald-600" />}
                        {showResult && isPicked && !isCorrect && <X className="h-4 w-4 text-destructive" />}
                      </button>
                    );
                  })}
                </div>

                {isRevealed && m.explanation && (
                  <div className="mt-3 rounded border-l-2 border-accent bg-background p-3 text-sm">
                    <p className="text-[11px] uppercase tracking-wide text-accent">Explanation</p>
                    <p className="mt-1 leading-relaxed">{m.explanation}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
