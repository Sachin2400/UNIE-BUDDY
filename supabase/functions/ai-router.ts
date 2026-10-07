/**
 * Multi-Key Round-Robin AI Provider Router
 * 
 * Distributes AI requests across multiple API keys to avoid rate limits.
 * Supports Gemini and Groq providers with automatic fallback.
 * 
 * Usage:
 *   const result = await aiRouter.callGemini(model, prompt);
 *   // Uses next available Gemini key in round-robin
 */

// ─── Configuration ───────────────────────────────────────────────
const GEMINI_KEYS = (Deno.env.get("GEMINI_API_KEYS") || "")
  .split(",")
  .map(k => k.trim())
  .filter(Boolean);

const GROQ_KEYS = (Deno.env.get("GROQ_API_KEYS") || "")
  .split(",")
  .map(k => k.trim())
  .filter(Boolean);

const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
];

const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3-coder-480b-a35b",
];

// ─── Round-Robin State ───────────────────────────────────────────
let geminiIndex = 0;
let groqIndex = 0;

function nextGeminiKey(): string {
  if (GEMINI_KEYS.length === 0) throw new Error("No Gemini keys configured");
  const key = GEMINI_KEYS[geminiIndex % GEMINI_KEYS.length];
  geminiIndex++;
  return key;
}

function nextGroqKey(): string {
  if (GROQ_KEYS.length === 0) throw new Error("No Groq keys configured");
  const key = GROQ_KEYS[groqIndex % GROQ_KEYS.length];
  groqIndex++;
  return key;
}

// ─── Retry Logic ─────────────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 2000
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[AI RETRY] Attempt ${attempt + 1}/${maxAttempts} failed. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  throw lastError;
}

// ─── AI Provider Functions ───────────────────────────────────────
async function callGemini(
  model: string,
  prompt: string,
  schema: any
): Promise<Response> {
  const key = nextGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Gemini HTTP ${response.status}: ${errorText.slice(0, 500)}`);
  }

  return response;
}

async function callGroq(
  prompt: string
): Promise<Response> {
  const key = nextGroqKey();
  const url = "https://api.groq.com/openai/v1/chat/completions";
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Groq HTTP ${response.status}: ${errorText.slice(0, 500)}`);
  }

  return response;
}

// ─── Chunk Processing ────────────────────────────────────────────
interface ChunkResult {
  chunkIndex: number;
  articles: any[];
  provider?: string;
  error?: string;
}

async function processChunk(
  text: string,
  chunkIndex: number,
  schema: any
): Promise<ChunkResult> {
  const prompt = `Analyse ONLY this newspaper text chunk. Return STRICT JSON with an "articles" array.\n\n${text}`;
  
  // Try Gemini first (with fallback to next model/key)
  for (const model of GEMINI_MODELS) {
    try {
      const response = await withRetry(() => callGemini(model, prompt, schema), 2, 1000);
      const json = await response.json();
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        const articles = parseAIArticles(raw);
        if (articles.length > 0) {
          return { chunkIndex, articles, provider: `gemini-${model}` };
        }
      }
    } catch (error) {
      console.warn(`[Gemini] Model ${model} failed:`, error);
      // Try next model
      continue;
    }
  }

  // Try Groq fallback
  for (const model of GROQ_MODELS) {
    try {
      const response = await withRetry(() => callGroq(prompt), 2, 1000);
      const json = await response.json();
      const raw = json.choices?.[0]?.message?.content;
      if (raw) {
        const articles = parseAIArticles(raw);
        if (articles.length > 0) {
          return { chunkIndex, articles, provider: `groq-${model}` };
        }
      }
    } catch (error) {
      console.warn(`[Groq] Model ${model} failed:`, error);
      continue;
    }
  }

  return { chunkIndex, articles: [], error: "All providers failed" };
}

// ─── Export for use in Edge Function ─────────────────────────────
export {
  callGemini,
  callGroq,
  processChunk,
  withRetry,
  GEMINI_KEYS,
  GROQ_KEYS,
};