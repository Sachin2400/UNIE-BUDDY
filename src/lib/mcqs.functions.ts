import { callOmniRoute } from "./ai/omniroute.adapter";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Strip base64 image data from prompts before sending to AI models.
 * Prevents "Cannot read image.png" errors when OCR text contains image data.
 */
function sanitizePromptText(text: string): string {
  return text
    .replace(/data:image\/[^;]+;base64,[^\s"')\]]+/g, '[IMAGE_DATA_REMOVED]')
    .replace(/image\.png/gi, '[IMAGE_REF]')
    .replace(/\.png/gi, '');
}

async function hashContent(parts: (string | number | null | undefined)[]) {
  const input = parts.map((p) => String(p ?? "")).join("|");
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}




const SYSTEM_PROMPT = `You are UNIE-Examiner, a senior UPSC Civil Services Examination (CSE) Question Setting expert.

Your task is to read a news article and create authentic, high-quality UPSC Prelims MCQs.

IMPORTANT RULES:

1. The news article is only a starting point. Test the underlying static concepts, constitutional provisions, laws, institutions, treaties, economic mechanisms, geography, environment, science, technology, or international relations.

2. Avoid trivial headline-based questions.

3. At least 80% of questions should use one of these UPSC-style formats:
   - Multi-statement questions
   - How many of the above
   - Assertion-Reason
   - Matching pairs

4. Use plausible UPSC-style distractors:
   - Ministry or institution swaps
   - Constitutional/statutory confusion
   - Centre-State jurisdiction confusion
   - Scope inversion
   - Subtle conceptual distortions

5. Every question must have exactly 4 options.

6. correct_index MUST be zero-based:
   - 0 = first option
   - 1 = second option
   - 2 = third option
   - 3 = fourth option

7. Difficulty must be exactly one of:
   - easy
   - medium
   - hard

8. Return ONLY valid JSON.
Do not use markdown.
Do not wrap the JSON in code fences.
Do not include commentary outside JSON.

THE OUTPUT MUST MATCH THIS EXACT STRUCTURE:

{
  "mcqs": [
    {
      "question": "Full UPSC Prelims question text",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "correct_index": 0,
      "explanation": "Clear explanation of why the correct answer is correct and why the important distractors are incorrect.",
      "difficulty": "medium",
      "topic": "Relevant UPSC topic"
    }
  ]
}
`;

const McqSchema = z.object({
  question: z.string().min(10),

  options: z
    .array(z.string().min(1))
    .length(4),

  correct_index: z
    .number()
    .int()
    .min(0)
    .max(3),

  explanation: z
    .string()
    .min(5)
    .nullable()
    .optional(),

  difficulty: z
    .enum([
      "easy",
      "medium",
      "hard",
    ])
    .nullable()
    .optional(),

  topic: z
    .string()
    .nullable()
    .optional(),
});

const ResponseSchema = z.object({
  mcqs: z.array(McqSchema),
});

type Mix = { easy: number; medium: number; hard: number };

function planDifficultyMix(accuracy: number | null, count: number): { mix: Mix; band: string; reasoning: string } {
  let easy = 0, medium = 0, hard = 0;
  let band = "balanced";
  let reasoning = "";
  if (accuracy == null) {
    medium = Math.round(count * 0.6);
    easy = Math.round(count * 0.2);
    hard = count - medium - easy;
    band = "baseline";
    reasoning = "No prior attempts on this article's topics — starting with a balanced mix skewed to medium to calibrate.";
  } else if (accuracy < 0.4) {
    easy = Math.round(count * 0.5);
    medium = Math.round(count * 0.4);
    hard = count - easy - medium;
    band = "struggling";
    reasoning = `Your accuracy on related topics is ${(accuracy * 100).toFixed(0)}% (<40%). Shifting toward easy/medium to reinforce fundamentals before stretching.`;
  } else if (accuracy < 0.7) {
    medium = Math.round(count * 0.6);
    easy = Math.round(count * 0.2);
    hard = count - easy - medium;
    band = "developing";
    reasoning = `Your accuracy is ${(accuracy * 100).toFixed(0)}% (40–70%). Holding medium-heavy with a small stretch to build consistency.`;
  } else {
    hard = Math.round(count * 0.5);
    medium = Math.round(count * 0.4);
    easy = count - medium - hard;
    band = "strong";
    reasoning = `Your accuracy is ${(accuracy * 100).toFixed(0)}% (≥70%). Pushing hard-heavy with static-linkage stretch questions.`;
  }
  return {
    mix: { easy: Math.max(0, easy), medium: Math.max(0, medium), hard: Math.max(0, hard) },
    band,
    reasoning,
  };
}


// Core MCQ-generation logic, extracted into a plain function so it can be
// called both from the HTTP-exposed generateMcqs server function AND
// directly from the newspaper-processing pipeline (to auto-generate MCQs
// right after articles are extracted, with no extra user click needed).

export async function generateMcqsForArticle(
  supabase: any,
  userId: string,
  articleId: string,
  count = 5,
) {

  const { data: article, error } = await supabase
    .from("articles")
    .select("id, title, content, summary, subject, topics, gs_paper")
    .eq("id", articleId)
    .eq("user_id", userId)
    .single();
  if (error || !article) throw new Error("Article not found");

    // ---- Cache lookup: reuse a previously generated set for identical (article content, count) ----
    const contentHash = await hashContent([article.id, article.content, article.title, count]);
    const { data: cachedSet } = await supabase
      .from("mcq_sets")
      .select("id, mcq_ids, adaptive, created_at")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .eq("count", count)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cachedSet && Array.isArray(cachedSet.mcq_ids) && cachedSet.mcq_ids.length > 0) {
      return {
        inserted: 0,
        cached: true,
        setId: cachedSet.id,
        adaptive: cachedSet.adaptive ?? null,
      };
    }

    // ---- Adaptive performance snapshot ----
    const articleTopics: string[] = article.topics ?? [];
    const [{ data: topicRows }, { data: subjectRows }, { data: overallRows }] = await Promise.all([
      articleTopics.length
        ? supabase
            .from("mcq_attempts")
            .select("topic, is_correct")
            .eq("user_id", userId)
            .in("topic", articleTopics)
        : Promise.resolve({ data: [] as { topic: string | null; is_correct: boolean }[] }),
      article.subject
        ? supabase
            .from("mcq_attempts")
            .select("is_correct")
            .eq("user_id", userId)
            .eq("subject", article.subject)
        : Promise.resolve({ data: [] as { is_correct: boolean }[] }),
      supabase
        .from("mcq_attempts")
        .select("is_correct")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const topicAgg = new Map<string, { total: number; correct: number }>();
    for (const r of topicRows ?? []) {
      if (!r.topic) continue;
      const cur = topicAgg.get(r.topic) ?? { total: 0, correct: 0 };
      cur.total++;
      if (r.is_correct) cur.correct++;
      topicAgg.set(r.topic, cur);
    }
    const topicStats = [...topicAgg.entries()]
      .map(([t, v]) => ({ topic: t, total: v.total, accuracy: v.correct / v.total }))
      .sort((a, b) => a.accuracy - b.accuracy);

    const subjectTotal = (subjectRows ?? []).length;
    const subjectCorrect = (subjectRows ?? []).filter(
  (r: { is_correct: boolean }) => r.is_correct,
).length;
    const subjectAcc = subjectTotal > 0 ? subjectCorrect / subjectTotal : null;

    const overallTotal = (overallRows ?? []).length;
    const overallCorrect = (overallRows ?? []).filter(
  (r: { is_correct: boolean }) => r.is_correct,
).length;
    const overallAcc = overallTotal > 0 ? overallCorrect / overallTotal : null;

    const anchorAcc =
      topicStats.length > 0
        ? topicStats.reduce((s, t) => s + t.accuracy, 0) / topicStats.length
        : subjectAcc ?? overallAcc;

    const plan = planDifficultyMix(anchorAcc, count);
    const mix = plan.mix;

    // Also skip past questions already answered on this article to reduce repeats
    const { data: seenRows } = await supabase
      .from("mcq_attempts")
      .select("mcq_id")
      .eq("user_id", userId)
      .eq("article_id", articleId);
    const seenCount = seenRows?.length ?? 0;

    const perfBlock = [
      `Overall recent accuracy: ${overallAcc == null ? "n/a" : (overallAcc * 100).toFixed(0) + "%"} (${overallTotal} attempts)`,
      `Subject "${article.subject ?? "n/a"}" accuracy: ${subjectAcc == null ? "n/a" : (subjectAcc * 100).toFixed(0) + "%"} (${subjectTotal})`,
      topicStats.length
        ? `Per-topic accuracy (weakest first):\n` +
          topicStats.map((t) => `  - ${t.topic}: ${(t.accuracy * 100).toFixed(0)}% (${t.total})`).join("\n")
        : `Per-topic accuracy: no prior attempts for this article's topics.`,
      seenCount > 0 ? `Already answered ${seenCount} MCQ(s) on this article — avoid duplicating phrasing.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = `Generate ${count} UPSC Prelims-style MCQs from the article below, ADAPTED to the learner.REMINDER: at least 80% of these must use the statement-based format (numbered statements + "which of the statements given above is/are correct?" with combination options like "1 only" / "2 and 3 only" / "All of the above" / "None of the above"), or assertion-reason, or matching-pairs format — as specified in your system instructions. Do NOT default to simple direct-recall questions ("What is X?", "Who launched Y?"). Vary which statement is the false/distractor one across questions so the pattern isn't predictable.

LEARNER PERFORMANCE:
${perfBlock}

REQUIRED DIFFICULTY MIX for this batch: ${mix.easy} easy, ${mix.medium} medium, ${mix.hard} hard.
When possible, weight questions toward the weakest topics listed above; if the learner is strong overall, add stretch questions that link the article to static UPSC concepts.

TITLE: ${sanitizePromptText(article.title)}
SUBJECT: ${article.subject ?? "n/a"} | GS: ${article.gs_paper ?? "n/a"}
TOPICS: ${articleTopics.join(", ") || "n/a"}

ARTICLE:
${sanitizePromptText(article.content)}

Return JSON: { "mcqs": [ { question, options[4], correct_index, explanation, difficulty, topic } ] }`;

    // Dual-provider: Groq (Llama 3.3 70B) and Gemini both generate; Gemini judges the best set.
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!groqKey && !geminiKey) throw new Error("Missing AI credentials (need GROQ_API_KEY and/or GEMINI_API_KEY)");

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];
const parseMcqsLenient = (
  raw: unknown,
): z.infer<typeof McqSchema>[] => {
  try {
    let parsed: unknown = raw;

    if (typeof raw === "string") {
      let cleaned = raw.trim();

      cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      parsed = JSON.parse(cleaned);
    }

    const result =
      ResponseSchema.safeParse(parsed);

    if (!result.success) {
      console.warn(
        "[MCQ PARSE ERROR] AI returned JSON but it does not match McqSchema:",
        JSON.stringify(
          result.error.flatten(),
          null,
          2,
        ),
      );

      return [];
    }

    if (result.data.mcqs.length === 0) {
      console.warn(
        "[MCQ PARSE WARNING] AI returned an empty MCQ array.",
      );
    }

    console.log(
      `[MCQ PARSE SUCCESS] Parsed ${result.data.mcqs.length} MCQ(s).`,
    );

    return result.data.mcqs;
  } catch (error) {
    console.warn(
      "[MCQ JSON PARSE ERROR]",
      error instanceof Error
        ? error.message
        : String(error),
    );

    return [];
  }
};
    const callGroq = async () => {
  if (!groqKey) {
    throw new Error(
      "GROQ_API_KEY is missing",
    );
  }

  console.log(
    "[MCQ GROQ] Starting request using model:",
    "openai/gpt-oss-120b",
  );

  const r = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${groqKey}`,
      },

      body: JSON.stringify({
        model: "openai/gpt-oss-120b",

        messages,

        response_format: {
          type: "json_object",
        },

        temperature: 0.6,
      }),
    },
  );

  if (!r.ok) {
    const errorText =
      await r.text().catch(
        () => "Unable to read Groq error",
      );

    console.error(
      "[MCQ GROQ HTTP ERROR]",
      {
        status: r.status,
        statusText: r.statusText,
        error: errorText.slice(0, 1000),
      },
    );

    throw new Error(
      `Groq HTTP ${r.status}: ${errorText.slice(0, 500)}`,
    );
  }

  const j = await r.json();

  const raw =
    j.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error(
      "Groq returned an empty response.",
    );
  }

  const parsed =
    parseMcqsLenient(raw);

  console.log(
    "[MCQ GROQ] Generated MCQs:",
    parsed.length,
  );

  return parsed;
};

    // Google deprecates Gemini model names/aliases quickly (gemini-2.0-flash,
    // then gemini-2.5-flash-lite, then gemini-2.5-flash all 404'd for new API
    // keys within months). Try candidates in order and fall through on 404.
    const GEMINI_MODEL_CANDIDATES = [
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-flash-latest",
];
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  requestFn: () => Promise<Response>,
  providerName: string,
): Promise<Response> => {
  const delays = [2000, 5000, 10000];

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await requestFn();

      if (response.ok) {
        return response;
      }

      lastResponse = response;

      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;

      if (!retryable || attempt === delays.length) {
        return response;
      }

      const delay = delays[attempt];

      console.warn(
        `[${providerName}] HTTP ${response.status}. ` +
          `Retrying in ${delay / 1000} seconds...`,
      );

      await sleep(delay);
    } catch (error) {
      if (attempt === delays.length) {
        throw error;
      }

      const delay = delays[attempt];

      console.warn(
        `[${providerName}] Network error. ` +
          `Retrying in ${delay / 1000} seconds...`,
        error,
      );

      await sleep(delay);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw new Error(`${providerName} request failed.`);
};
    const fetchGemini = async (body: unknown) => {
  let last: Response | null = null;

  for (const model of GEMINI_MODEL_CANDIDATES) {
    console.log(`[GEMINI] Trying model: ${model}`);

    const response = await fetchWithRetry(
      () =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
            },

            body: JSON.stringify(body),
          },
        ),

      `GEMINI ${model}`,
    );

    /*
     * Success
     */
    if (response.ok) {
      console.log(
        `[GEMINI] Success with model: ${model}`,
      );

      return response;
    }

    /*
     * Try another model if unavailable,
     * overloaded, or model does not exist.
     */
    if (
      response.status === 404 ||
      response.status === 429 ||
      response.status === 503
    ) {
      console.warn(
        `[GEMINI] Model ${model} unavailable. ` +
          `Status: ${response.status}. Trying next model...`,
      );

      last = response;

      continue;
    }

    return response;
  }

  return last ?? new Response(
    JSON.stringify({
      error: "No Gemini model was available.",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
};

   const callGemini = async () => {
  if (!geminiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing",
    );
  }

  console.log(
    "[MCQ GEMINI] Starting request...",
  );

  const r = await fetchGemini({
    systemInstruction: {
      parts: [
        {
          text: SYSTEM_PROMPT,
        },
      ],
    },

    contents: [
      {
        role: "user",

        parts: [
          {
            text: userPrompt,
          },
        ],
      },
    ],

    generationConfig: {
      responseMimeType:
        "application/json",

      temperature: 0.6,
    },
  });

  if (!r || !r.ok) {
    const status =
      r?.status ?? 0;

    const errorText = r
      ? await r.text().catch(
          () =>
            "Unable to read Gemini error",
        )
      : "No response from Gemini";

    console.error(
      "[MCQ GEMINI HTTP ERROR]",
      {
        status,
        error: errorText.slice(0, 1000),
      },
    );

    throw new Error(
      `Gemini HTTP ${status}: ${errorText.slice(0, 500)}`,
    );
  }

  const j = await r.json();

  const raw =
    j.candidates?.[0]
      ?.content?.parts?.[0]?.text;

  if (!raw) {
    console.error(
      "[MCQ GEMINI EMPTY RESPONSE]",
      JSON.stringify(j).slice(
        0,
        1000,
      ),
    );

    throw new Error(
      "Gemini returned an empty response.",
    );
  }

  const parsed =
    parseMcqsLenient(raw);

  console.log(
    "[MCQ GEMINI] Generated MCQs:",
    parsed.length,
  );

  return parsed;
};

       /*
     * Provider strategy:
     *
     * 1. Groq is the primary provider because it is currently verified
     *    and working with openai/gpt-oss-120b.
     *
     * 2. Gemini is used only as a fallback.
     *
     * This avoids sending duplicate MCQ generation requests to both
     * providers and reduces unnecessary rate-limit pressure.
     */

    let generatedMcqs: z.infer<typeof McqSchema>[] = [];
    let activeProvider = "";

    /*
     * PRIMARY PROVIDER: GROQ
     */
    if (groqKey) {
      try {
        console.log(
          "[MCQ AI] Attempting primary provider: Groq",
        );

        generatedMcqs = await callGroq();

        if (generatedMcqs.length > 0) {
          activeProvider = "groq";

          console.log(
            `[MCQ AI] Groq succeeded with ${generatedMcqs.length} MCQ(s).`,
          );
        } else {
          console.warn(
            "[MCQ AI] Groq returned zero valid MCQs. Falling back.",
          );
        }
      } catch (error) {
        console.error(
          "[MCQ AI] Groq failed:",
          error instanceof Error
            ? error.message
            : String(error),
        );
      }
    }

    /*
     * FALLBACK PROVIDER: GEMINI
     *
     * Only called when Groq failed or returned no valid MCQs.
     */
    if (
      generatedMcqs.length === 0 &&
      geminiKey
    ) {
      try {
        console.log(
          "[MCQ AI] Attempting fallback provider: Gemini",
        );

        generatedMcqs = await callGemini();

        if (generatedMcqs.length > 0) {
          activeProvider = "gemini";

          console.log(
            `[MCQ AI] Gemini succeeded with ${generatedMcqs.length} MCQ(s).`,
          );
        } else {
          console.warn(
            "[MCQ AI] Gemini returned zero valid MCQs.",
          );
        }
      } catch (error) {
        console.error(
          "[MCQ AI] Gemini fallback failed:",
          error instanceof Error
            ? error.message
            : String(error),
        );
      }
    }

    /*
     * FINAL FAILURE
     */
    if (generatedMcqs.length === 0) {
      throw new Error(
        "MCQ generation failed. Groq and Gemini did not return valid MCQs.",
      );
    }

    console.log(
      "[MCQ AI] Final provider:",
      activeProvider,
    );

    const groqMcqs =
      activeProvider === "groq"
        ? generatedMcqs
        : [];

    const geminiMcqs =
      activeProvider === "gemini"
        ? generatedMcqs
        : [];


    // Judge: use Gemini (or Groq if Gemini unavailable) to pick the top `count` most UPSC-Prelims-worthy MCQs.
    const pool = [
      ...groqMcqs.map((m, i) => ({ ...m, __src: "groq", __id: `G${i}` })),
      ...geminiMcqs.map((m, i) => ({ ...m, __src: "gemini", __id: `M${i}` })),
    ];

    let finalMcqs = pool as typeof pool;
    if (pool.length > count && (geminiKey || groqKey)) {
      const judgePrompt = `You are a senior UPSC Prelims examiner. From the candidate MCQs below (produced by two different AI models), select the ${count} BEST questions for UPSC Prelims — prioritise: (1) authentic UPSC statement-based/assertion-reason/matching format over plain direct-recall questions — strongly prefer the former when quality is comparable; (2) conceptual depth, static+current linkage, factual accuracy, plausible distractors; (3) coverage of the required difficulty mix (${mix.easy}E / ${mix.medium}M / ${mix.hard}H). 
${JSON.stringify(pool.map((m) => ({ id: m.__id, src: m.__src, question: m.question, options: m.options, correct_index: m.correct_index, difficulty: m.difficulty, topic: m.topic })))}`;

      try {
        let pickedIds: string[] = [];
        if (geminiKey) {
          const r = await fetchGemini({
            contents: [{ role: "user", parts: [{ text: judgePrompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
          });
          if (r.ok) {
            const j = await r.json();
            const raw = j.candidates?.[0]?.content?.parts?.[0]?.text;
            pickedIds = JSON.parse(raw ?? "{}").picked_ids ?? [];
          }
        }
        if (pickedIds.length === 0 && groqKey) {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({
              model: "openai/gpt-oss-120b",
              messages: [{ role: "user", content: judgePrompt }],
              response_format: { type: "json_object" },
              temperature: 0.1,
            }),
          });
          if (r.ok) {
            const j = await r.json();
            pickedIds = JSON.parse(j.choices?.[0]?.message?.content ?? "{}").picked_ids ?? [];
          }
        }
        if (pickedIds.length > 0) {
          const byId = new Map(pool.map((m) => [m.__id, m]));
          finalMcqs = pickedIds.map((id) => byId.get(id)).filter(Boolean) as typeof pool;
        }
      } catch {
        // judge failure → fall through to heuristic trim below
      }
    }

    // Fallback trim: interleave both sources up to `count`
    if (finalMcqs.length > count || finalMcqs === pool) {
      const interleaved: typeof pool = [];
      const g = [...groqMcqs.map((m, i) => ({ ...m, __src: "groq", __id: `G${i}` }))];
      const m = [...geminiMcqs.map((mm, i) => ({ ...mm, __src: "gemini", __id: `M${i}` }))];
      while (interleaved.length < count && (g.length || m.length)) {
        if (g.length) interleaved.push(g.shift()!);
        if (interleaved.length < count && m.length) interleaved.push(m.shift()!);
      }
      if (finalMcqs === pool) finalMcqs = interleaved;
      else finalMcqs = finalMcqs.slice(0, count);
    }

    const parsed = { mcqs: finalMcqs };


    const adaptive = {
      mix,
      anchorAcc,
      band: plan.band,
      reasoning: plan.reasoning,
      weakestTopics: topicStats.slice(0, 3).map((t) => ({ topic: t.topic, accuracy: t.accuracy, total: t.total })),
    };

    if (parsed.mcqs.length === 0) return { inserted: 0, cached: false, setId: null as string | null, adaptive };

    const rows = parsed.mcqs.map((m) => ({
      article_id: articleId,
      user_id: userId,
      question: m.question,
      options: m.options,
      correct_index: m.correct_index,
      explanation: m.explanation ?? null,
      difficulty: m.difficulty ?? null,
      topic: m.topic ?? null,
    }));
    const { data: insertedRows, error: insErr } = await supabase.from("mcqs").insert(rows).select("id");
    if (insErr) throw new Error(insErr.message);

    const { data: setRow } = await supabase
      .from("mcq_sets")
      .insert({
        user_id: userId,
        article_id: articleId,
        content_hash: contentHash,
        count,
        mcq_ids: (insertedRows ?? []).map((r: { id: string }) => r.id),
        adaptive,
      })
      .select("id")
      .single();

   return {
  inserted: rows.length,
  cached: false,
  setId: setRow?.id ?? null,
  adaptive,
};

} 
export const generateMcqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { articleId: string; count?: number }) => d)
  .handler(async ({ data, context }) => {
    const count = Math.min(Math.max(data.count ?? 5, 1), 10);

    return await generateMcqsForArticle(
      context.supabase,
      context.userId,
      data.articleId,
      count,
    );
    });


