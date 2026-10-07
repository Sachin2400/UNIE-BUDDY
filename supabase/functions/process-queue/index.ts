// UNIE Buddy - Background Processing Edge Function
// Uses temperature: 0 for deterministic output

const SYSTEM_PROMPT = `You are UNIE-UPSC, an elite UPSC CSE analyst.
Extract only UPSC-relevant articles from newspaper text chunks.
Return STRICT JSON with an "articles" array.`;

const GEMINI_KEYS = (Deno.env.get("GEMINI_API_KEYS") || "").split(",").map(k => k.trim()).filter(Boolean);
const GROQ_KEYS = (Deno.env.get("GROQ_API_KEYS") || "").split(",").map(k => k.trim()).filter(Boolean);
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash-lite"];

let geminiIdx = 0, groqIdx = 0;
function nextGeminiKey() { const k = GEMINI_KEYS[geminiIdx % GEMINI_KEYS.length]; geminiIdx++; return k; }
function nextGroqKey() { const k = GROQ_KEYS[groqIdx % GROQ_KEYS.length]; groqIdx++; return k; }

async function withRetry<T>(fn: () => Promise<T>, max = 3, base = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, base * Math.pow(2, i))); }
  }
  throw lastErr;
}

async function callGemini(model: string, prompt: string, schema: any) {
  const key = nextGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const resp = await withRetry(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    return r;
  });
  return resp;
}

async function callGroq(prompt: string) {
  const key = nextGroqKey();
  const resp = await withRetry(async () => {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);
    return r;
  });
  return resp;
}

function parseArticles(raw: unknown): any[] {
  let parsed = raw;
  if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { return []; } }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).articles)) return [];
  return (parsed as any).articles;
}

async function processChunk(text: string, schema: any) {
  const prompt = `Analyse ONLY this newspaper text chunk. Return STRICT JSON with an "articles" array.\n\n${text}`;
  for (const model of GEMINI_MODELS) {
    try {
      const resp = await callGemini(model, prompt, schema);
      const json = await resp.json();
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) { const articles = parseArticles(raw); if (articles.length > 0) return { articles, provider: `gemini-${model}` }; }
    } catch (e) { console.warn(`Gemini ${model} failed:`, e); }
  }
  try {
    const resp = await callGroq(prompt);
    const json = await resp.json();
    const raw = json.choices?.[0]?.message?.content;
    if (raw) { const articles = parseArticles(raw); if (articles.length > 0) return { articles, provider: "groq" }; }
  } catch (e) { console.warn("Groq failed:", e); }
  return { articles: [], error: "All providers failed" };
}

// Main handler
Deno.serve(async (req) => {
  try {
    const { newspaperId, userId } = await req.json();
    console.log(`[EDGE] Processing newspaper ${newspaperId} for user ${userId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = await import(`https://esm.sh/@supabase/supabase-js@2`);
    const client = supabase.createClient(supabaseUrl, supabaseKey);

    // Fetch newspaper
    const { data: paper, error: fetchErr } = await client.from("newspapers").select("*").eq("id", newspaperId).eq("user_id", userId).single();
    if (fetchErr || !paper) return new Response(JSON.stringify({ error: "Newspaper not found" }), { status: 404 });

    // Update stage
    await client.from("newspapers").update({ processing_stage: "ai_analyzing" }).eq("id", newspaperId);

    // Get OCR text from articles table (already extracted)
    const { data: articles } = await client.from("articles").select("*").eq("newspaper_id", newspaperId).eq("user_id", userId);

    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ error: "No articles found" }), { status: 400 });
    }

    console.log(`[EDGE] Found ${articles.length} articles for newspaper ${newspaperId}`);

    // Mark complete
    await client.from("newspapers").update({ status: "completed", processing_stage: "completed", processed_at: new Date().toISOString() }).eq("id", newspaperId).eq("user_id", userId);

    return new Response(JSON.stringify({ success: true, articles: articles.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[EDGE ERROR]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500 });
  }
});