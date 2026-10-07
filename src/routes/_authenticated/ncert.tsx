import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BookOpen, ExternalLink, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ncert")({
  component: NcertPage,
});

// Curated links to the official NCERT textbook pages on ncert.nic.in.
// The `code` values are the stable book codes used by NCERT's PDF viewer
// (https://ncert.nic.in/textbook.php?<code>=1-N). If NCERT retires a book,
// the search fallback still works.
type Book = { class: number; subject: Subject; title: string; code: string };
type Subject = "History" | "Civics" | "Economics" | "Geography";

const BOOKS: Book[] = [
  // Class 6
  { class: 6, subject: "History", title: "Our Pasts – I", code: "fess1" },
  { class: 6, subject: "Civics", title: "Social and Political Life – I", code: "fess2" },
  { class: 6, subject: "Geography", title: "The Earth: Our Habitat", code: "fess3" },
  // Class 7
  { class: 7, subject: "History", title: "Our Pasts – II", code: "gess1" },
  { class: 7, subject: "Civics", title: "Social and Political Life – II", code: "gess2" },
  { class: 7, subject: "Geography", title: "Our Environment", code: "gess3" },
  // Class 8
  { class: 8, subject: "History", title: "Our Pasts – III", code: "hess3" },
  { class: 8, subject: "Civics", title: "Social and Political Life – III", code: "hess2" },
  { class: 8, subject: "Geography", title: "Resources and Development", code: "hess1" },
  // Class 9
  { class: 9, subject: "History", title: "India and the Contemporary World – I", code: "iess1" },
  { class: 9, subject: "Civics", title: "Democratic Politics – I", code: "iess3" },
  { class: 9, subject: "Economics", title: "Economics", code: "iess4" },
  { class: 9, subject: "Geography", title: "Contemporary India – I", code: "iess2" },
  // Class 10
  { class: 10, subject: "History", title: "India and the Contemporary World – II", code: "jess3" },
  { class: 10, subject: "Civics", title: "Democratic Politics – II", code: "jess4" },
  { class: 10, subject: "Economics", title: "Understanding Economic Development", code: "jess2" },
  { class: 10, subject: "Geography", title: "Contemporary India – II", code: "jess1" },
  // Class 11
  { class: 11, subject: "History", title: "Themes in World History", code: "kehs1" },
  { class: 11, subject: "Civics", title: "Indian Constitution at Work", code: "keps1" },
  { class: 11, subject: "Economics", title: "Indian Economic Development", code: "keec1" },
  { class: 11, subject: "Geography", title: "Fundamentals of Physical Geography", code: "kegy1" },
  { class: 11, subject: "Geography", title: "India: Physical Environment", code: "kegy2" },
  // Class 12
  { class: 12, subject: "History", title: "Themes in Indian History – I / II / III", code: "lehs1" },
  { class: 12, subject: "Civics", title: "Politics in India Since Independence", code: "leps2" },
  { class: 12, subject: "Economics", title: "Introductory Macroeconomics", code: "leec1" },
  { class: 12, subject: "Geography", title: "Fundamentals of Human Geography", code: "legy1" },
  { class: 12, subject: "Geography", title: "India: People and Economy", code: "legy2" },
];

const HOW_TO_READ: Record<Subject, string> = {
  History:
    "Read Class 6→8 as a fast narrative sweep for chronology, then treat Class 9–12 as your main source. Make a one-page timeline per era and note causes/effects rather than dates alone. NCERT History is the backbone for GS Paper I (Ancient, Medieval, Modern) and often surfaces in Prelims via themes rather than dates.",
  Civics:
    "Class 9 & 10 build intuition for how the Constitution works in practice; Class 11 (Indian Constitution at Work) is the core Prelims/GS-II text. Extract each chapter into: institution → composition → powers → constitutional article. Cross-link with news you upload here — most Polity current affairs map back to these chapters.",
  Economics:
    "Start with Class 9 & 10 for definitions (GDP, sectors, inflation, poverty, budget). Class 11 (Indian Economic Development) covers planning history and current sectors. Class 12 (Macroeconomics) is essential for the vocabulary you'll see in editorials. Build a glossary as you read — GS-III Economy rewards precision, not memorisation.",
  Geography:
    "Read physical geography (Class 11 book 1) with an atlas open — every concept has a location. Class 9 & 10 give you India-specific facts (climate, drainage, resources), Class 11 book 2 deepens India physical, Class 12 covers human and economic geography. Map-based Prelims questions are almost always resolvable if you've read these five books actively.",
};

