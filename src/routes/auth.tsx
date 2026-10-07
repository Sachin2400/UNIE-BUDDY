import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin + "/dashboard",
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      // Use Supabase's native OAuth flow directly instead of Lovable's cloud
      // auth broker (@lovable.dev/cloud-auth-js), which redirects to
      // /~oauth/initiate — a route that only exists on Lovable's own hosted
      // platform. Locally, that route 404s. signInWithOAuth below redirects
      // the browser straight to Supabase's hosted authorize endpoint, which
      // then redirects to Google and back to `redirectTo` — no broker needed.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/dashboard",
        },
      });
      if (error) throw error;
      // On success the browser navigates away to Google immediately;
      // there's nothing further to do here.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 md:grid-cols-2">
        <aside className="hidden flex-col justify-between border-r border-border/60 p-10 md:flex">
          <Link to="/" className="font-serif text-2xl">UNIE</Link>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-accent">Prelims-ready in one sitting</p>
            <h2 className="mt-4 font-serif text-3xl leading-tight">
              "The newspaper is the syllabus. UNIE is the highlighter."
            </h2>
            <p className="mt-4 text-sm text-muted-foreground">
              Upload your PDFs, get UPSC relevance scores, hot topics, and structured summaries.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} UNIE</p>
        </aside>

        <main className="flex items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-sm">
            <Link to="/" className="mb-8 inline-block font-serif text-xl md:hidden">UNIE</Link>
            <h1 className="font-serif text-3xl">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signin" ? "Sign in to continue your revision." : "Start turning newspapers into study briefs."}
            </p>

            <button
              onClick={google}
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-60"
            >
              <GoogleIcon /> Continue with Google
            </button>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              {mode === "signup" && (
                <Field label="Full name" value={name} onChange={setName} type="text" required />
              )}
              <Field label="Email" value={email} onChange={setEmail} type="email" required />
              <Field label="Password" value={password} onChange={setPassword} type="password" required minLength={6} />
              <button
                disabled={busy}
                className="mt-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-sm text-muted-foreground">
              {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
              <button
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="font-medium text-accent hover:underline"
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type, required, minLength,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type: string; required?: boolean; minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-ring/40 focus:ring-2"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  );
}
