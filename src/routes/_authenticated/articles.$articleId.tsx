import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { ArrowLeft, Flame } from "lucide-react";
import { RelevanceBadge } from "./dashboard";
import { McqPanel } from "@/components/McqPanel";

export const Route = createFileRoute("/_authenticated/articles/$articleId")({
  component: ArticleDetail,
});

function ArticleDetail() {
  const { articleId } = Route.useParams();

  const q = useQuery({
    queryKey: ["article", articleId],
    queryFn: async () => {
      const { data, error } = await supabase.from("articles").select("*").eq("id", articleId).single();
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <Link to="/articles" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to articles
      </Link>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && (
        <article className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <RelevanceBadge score={q.data.upsc_relevance_score ?? 0} />
            <div className="flex flex-wrap gap-2 text-xs">
              {q.data.subject && <span className="rounded bg-secondary px-2 py-0.5">{q.data.subject}</span>}
              {q.data.gs_paper && <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{q.data.gs_paper}</span>}
              {q.data.is_hot_topic && (
                <span className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-accent-foreground">
                  <Flame className="h-3 w-3" /> Hot topic
                </span>
              )}
            </div>
          </div>

          <h1 className="mt-4 font-serif text-3xl leading-tight md:text-4xl">{q.data.title}</h1>

          {q.data.summary && (
            <div className="mt-6 rounded-md border-l-2 border-accent bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-accent">Summary</p>
              <p className="mt-1 text-sm leading-relaxed">{q.data.summary}</p>
            </div>
          )}

          {q.data.upsc_reasoning && (
            <div className="mt-4 rounded-md border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Why it matters for UPSC</p>
              <p className="mt-1 text-sm leading-relaxed">{q.data.upsc_reasoning}</p>
            </div>
          )}

          {q.data.topics?.length > 0 && (
            <div className="mt-4 rounded-md border border-border/70 bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Extracted topics</p>
                <a
                  href="#mcqs"
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  Jump to MCQs for these topics →
                </a>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {q.data.topics.map((t: string) => (
                  <a
                    key={t}
                    href="#mcqs"
                    className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:border-accent hover:text-accent"
                  >
                    {t}
                  </a>
                ))}
              </div>
            </div>
          )}


          <div className="prose prose-neutral mt-8 max-w-none font-serif text-[17px] leading-[1.75] text-foreground">
            {q.data.content.split(/\n{2,}/).map((p: string, i: number) => (
              <p key={i} className="mb-4">{p}</p>
            ))}
          </div>

          <McqPanel articleId={q.data.id} />
        </article>
      )}
    </AppShell>
  );
}