export const recordMcqAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { mcqId: string; pickedIndex: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mcq, error } = await supabase
      .from("mcqs")
      .select("id, article_id, correct_index, difficulty, topic")
      .eq("id", data.mcqId)
      .eq("user_id", userId)
      .single();
    if (error || !mcq) throw new Error("MCQ not found");

    const { data: article } = await supabase
      .from("articles")
      .select("subject")
      .eq("id", mcq.article_id)
      .eq("user_id", userId)
      .single();

    const is_correct = data.pickedIndex === mcq.correct_index;
    const { error: upErr } = await supabase.from("mcq_attempts").upsert(
      {
        user_id: userId,
        mcq_id: mcq.id,
        article_id: mcq.article_id,
        topic: mcq.topic,
        subject: article?.subject ?? null,
        difficulty: mcq.difficulty,
        picked_index: data.pickedIndex,
        is_correct,
      },
      { onConflict: "user_id,mcq_id" },
    );
    if (upErr) throw new Error(upErr.message);
    return { is_correct };
  });

export const resetAdaptiveDifficulty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { scope?: "all" | "subject" | "topic"; subject?: string; topic?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("mcq_attempts").delete({ count: "exact" }).eq("user_id", userId);
    if (data.scope === "subject" && data.subject) q = q.eq("subject", data.subject);
    else if (data.scope === "topic" && data.topic) q = q.eq("topic", data.topic);
    const { error, count } = await q;
    if (error) throw new Error(error.message);
    return { cleared: count ?? 0 };
  });
