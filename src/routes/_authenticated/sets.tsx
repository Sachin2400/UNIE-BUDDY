import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Layers, ChevronRight, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sets")({
  component: SetsPage,
  head: () => ({
    meta: [
      { title: "My MCQ Sets · UNIE" },
      { name: "description", content: "Revisit every previously generated UPSC MCQ set without regenerating." },
      { property: "og:title", content: "My MCQ Sets · UNIE" },
      { property: "og:description", content: "Cached MCQ history per article — instant, token-free access." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type SetRow = {
  id: string;
  article_id: string;
  count: number;
  mcq_ids: string[];
  adaptive: {
    mix?: { easy: number; medium: number; hard: number };
    band?: string;
    reasoning?: string;
  } | null;
  created_at: string;
  articles: { title: string; subject: string | null; gs_paper: string | null } | null;
};

function SetsPage() {
  const q = useQuery({
    queryKey: ["mcq-sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcq_sets")
        .select("id, article_id, count, mcq_ids, adaptive, created_at, articles(title, subject, gs_paper)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SetRow[];
    },
  });

  return (
    <AppShell>
      <header className="mb-6 flex items-center gap-2">
        <Layers className="h-5 w-5 text-accent" />
        <div>
          <h1 className="font-serif text-3xl">My MCQ Sets</h1>
          <p className="text-sm text-muted-foreground">
            Every batch you generated — cached by article content so revisiting spends zero AI tokens.
          </p>
        </div>
      </header>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No sets yet. Open any article and generate MCQs — the batch will appear here for instant recall.
        </div>
      )}

      <ol className="space-y-2">
        {q.data?.map((s) => {
          const mix = s.adaptive?.mix;
          return (
            <li key={s.id}>
              <Link
                to="/articles/$articleId"
                params={{ articleId: s.article_id }}
                hash="mcqs"
                className="group flex items-start justify-between gap-3 rounded-md border border-border bg-card p-4 hover:border-primary/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5">{s.count} questions</span>
                    {mix && (
                      <span className="rounded bg-secondary px-1.5 py-0.5">
                        {mix.easy}E / {mix.medium}M / {mix.hard}H
                      </span>
                    )}
                    {s.adaptive?.band && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{s.adaptive.band}</span>
                    )}
                    {s.articles?.gs_paper && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        {s.articles.gs_paper}
                      </span>
                    )}
                    <span>{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                  <p className="truncate text-sm font-medium">
                    {s.articles?.title ?? "(article deleted)"}
                  </p>
                  {s.adaptive?.reasoning && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      <Sparkles className="mr-1 inline h-3 w-3 text-accent" />
                      {s.adaptive.reasoning}
                    </p>
                  )}
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </Link>
            </li>
          );
        })}
      </ol>
    </AppShell>
  );
}
