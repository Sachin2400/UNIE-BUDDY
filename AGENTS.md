# UNIE Buddy — Project Instructions

> **UPSC Newspaper Analysis & MCQ Generator** — TanStack Start + Supabase + AI

## Development

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:8080)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- Supabase credentials (URL, anon key, service role key)
- AI API keys (Gemini, Groq — comma-separated for multi-key round-robin)

## Supabase

- Migrations in `supabase/migrations/` — apply via Dashboard SQL Editor or `supabase db push`
- Edge Function `process-queue` — deploy via `supabase functions deploy process-queue`
- Set `GEMINI_API_KEYS`, `GROQ_API_KEYS` in Function Settings

## Architecture

- **Frontend**: TanStack Start (React 19 + SSR), TanStack Router, TanStack Query
- **Styling**: Tailwind CSS v4, Radix UI
- **Auth/DB**: Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron)
- **AI**: Google Gemini + Groq (multi-key round-robin with token bucket)
- **OCR**: OCRmyPDF → Tesseract.js fallback
- **PDF**: jsPDF + pdf-parse
- **Upload**: tus-js-client (resumable)

## Security

- `.env`, `prompts.config.json` gitignored
- RLS on all tables
- Service role only in Edge Functions
- Input sanitization before AI calls

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/newspapers.functions.ts` | Main pipeline: OCR → AI → Queue |
| `src/lib/mcqs.functions.ts` | Adaptive MCQ generation + caching |
| `src/lib/ai/orchestrator.ts` | Provider routing, retries, circuit breaker |
| `supabase/functions/process-queue/` | Edge Function queue worker |

## Git Hygiene

- No secrets in commits — ever
- Run `npm run lint` and `npm run build` before push
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`