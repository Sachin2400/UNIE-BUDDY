import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Check, X, History as HistoryIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

type Row = {
  id: string;
  is_correct: boolean;
  picked_index: number;
  topic: string | null;
  subject: string | null;
  difficulty: string | null;
  created_at: string;
  article_id: string;
  mcq_id: string;
  mcqs: { question: string; correct_index: number; options: unknown } | null;
  articles: { title: string } | null;
};

function HistoryPage() {
  const attempts = useQuery({
    queryKey: ["mcq-attempts", "history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcq_attempts")
        .select(
          "id, is_correct, picked_index, topic, subject, difficulty, created_at, article_id, mcq_id, mcqs(question, correct_index, options), articles(title)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <AppShell>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">History</p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">Attempt history</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your last 200 MCQ attempts, newest first.
        </p>
      </div>

      {attempts.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!attempts.isLoading && (attempts.data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">No attempts yet.</p>
      )}

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {attempts.data?.map((a) => {
          const options = Array.isArray(a.mcqs?.options) ? (a.mcqs?.options as string[]) : [];
          const picked = options[a.picked_index];
          const correct = a.mcqs ? options[a.mcqs.correct_index] : undefined;
          return (
            <div key={a.id} className="p-4">
              <div className="flex items-start gap-3">
                <span
                  className={
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
                    (a.is_correct ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive")
                  }
                >
                  {a.is_correct ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{a.mcqs?.question ?? "(question deleted)"}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {a.subject && <Pill>{a.subject}</Pill>}
                    {a.topic && <Pill>{a.topic}</Pill>}
                    {a.difficulty && <Pill>{a.difficulty}</Pill>}
                    <span>{new Date(a.created_at).toLocaleString()}</span>
                    {a.articles?.title && (
                      <Link
                        to="/articles/$articleId"
                        params={{ articleId: a.article_id }}
                        className="text-accent hover:underline"
                      >
                        · {a.articles.title}
                      </Link>
                    )}
                  </div>
                  {picked !== undefined && (
                    <p className="mt-2 text-xs">
                      <span className="text-muted-foreground">You picked: </span>
                      <span className={a.is_correct ? "text-emerald-600" : "text-destructive"}>{picked}</span>
                      {!a.is_correct && correct && (
                        <>
                          <span className="text-muted-foreground"> · Correct: </span>
                          <span className="text-emerald-600">{correct}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <HistoryIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 uppercase tracking-wide">{children}</span>;
}
