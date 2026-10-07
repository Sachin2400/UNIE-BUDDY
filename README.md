# UNIE Buddy — UPSC Newspaper Analysis & MCQ Generator

> **Transform daily newspapers into structured UPSC prep material — articles, MCQs, and PDFs — automatically.**

---

## The Problem

UPSC aspirants face a daily grind:

| Pain Point | Reality |
|------------|---------|
| **Volume** | 15–20 pages of newspaper daily; only ~10% is UPSC-relevant |
| **Noise** | Politics, entertainment, sports, local crime — all distract from syllabus |
| **Static linkage** | News must be connected to Laxmikanth, Ramesh Singh, NCERT — manual effort |
| **Practice gap** | Reading ≠ retention. No auto-generated MCQs from today's paper |
| **Consistency** | Manual notes break down; hard to maintain daily discipline |
| **Cost/Scale** | Coaching institutes charge ₹15k–30k/month for "daily news analysis" |

**Result:** Aspirants either drown in noise, skip the newspaper, or pay for curated content they can't customize.

---

## The Solution: UNIE Buddy

Upload a newspaper PDF → get **structured articles**, **UPSC-style MCQs**, and **exportable PDFs** — in minutes.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Upload PDF │ ──▶ │  OCR + Text  │ ──▶ │  AI Extraction  │ ──▶ │  Articles +  │
│  (Hindi/Eng)│     │  Extraction  │     │  (Gemini/Groq)  │     │  MCQs + PDF  │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────────┘
```

### What You Get Per Upload

| Output | Description |
|--------|-------------|
| **Filtered Articles** | Only UPSC-relevant pieces — tagged by Subject, GS Paper, Topic, Relevance Score |
| **UPSC-Style MCQs** | 5 per article (configurable), ≥80% statement/assertion-reason/matching format |
| **Adaptive Difficulty** | Easy/Medium/Hard mix based on your past performance |
| **PDF Export** | Professional PDF with articles, MCQs, explanations — print or share |
| **Playground** | Interactive MCQ practice with instant feedback, explanations, progress tracking |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TANSTACK START (React + SSR)               │
├─────────────────────────────────────────────────────────────────┤
│  Upload (TUS resumable)  │  Articles/MCQs UI  │  Playground    │
├─────────────────────────────────────────────────────────────────┤
│                     SERVER FUNCTIONS (TanStack)                 │
│  processNewspaper → processNewspaperBackground → generateMcqs  │
├─────────────────────────────────────────────────────────────────┤
│                        SUPABASE                                 │
│  Auth + Postgres (RLS)  │  Storage (PDFs)  │  pg_cron + Queue  │
├─────────────────────────────────────────────────────────────────┤
│                      AI PROVIDERS                               │
│  Gemini (multi-key)  ◀──▶  Groq (multi-key)  ◀──▶  OpenRouter  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Technical Decisions

| Challenge | Solution |
|-----------|----------|
| **Rate limits** | Multi-key round-robin + token bucket + smart batching (10 chunks/call) |
| **Determinism** | `temperature: 0` everywhere; result caching (30-day TTL) |
| **OCR reliability** | Native text → OCRmyPDF → Tesseract fallback (graceful degradation) |
| **Multi-user isolation** | RLS on every table; `user_id` on all rows; atomic queue claim |
| **Background scaling** | Edge Function (no CPU timeout) + pg_cron (2-min) + queue worker |
| **Cost control** | Per-user monthly budget; tier-based MCQ caps |

---

## Quick Start

### Prerequisites
- Node.js 20+
- Supabase project (Postgres + Auth + Storage + Edge Functions)
- Gemini API key(s) — [Google AI Studio](https://makersuite.google.com/app/apikey)
- Groq API key(s) — [Groq Console](https://console.groq.com/keys)

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/unie-buddy.git
cd unie-buddy
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your keys
```

Required variables:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # for Edge Functions
GEMINI_API_KEYS=key1,key2,key3
GROQ_API_KEYS=key1,key2
```

### 3. Apply Migrations
In Supabase Dashboard → SQL Editor, run:
```sql
-- All files in supabase/migrations/ (already versioned)
```

### 4. Deploy Edge Function
```bash
npx supabase functions deploy process-queue
# Set GEMINI_API_KEYS, GROQ_API_KEYS in Function Settings
```

### 5. Run Locally
```bash
npm run dev
# Opens http://localhost:8080
```

---

## User Flow

1. **Sign up** (email/password via Supabase Auth)
2. **Upload** a newspaper PDF (drag-drop, resumable)
3. **Wait** — status updates in real-time: `pdf_downloading → ocr_running → ai_analyzing → mcq_generating → completed`
4. **Review** extracted articles (filter by subject, relevance)
5. **Practice** MCQs in Playground (adaptive, spaced-repetition ready)
6. **Export** PDF for offline revision

---

## Project Structure

```
├── src/
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── gemini.adapter.ts      # Gemini API client
│   │   │   ├── groq.adapter.ts        # Groq API client
│   │   │   ├── omniroute.adapter.ts   # Optional router
│   │   │   ├── prompts.ts             # Externalized prompt loader
│   │   │   └── ai-orchestrator.ts     # Provider routing, retries, circuit breaker
│   │   ├── mcqs.functions.ts          # Adaptive MCQ generation + caching
│   │   ├── newspapers.functions.ts    # Main pipeline: OCR → AI → Queue
│   │   └── pdf/newspaper-pdf.functions.ts  # jsPDF export
│   ├── routes/
│   │   ├── _authenticated/upload.tsx      # Upload UI + TUS
│   │   ├── _authenticated/articles.tsx    # Article list + filters
│   │   ├── _authenticated/playground.$newspaperId.tsx  # MCQ practice
│   │   └── ...
│   └── ...
├── supabase/
│   ├── functions/process-queue/     # Edge Function (queue worker)
│   └── migrations/                  # 15+ migrations (RLS, queue, cache, cron)
└── prompts.config.json              # AI prompts (gitignored)
```

---

## Security

- **No secrets in repo** — `.env`, `prompts.config.json` gitignored
- **RLS on all tables** — users only see their data
- **Service role only in Edge Function** — never exposed to client
- **API keys comma-separated** — rotate without redeploy
- **Input sanitization** — base64 image stripping before AI calls

---

## Roadmap

| Phase | Feature |
|-------|---------|
| **v1.1** | Spaced repetition (SM-2) + daily review dashboard |
| **v1.2** | Anki/CSV export + weekly compilation PDF |
| **v1.3** | Static syllabus mapper (Laxmikanth/NCERT chapter links) |
| **v2.0** | Mains answer-writing practice + model answers |
| **v2.1** | Email/Telegram daily digest |

---

## License

MIT — free for personal and commercial use.

---

## Contributing

1. Fork → feature branch → PR
2. Run `npm run lint` and `npm run build` before push
3. No secrets in PRs — ever

---

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Security**: Email maintainers directly

---

**Built for UPSC aspirants, by someone who's been there.**  
*Stop reading newspapers. Start studying them.*