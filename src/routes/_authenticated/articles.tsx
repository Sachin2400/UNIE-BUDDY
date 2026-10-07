import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { RelevanceBadge } from "./dashboard";
import { Flame, Search, List, Layers } from "lucide-react";

export const Route = createFileRoute("/_authenticated/articles")({
  component: ArticlesPage,
});

function ArticlesPage() {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState<string>("all");
  const [onlyHot, setOnlyHot] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "cluster">("list");

  const articles = useQuery({
    queryKey: ["articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, summary, subject, topics, upsc_relevance_score, is_hot_topic, gs_paper, created_at")
        .order("upsc_relevance_score", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const subjects = useMemo(() => {
    const s = new Set<string>();
    articles.data?.forEach((a) => a.subject && s.add(a.subject));
    return [...s].sort();
  }, [articles.data]);

  const filtered = useMemo(() => {
    return (articles.data ?? []).filter((a) => {
      if (onlyHot && !a.is_hot_topic) return false;
      if (subject !== "all" && a.subject !== subject) return false;
      if ((a.upsc_relevance_score ?? 0) < minScore) return false;
      if (q) {
        const s = q.toLowerCase();
        return a.title.toLowerCase().includes(s) || (a.summary ?? "").toLowerCase().includes(s);
      }
      return true;
    });
  }, [articles.data, q, subject, onlyHot, minScore]);

  // Build topic clusters from filtered articles
  const topicClusters = useMemo(() => {
    const clusters = new Map<string, { articles: Array<{ id: string; title: string; summary: string | null; subject: string | null; topics: string[]; upsc_relevance_score: number | null; is_hot_topic: boolean; gs_paper: string | null; created_at: string }>; count: number; maxScore: number }>();
    filtered.forEach((a) => {
      (a.topics ?? []).forEach((topic) => {
        const existing = clusters.get(topic);
        if (!existing) {
          clusters.set(topic, { articles: [a], count: 1, maxScore: a.upsc_relevance_score ?? 0 });
        } else {
          existing.articles.push(a);
          existing.count++;
          existing.maxScore = Math.max(existing.maxScore, a.upsc_relevance_score ?? 0);
        }
      });
    });
    return [...clusters.entries()]
      .map(([topic, data]) => ({ topic, ...data }))
      .sort((a, b) => b.maxScore - a.maxScore || b.count - a.count);
  }, [filtered]);

  return (
    <AppShell>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Library</p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">Articles</h1>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or summary…"
            className="w-full rounded-md border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="all">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          {[0, 25, 50, 75].map((n) => <option key={n} value={n}>Score ≥ {n}</option>)}
        </select>
        <button
          onClick={() => setOnlyHot((v) => !v)}
          className={
            "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors " +
            (onlyHot ? "border-accent bg-accent text-accent-foreground" : "border-input bg-card hover:bg-secondary")
          }
        >
          <Flame className="h-4 w-4" /> Hot only
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{filtered.length} article{filtered.length === 1 ? "" : "s"}</p>

      {/* View Mode Toggle */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">View:</span>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (viewMode === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("cluster")}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (viewMode === "cluster"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {viewMode === "cluster" ? `${topicClusters.length} topic clusters` : `${filtered.length} articles`}
        </span>
      </div>

      {viewMode === "cluster" && (
        <div className="grid gap-3">
          {topicClusters.length === 0 && !articles.isLoading && (
            <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
              No topic clusters found.
            </div>
          )}
          {topicClusters.map((cluster) => (
            <div key={cluster.topic} className="rounded-md border border-border/70 bg-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                    {cluster.topic}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {cluster.count} article{cluster.count === 1 ? "" : "s"} • Max relevance {cluster.maxScore}/100
                  </span>
                </div>
                {cluster.articles.some(a => a.is_hot_topic) && (
                  <Flame className="h-4 w-4 text-accent" aria-label="Contains hot topic article" />
                )}
              </div>
              <div className="grid gap-2">
                {cluster.articles
                  .sort((a, b) => (b.upsc_relevance_score ?? 0) - (a.upsc_relevance_score ?? 0))
                  .map((a) => (
                    <Link
                      key={a.id}
                      to="/articles/$articleId"
                      params={{ articleId: a.id }}
                      className="flex items-center gap-3 rounded border border-border/50 bg-background p-2 hover:border-accent/60 transition-colors"
                    >
                      <RelevanceBadge score={a.upsc_relevance_score ?? 0} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-sm font-medium">{a.title}</p>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {a.subject && <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">{a.subject}</span>}
                          {a.gs_paper && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{a.gs_paper}</span>}
                          {a.is_hot_topic && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent text-[9px]">Hot</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div className="grid gap-3">
        {articles.isLoading && <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>}
        {!articles.isLoading && filtered.length === 0 && (
          <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            No articles match your filters.
          </div>
        )}
        {filtered.map((a) => (
          <Link
            key={a.id}
            to="/articles/$articleId"
            params={{ articleId: a.id }}
            className="flex items-start gap-4 rounded-md border border-border bg-card p-4 hover:border-accent/60"
          >
            <RelevanceBadge score={a.upsc_relevance_score ?? 0} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-serif text-lg">{a.title}</h3>
                {a.is_hot_topic && <Flame className="h-4 w-4 shrink-0 text-accent" />}
              </div>
              {a.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {a.subject && <span className="rounded bg-secondary px-2 py-0.5 text-secondary-foreground">{a.subject}</span>}
                {a.gs_paper && <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{a.gs_paper}</span>}
                {a.topics?.slice(0, 4).map((t) => (
                  <span key={t} className="rounded border border-border px-2 py-0.5 text-muted-foreground">{t}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
        </div>
      )}
    </AppShell>
  );
}
