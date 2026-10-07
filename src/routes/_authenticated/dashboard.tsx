import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { FileText, Upload, Flame, Target, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [papers, arts, hot] = await Promise.all([
        supabase.from("newspapers").select("id, status", { count: "exact" }),
        supabase.from("articles").select("id, upsc_relevance_score, subject", { count: "exact" }),
        supabase.from("articles").select("id", { count: "exact", head: true }).eq("is_hot_topic", true),
      ]);
      const avgRelevance =
        arts.data && arts.data.length
          ? Math.round(arts.data.reduce((s, a) => s + (a.upsc_relevance_score ?? 0), 0) / arts.data.length)
          : 0;
      const bySubject = new Map<string, number>();
      arts.data?.forEach((a) => {
        const k = a.subject ?? "Uncategorised";
        bySubject.set(k, (bySubject.get(k) ?? 0) + 1);
      });
      return {
        papers: papers.count ?? 0,
        processingPapers: papers.data?.filter((p) => p.status === "processing" || p.status === "pending").length ?? 0,
        articles: arts.count ?? 0,
        hot: hot.count ?? 0,
        avgRelevance,
        bySubject: [...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      };
    },
  });

  const recent = useQuery({
    queryKey: ["recent-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, subject, upsc_relevance_score, is_hot_topic, created_at")
        .order("upsc_relevance_score", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Overview</p>
          <h1 className="mt-1 font-serif text-3xl md:text-4xl">Your revision desk</h1>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="h-4 w-4" /> Upload newspapers
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Newspapers" value={stats.data?.papers ?? "—"} icon={FileText} sub={stats.data?.processingPapers ? `${stats.data.processingPapers} processing` : "all processed"} />
        <Stat label="Articles" value={stats.data?.articles ?? "—"} icon={FileText} />
        <Stat label="Hot topics" value={stats.data?.hot ?? "—"} icon={Flame} accent />
        <Stat label="Avg. relevance" value={stats.data ? `${stats.data.avgRelevance}` : "—"} icon={Target} />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Top UPSC-relevant articles</h2>
            <Link to="/articles" className="text-sm text-accent hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {recent.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
            {recent.data?.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">
                No articles yet. <Link to="/upload" className="text-accent hover:underline">Upload a newspaper</Link> to get started.
              </div>
            )}
            {recent.data?.map((a) => (
              <Link
                key={a.id}
                to="/articles/$articleId"
                params={{ articleId: a.id }}
                className="flex items-center gap-4 p-4 hover:bg-secondary/60"
              >
                <RelevanceBadge score={a.upsc_relevance_score ?? 0} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-serif text-base">{a.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.subject ?? "Uncategorised"}{a.is_hot_topic ? " · 🔥 Hot topic" : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside>
          <h2 className="mb-3 font-serif text-xl">By subject</h2>
          <div className="rounded-md border border-border bg-card p-4">
            {stats.data?.bySubject.length === 0 && (
              <p className="text-sm text-muted-foreground">No data yet.</p>
            )}
            <ul className="space-y-2">
              {stats.data?.bySubject.map(([subject, count]) => {
                const max = Math.max(...stats.data.bySubject.map(([, c]) => c));
                const pct = (count / max) * 100;
                return (
                  <li key={subject}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{subject}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function Stat({
  label, value, icon: Icon, sub, accent,
}: {
  label: string; value: string | number; icon: React.ComponentType<{ className?: string }>;
  sub?: string; accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={"h-4 w-4 " + (accent ? "text-accent" : "text-muted-foreground")} />
      </div>
      <p className="mt-2 font-serif text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function RelevanceBadge({ score }: { score: number }) {
  const tier = score >= 75 ? "bg-accent text-accent-foreground" : score >= 50 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tier}`}>
      {score}
    </span>
  );
}
