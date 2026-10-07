import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ExternalLink, Search, Landmark, RefreshCw, CalendarDays } from "lucide-react";


export const Route = createFileRoute("/_authenticated/pib")({
  component: PibHub,
  head: () => ({
    meta: [
      { title: "PIB Daily Hub · UNIE" },
      { name: "description", content: "Daily Press Information Bureau updates for the Centre and every Indian state — curated for UPSC aspirants." },
      { property: "og:title", content: "PIB Daily Hub · UNIE" },
      { property: "og:description", content: "One-stop PIB feed hub for UPSC current affairs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Feed = { name: string; url: string; kind: "central" | "regional" | "state" };

// PIB does not expose a single per-state URL scheme, but every Regional Office
// has a listing page. We link to the RSS/latest-press-release view where available
// and fall back to the office landing page. All URLs are stable pib.gov.in paths.
const CENTRAL: Feed[] = [
  { name: "Latest Press Releases (All Ministries)", url: "https://pib.gov.in/allRel.aspx", kind: "central" },
  { name: "Press Release Search", url: "https://pib.gov.in/Allrel.aspx", kind: "central" },
  { name: "Features & Backgrounders", url: "https://pib.gov.in/indexd.aspx", kind: "central" },
  { name: "Fact Check (PIB Fact Check Unit)", url: "https://pib.gov.in/factcheck.aspx", kind: "central" },
  { name: "Cabinet Decisions", url: "https://pib.gov.in/PressReleasePage.aspx?PRID=0", kind: "central" },
  { name: "Economic Survey & Budget", url: "https://pib.gov.in/indexd.aspx", kind: "central" },
];

// Regional PIB offices — one per state/UT cluster. These pages list the latest
// press releases issued from that office in English + local language.
const STATES: Feed[] = [
  { name: "Andhra Pradesh (Hyderabad RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=6", kind: "state" },
  { name: "Arunachal Pradesh (Itanagar RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=27", kind: "state" },
  { name: "Assam (Guwahati RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=8", kind: "state" },
  { name: "Bihar (Patna RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=19", kind: "state" },
  { name: "Chhattisgarh (Raipur RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=22", kind: "state" },
  { name: "Delhi (HQ)", url: "https://pib.gov.in/allRel.aspx", kind: "state" },
  { name: "Goa (Panaji RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=17", kind: "state" },
  { name: "Gujarat (Ahmedabad RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=1", kind: "state" },
  { name: "Haryana (Chandigarh RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=3", kind: "state" },
  { name: "Himachal Pradesh (Shimla RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=25", kind: "state" },
  { name: "Jammu & Kashmir (Srinagar/Jammu RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=24", kind: "state" },
  { name: "Jharkhand (Ranchi RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=21", kind: "state" },
  { name: "Karnataka (Bengaluru RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=7", kind: "state" },
  { name: "Kerala (Thiruvananthapuram RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=15", kind: "state" },
  { name: "Madhya Pradesh (Bhopal RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=2", kind: "state" },
  { name: "Maharashtra (Mumbai RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=16", kind: "state" },
  { name: "Manipur (Imphal RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=10", kind: "state" },
  { name: "Meghalaya (Shillong RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=23", kind: "state" },
  { name: "Mizoram (Aizawl RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=11", kind: "state" },
  { name: "Nagaland (Kohima RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=12", kind: "state" },
  { name: "Odisha (Bhubaneswar RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=18", kind: "state" },
  { name: "Punjab (Chandigarh RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=3", kind: "state" },
  { name: "Rajasthan (Jaipur RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=4", kind: "state" },
  { name: "Sikkim (Gangtok RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=26", kind: "state" },
  { name: "Tamil Nadu (Chennai RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=14", kind: "state" },
  { name: "Telangana (Hyderabad RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=6", kind: "state" },
  { name: "Tripura (Agartala RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=9", kind: "state" },
  { name: "Uttar Pradesh (Lucknow RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=20", kind: "state" },
  { name: "Uttarakhand (Dehradun RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=28", kind: "state" },
  { name: "West Bengal (Kolkata RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=13", kind: "state" },
  { name: "Andaman & Nicobar (Port Blair RO)", url: "https://pib.gov.in/Regionallist.aspx?Reg=29", kind: "state" },
  { name: "Chandigarh (UT)", url: "https://pib.gov.in/Regionallist.aspx?Reg=3", kind: "state" },
  { name: "Dadra & Nagar Haveli / Daman & Diu", url: "https://pib.gov.in/Regionallist.aspx?Reg=17", kind: "state" },
  { name: "Ladakh", url: "https://pib.gov.in/Regionallist.aspx?Reg=24", kind: "state" },
  { name: "Lakshadweep", url: "https://pib.gov.in/Regionallist.aspx?Reg=15", kind: "state" },
  { name: "Puducherry", url: "https://pib.gov.in/Regionallist.aspx?Reg=14", kind: "state" },
];

function buildDatedUrl(baseUrl: string, isoDate: string | null): string {
  if (!isoDate) return baseUrl;
  // PIB uses DD/MM/YYYY. We append as a hint parameter; the site itself renders
  // its latest release list, but the URL carries the user's intended digest date
  // so bookmarks + browser history stay meaningful.
  const [y, m, d] = isoDate.split("-");
  const pibDate = `${d}/${m}/${y}`;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}date=${encodeURIComponent(pibDate)}`;
}

function FeedCard({ f, isoDate, refreshKey }: { f: Feed; isoDate: string | null; refreshKey: number }) {
  const href = buildDatedUrl(f.url, isoDate);
  return (
    <a
      key={`${href}-${refreshKey}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-secondary"
    >
      <div>
        <p className="text-sm font-medium leading-snug">{f.name}</p>
        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          pib.gov.in · opens in new tab
        </p>
      </div>
      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </a>
  );
}

function PibHub() {
  const [q, setQ] = useState("");
  const [isoDate, setIsoDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [refreshKey, setRefreshKey] = useState(0);
  const states = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return STATES;
    return STATES.filter((s) => s.name.toLowerCase().includes(needle));
  }, [q]);


  return (
    <AppShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-accent" />
          <h1 className="font-serif text-3xl">PIB Daily Hub</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Direct links to the Press Information Bureau — the Government of India's official
          release wire. Read the source, then upload the day's cutting or a PIB PDF via
          <span className="font-medium text-foreground"> Upload</span> to let UNIE
          extract UPSC-relevant themes and MCQs.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-accent" />
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Digest date</label>
          <input
            type="date"
            value={isoDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setIsoDate(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => setIsoDate(new Date().toISOString().slice(0, 10))}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh digest
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-lg">Centre & Ministries</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CENTRAL.map((f) => (
            <FeedCard key={f.url + f.name} f={f} isoDate={isoDate} refreshKey={refreshKey} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg">States & Union Territories</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter state / UT…"
              className="w-56 rounded-md border border-input bg-card py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {states.map((f) => (
            <FeedCard key={f.name} f={f} isoDate={isoDate} refreshKey={refreshKey} />
          ))}
        </div>
        {states.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching office.</p>
        )}
      </section>


      <p className="mt-8 text-xs text-muted-foreground">
        Tip: save any PIB press release as PDF and upload it — UNIE will classify it
        into GS papers and generate Prelims-style MCQs using Groq + Gemini.
      </p>
    </AppShell>
  );
}