function pdfUrl(code: string) {
  return `https://ncert.nic.in/textbook.php?${code}=0-1`;
}
function fallbackSearch(b: Book) {
  const q = encodeURIComponent(`NCERT Class ${b.class} ${b.subject} ${b.title} PDF site:ncert.nic.in`);
  return `https://www.google.com/search?q=${q}`;
}

function NcertPage() {
  const [filter, setFilter] = useState<"All" | Subject>("All");
  const [cls, setCls] = useState<number | "All">("All");
  const [q, setQ] = useState("");

  const filtered = BOOKS.filter(
    (b) =>
      (filter === "All" || b.subject === filter) &&
      (cls === "All" || b.class === cls) &&
      (q === "" || `${b.title} ${b.subject}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <AppShell>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">NCERT Library</p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">NCERT Class 6–12</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Curated links to the official NCERT textbooks (History, Civics, Economics, Geography) — the foundation
          layer that every serious UPSC aspirant reads first. Each book opens on ncert.nic.in; if a link ever
          breaks, use the search fallback.
        </p>
      </div>

      <section className="mb-8 rounded-md border border-accent/30 bg-accent/5 p-4">
        <h2 className="mb-2 font-serif text-lg">How to use these books</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Sweep first (Class 6–8):</span> read quickly for the
            narrative; don't take notes. You're building scaffolding.
          </li>
          <li>
            <span className="font-medium text-foreground">Anchor next (Class 9–10):</span> read carefully; extract
            definitions and cause-effect chains. These are Prelims-relevant.
          </li>
          <li>
            <span className="font-medium text-foreground">Deep-read (Class 11–12):</span> primary source for both
            Prelims and Mains. Highlight and revisit at least twice.
          </li>
          <li>
            <span className="font-medium text-foreground">Loop with news:</span> after each chapter, come back to
            UNIE and skim your recent articles in the same subject — that's where NCERT static meets current
            affairs.
          </li>
        </ul>
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search books…"
            className="w-full rounded-md border border-input bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <select
          value={cls}
          onChange={(e) => setCls(e.target.value === "All" ? "All" : Number(e.target.value))}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="All">All classes</option>
          {[6, 7, 8, 9, 10, 11, 12].map((c) => (
            <option key={c} value={c}>
              Class {c}
            </option>
          ))}
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "All" | Subject)}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="All">All subjects</option>
          <option value="History">History</option>
          <option value="Civics">Civics</option>
          <option value="Economics">Economics</option>
          <option value="Geography">Geography</option>
        </select>
      </div>

      {filter !== "All" && (
        <section className="mb-6 rounded-md border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.15em] text-accent">Study guide · {filter}</p>
          <p className="mt-2 text-sm leading-relaxed">{HOW_TO_READ[filter]}</p>
        </section>
      )}

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {filtered.length === 0 && <div className="p-6 text-sm text-muted-foreground">No books match your filters.</div>}
        {filtered.map((b) => (
          <div key={`${b.class}-${b.code}-${b.title}`} className="flex items-center gap-4 p-4">
            <BookOpen className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{b.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Class {b.class} · {b.subject}
              </p>
            </div>
            <a
              href={pdfUrl(b.code)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={fallbackSearch(b)}
              target="_blank"
              rel="noreferrer noopener"
              title="Search fallback"
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              Search
            </a>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        NCERT books are © NCERT and hosted on ncert.nic.in. UNIE only links to them.
      </p>
    </AppShell>
  );
}