export const getNewspaperMcqPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { newspaperId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

      const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select(
        "id, title, subject, gs_paper, topics, upsc_relevance_score",
      )
      .eq("newspaper_id", data.newspaperId)
      .eq("user_id", userId);

    if (articlesError) {
      throw new Error(articlesError.message);
    }

    if (!articles || articles.length === 0) {
      return {
        newspaperId: data.newspaperId,
        articles: [],
        mcqs: [],
      };
    }
      const articleIds = articles.map((article) => article.id);

    const { data: mcqs, error: mcqsError } = await supabase
      .from("mcqs")
      .select(
        "id, article_id, question, options, correct_index, explanation, difficulty, topic, created_at",
      )
      .in("article_id", articleIds)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (mcqsError) {
      throw new Error(mcqsError.message);
    }
      const mcqIds = (mcqs ?? []).map((mcq) => mcq.id);

    const { data: attempts, error: attemptsError } = mcqIds.length
      ? await supabase
          .from("mcq_attempts")
          .select(
            "mcq_id, is_correct, picked_index, difficulty, subject, topic, created_at",
          )
          .in("mcq_id", mcqIds)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

    if (attemptsError) {
      throw new Error(attemptsError.message);
    }
      return {
        newspaperId: data.newspaperId,
        articles,
        mcqs: mcqs ?? [],
        attempts: attempts ?? [],
      };
  });