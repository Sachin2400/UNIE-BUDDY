import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Upload, FileText, LogOut, BarChart3, History, BookOpen, Brain, Landmark, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/articles", label: "Articles", icon: FileText },
  { to: "/mcqs", label: "MCQs", icon: Brain },
  { to: "/sets", label: "My Sets", icon: Layers },
  { to: "/pib", label: "PIB", icon: Landmark },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/history", label: "History", icon: History },
  { to: "/ncert", label: "NCERT", icon: BookOpen },
] as const;


export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-semibold">UNIE</span>
            <span className="hidden text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Newspaper Intelligence
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = pathname === to || pathname.startsWith(to + "/");
              return (
                <Link
                  key={to}
                  to={to}
                  className={
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
            <button
              onClick={signOut}
              title="Sign out"
              className="ml-2 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
