import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, FileText, Sparkles, Target, Upload, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-serif text-2xl font-semibold tracking-tight">UNIE</span>
            <span className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Newspaper Intelligence
            </span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#how" className="text-muted-foreground hover:text-foreground">How it works</a>
            <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
            <Link
              to="/auth"
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            UPSC Newspaper Intelligence Engine
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight md:text-6xl">
            Read the newspaper the way a topper reads it.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Upload up to five newspaper PDFs. UNIE extracts every article, classifies it by
            subject, scores its UPSC Prelims relevance, and surfaces the hot topics — so you
            spend your morning studying, not skimming.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Upload className="h-4 w-4" /> Start uploading
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-secondary"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      <section id="features" className="border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl">Built for the exam, not for the feed.</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { Icon: FileText, title: "OCR & extraction", body: "Every article pulled from the PDF, page-by-page, with clean structured text." },
              { Icon: Target, title: "UPSC relevance score", body: "Each article scored 0–100 against three decades of Prelims patterns and syllabus themes." },
              { Icon: Sparkles, title: "Subject classification", body: "Auto-tagged by GS paper, subject, and specific topics — filter and revise fast." },
              { Icon: Zap, title: "Hot topic detection", body: "Recurring, high-yield themes surfaced so you don't miss what's trending in current affairs." },
              { Icon: BookOpen, title: "Summaries & context", body: "Concise, exam-oriented summaries next to the original text — no fluff." },
              { Icon: Upload, title: "Your data, your uploads", body: "Private per-user storage. Nothing is generated from thin air — sources are always your PDFs." },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="border-l-2 border-accent pl-5">
                <Icon className="h-5 w-5 text-accent" />
                <h3 className="mt-3 font-serif text-xl">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="border-b border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-serif text-3xl md:text-4xl">Three steps. One study-ready brief.</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {[
              ["01", "Upload", "Drop up to 5 newspaper PDFs — The Hindu, Indian Express, Livemint, whatever you read."],
              ["02", "Analyse", "UNIE runs OCR, extracts articles, classifies them, and scores UPSC relevance."],
              ["03", "Revise", "Open your dashboard, filter by subject or hot topic, and study only what matters."],
            ].map(([n, title, body]) => (
              <div key={n}>
                <p className="font-serif text-4xl text-accent">{n}</p>
                <h3 className="mt-3 font-serif text-xl">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        © {new Date().getFullYear()} UNIE. Built for UPSC aspirants.
      </footer>
    </div>
  );
}
