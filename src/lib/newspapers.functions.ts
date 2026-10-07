
import { callOmniRoute } from "./ai/omniroute.adapter";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { callGemini as callGeminiAdapter } from "./ai/gemini.adapter";
import { callGroq as callGroqAdapter } from "./ai/groq.adapter";



/**
 * Keep AI requests deliberately small.
 *
 * 8,000 characters is intentionally conservative so that:
 * - Gemini does not receive a giant request
 * - Groq does not receive a giant request
 *
 * - the application uses fewer tokens per request
 */
const MAX_AI_CHARS_PER_CHUNK = 8000;

/**
 * Maximum number of chunks processed in one request.
 * This protects the server from accidentally processing
 * an unexpectedly huge document forever.
 */
const MAX_CHUNKS_PER_NEWSPAPER = 80;

const SYSTEM_PROMPT = `
You are UNIE-UPSC, an elite UPSC Civil Services Examination (CSE) analyst, newspaper intelligence specialist, and dynamic-to-static syllabus mapper.

You analyse OCR-extracted text from Indian daily newspapers for UPSC CSE Prelims and Mains preparation.

You will receive ONE TEXT CHUNK from a newspaper. A chunk may contain:

- One complete article
- Multiple unrelated articles
- Partial articles
- Headlines
- Editorial content
- OCR errors
- Advertisements
- Noise

Your task is NOT to summarize everything.

Your task is to identify only genuinely useful UPSC-relevant news developments and convert them into structured learning material.

==================================================
1. CORE OBJECTIVE
==================================================

Extract only articles that can provide meaningful value for UPSC CSE preparation.

Prioritise:

- Constitutional developments
- Supreme Court and High Court judgments of national importance
- Parliament and legislative developments
- Government policies and schemes
- Governance and institutional reforms
- International Relations
- India's foreign policy
- Economy and public finance
- RBI, monetary policy and banking
- Agriculture and food security
- Environment and climate change
- Biodiversity and conservation
- Science and Technology
- Space and emerging technologies
- Defence and Internal Security
- Social Justice
- Health and Education policy
- International organisations
- Important reports and indices
- Historical, cultural or geographical significance
- Major global developments affecting India

==================================================
2. STRICT NOISE FILTER
==================================================

DO NOT extract articles primarily about:

- Party political arguments
- Election campaigning
- Political speeches without policy significance
- Personal attacks between politicians
- Routine political controversies
- Local crimes
- Individual criminal cases
- Routine bail hearings
- Local accidents
- Local fires
- Minor municipal issues
- Celebrity news
- Entertainment
- Sports results
- Routine business earnings
- Daily stock market movements
- Commodity prices
- Routine corporate appointments
- Advertisements
- Classified notices
- Tender notices
- Weather reports
- Obituaries unless nationally significant
- OCR garbage
- Duplicate headlines
- Fragmented text without meaningful context

IMPORTANT:

Do not reject an article merely because politicians are mentioned.

Extract it if the underlying development has significant implications for:

- Constitution
- Governance
- Public policy
- Economy
- International relations
- Environment
- National security
- UPSC syllabus

==================================================
3. UPSC RELEVANCE TEST
==================================================

Before extracting an article, evaluate it using these questions:

A. PRELIMS VALUE

Can this article help generate questions about:

- Constitutional provisions
- Acts and laws
- Government bodies
- International organisations
- Geography
- Environment
- Economy
- Science and technology
- Historical facts
- Important reports
- Institutions
- Treaties
- Species
- Places
- Government schemes?

B. MAINS VALUE

Does the article provide useful understanding of:

- Causes
- Consequences
- Challenges
- Constitutional issues
- Governance issues
- Economic implications
- Social implications
- Environmental implications
- Ethical issues
- Policy solutions?

C. STATIC LINKAGE

Can the current event be connected to an important static UPSC concept?

Examples:

News about Supreme Court
? Judicial Review
? Basic Structure Doctrine
? Separation of Powers

News about inflation
? Monetary Policy
? RBI tools
? Fiscal policy
? Demand-pull and cost-push inflation

News about climate summit
? UNFCCC
? Paris Agreement
? CBDR-RC
? Climate finance

A high-quality UPSC article should ideally have at least one strong dynamic-to-static connection.

==================================================
4. RELEVANCE SCORING
==================================================

Assign an UPSC relevance score from 0 to 100.

0�39:
Very low value.
Discard.

40�64:
Limited or narrow UPSC relevance.
Normally discard unless it contains a unique important factual development.

65�79:
Useful UPSC content.
Extract.

80�89:
High UPSC relevance.
Extract and prioritise.

90�100:
Exceptional UPSC relevance.
Major constitutional, economic, environmental, scientific, geopolitical or governance significance.

DO NOT artificially inflate scores.

Most ordinary articles should NOT receive scores above 80.

==================================================
5. ARTICLE EXTRACTION RULES
==================================================

A single text chunk may contain multiple articles.

Identify each article separately.

Do not merge unrelated news items.

Do not create an article from incomplete OCR fragments unless enough context exists to understand the development.

If an article continues from another page and the current chunk contains only incomplete information, extract it only if the available information is sufficient.

Correct obvious OCR errors internally when safe.

Examples of safe corrections:

- "Parliarnent" ? "Parliament"
- broken hyphenated words
- repeated OCR characters
- spacing errors

Do NOT invent missing facts.

==================================================
6. FACTUAL ACCURACY AND ANTI-HALLUCINATION RULES
==================================================

This is critical.

NEVER invent:

- Acts
- Constitutional Articles
- Dates
- Statistics
- Government schemes
- Court judgments
- International agreements
- Institutions
- Reports
- Committees
- Historical facts

If the OCR text is unclear, preserve uncertainty.

Do not fabricate information merely to make the article more useful.

Use your general UPSC knowledge only for reliable static context directly connected to the news development.

Do not add unrelated background information.

==================================================
7. DYNAMIC-TO-STATIC ANALYSIS
==================================================

For every extracted article:

1. Explain what happened.
2. Identify the UPSC subject.
3. Identify the relevant GS paper.
4. Identify important micro-topics.
5. Identify the static concepts connected to the news.
6. Highlight important factual information useful for Prelims.
7. Preserve analytical dimensions useful for Mains.

The extracted content should help a student understand:

CURRENT EVENT
        ?
WHY IT MATTERS
        ?
STATIC CONCEPT
        ?
PRELIMS FACTS
        ?
MAINS ANALYSIS

==================================================
8. SUBJECT CLASSIFICATION
==================================================

Choose the most appropriate primary subject from:

- Polity
- Governance
- Economy
- Environment
- Science & Technology
- International Relations
- Internal Security
- Social Justice
- History
- Geography
- Culture
- Agriculture
- Disaster Management
- Ethics

For GS Paper use:

- GS1
- GS2
- GS3
- GS4

If multiple papers are relevant, select the PRIMARY paper only.

==================================================
9. HOT TOPIC RULE
==================================================

Set is_hot_topic = true only when the development is likely to remain important for UPSC preparation for several weeks or months.

Examples:

- Major Supreme Court judgment
- Important Constitutional development
- Major Bill or Act
- Significant RBI decision
- Major international summit or treaty
- Important environmental crisis
- Major scientific breakthrough
- Significant India-China / India-US / India-neighbour relations development
- Major government policy reform

Routine news should have:

is_hot_topic = false

Do not overuse hot topics.

==================================================
10. CONTENT QUALITY REQUIREMENT
==================================================

The content field must NOT simply copy OCR text.

Rewrite the article into a clean, accurate, concise UPSC-oriented explanation.

The explanation should include:

- What happened
- Important context
- Why it matters
- Relevant institutions or concepts
- Static UPSC linkage where useful

Avoid unnecessary newspaper-style storytelling.

Focus on understanding.

==================================================
11. TOPIC EXTRACTION
==================================================

Generate 2 to 6 precise topics.

Good examples:

- Judicial Review
- Monetary Policy
- Inflation
- Carbon Markets
- India-Maldives Relations
- Parliamentary Privileges
- Biodiversity Conservation
- Artificial Intelligence Regulation

Avoid vague topics such as:

- Important News
- Current Affairs
- Government
- India

==================================================
12. OUTPUT FORMAT
==================================================

Return STRICTLY valid JSON.

Return exactly this structure:

{
  "articles": [
    {
      "title": "Clear refined article title",

      "content": "Clean UPSC-oriented explanation of the news development with relevant context and static linkage.",

      "summary": "Concise summary of the article.",

      "subject": "Primary UPSC subject",

      "topics": [
        "Topic 1",
        "Topic 2"
      ],

      "gs_paper": "GS1 | GS2 | GS3 | GS4",

      "upsc_relevance_score": 0,

      "upsc_reasoning": "Brief explanation of why this article is relevant or not relevant for UPSC.",

      "is_hot_topic": false,

      "page_number": 0
    }
  ]
}

==================================================
13. EMPTY RESULT RULE
==================================================

If the chunk contains no UPSC-relevant article, return:

{
  "articles": []
}

Never return a separate DISCARD object.

Never return null.

Never return plain text.

==================================================
14. FINAL OUTPUT RULES
==================================================

- Return JSON only.
- No markdown.
- No explanation outside JSON.
- No code fences.
- No comments.
- No trailing commas.
- Ensure valid JSON syntax.
- Never invent facts.
- Prioritise accuracy over quantity.
- Prioritise UPSC syllabus relevance over general news relevance.
- Extract fewer articles rather than low-quality articles.
`;

const ArticleSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  summary: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  gs_paper: z
    .union([
      z.literal("GS1"),
      z.literal("GS2"),
      z.literal("GS3"),
      z.literal("GS4"),
      z.null(),
    ])
    .optional(),
  upsc_relevance_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .catch(50),
  upsc_reasoning: z.string().nullable().optional(),
  is_hot_topic: z.boolean().default(false),
  page_number: z.number().int().nullable().optional(),
});

const GEMINI_MODEL_CANDIDATES = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
];

type ParsedArticle = z.infer<typeof ArticleSchema>;

function chunkText(
  text: string,
  maxChars = MAX_AI_CHARS_PER_CHUNK,
): string[] {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  /*
   * Newspaper OCR often contains:
   *
   * - page breaks
   * - article headings
   * - short paragraphs
   * - column fragments
   *
   * We therefore prefer paragraph boundaries instead of
   * blindly cutting every N characters.
   */

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) =>
      part
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  /*
   * Small overlap between chunks helps when an article is
   * divided exactly at a chunk boundary.
   *
   * Keep this small so we do not unnecessarily increase
   * token usage.
   */
  const overlapChars = Math.min(
    500,
    Math.floor(maxChars * 0.06),
  );

  const pushChunk = (value: string) => {
    const chunk = value.trim();

    if (!chunk) {
      return;
    }

    chunks.push(chunk);
  };

  for (const paragraph of paragraphs) {
    /*
     * If one OCR paragraph is larger than the maximum,
     * split it at sentence boundaries where possible.
     */

    if (paragraph.length > maxChars) {
      if (current) {
        pushChunk(current);
        current = "";
      }

      let remaining = paragraph;

      while (remaining.length > maxChars) {
        let cut = maxChars;

        /*
         * Prefer a sentence boundary near the maximum size.
         */
        const searchStart = Math.max(
          0,
          maxChars - 1200,
        );

        const candidate = remaining.slice(
          searchStart,
          maxChars,
        );

        const sentenceMatches = [
          ...candidate.matchAll(/[.!?](?=\s)/g),
        ];

        if (sentenceMatches.length > 0) {
          const lastMatch =
            sentenceMatches[sentenceMatches.length - 1];

          cut =
            searchStart +
            (lastMatch.index ?? 0) +
            1;
        } else {
          /*
           * If no sentence boundary exists, prefer the last
           * whitespace before the limit.
           */
          const whitespaceCut =
            remaining.lastIndexOf(
              " ",
              maxChars,
            );

          if (whitespaceCut > maxChars * 0.7) {
            cut = whitespaceCut;
          }
        }

        const piece = remaining
          .slice(0, cut)
          .trim();

        pushChunk(piece);

        /*
         * Preserve a small tail of the previous section so
         * an article crossing the boundary retains context.
         */
        const overlap =
          piece.slice(-overlapChars).trim();

        remaining = remaining
          .slice(cut)
          .trim();

        if (overlap && remaining) {
          remaining = `${overlap} ${remaining}`;
        }
      }

      if (remaining) {
        current = remaining;
      }

      continue;
    }

    /*
     * Add the next paragraph to the current chunk whenever
     * it still fits.
     */
    const candidate = current
      ? `${current}\n\n${paragraph}`
      : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    /*
     * Current chunk is full enough.
     */
    if (current) {
      pushChunk(current);

      /*
       * Carry a small context tail into the next chunk.
       */
      const overlap = current
        .slice(-overlapChars)
        .trim();

      current = overlap
        ? `${overlap}\n\n${paragraph}`
        : paragraph;
    } else {
      current = paragraph;
    }

    /*
     * Safety guard: if overlap + paragraph itself is too large,
     * process it on the next iteration using the large-paragraph
     * handling above.
     */
    if (current.length > maxChars) {
      const oversized = current;
      current = "";

      for (
        let start = 0;
        start < oversized.length;
        start += maxChars
      ) {
        pushChunk(
          oversized.slice(
            start,
            start + maxChars,
          ),
        );
      }
    }
  }

  if (current) {
    pushChunk(current);
  }

  return chunks;
}
function cleanArticleTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/[|?]+/g, " ")
    .trim();
}

function normalizeTitle(title: string): string {
  return cleanArticleTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove obvious duplicates caused by chunk boundaries.
 *
 * Example:
 * chunk 1 contains first half of an article
 * chunk 2 contains continuation of same article
 *
 * We use title similarity conservatively so genuinely different articles
 * aren't accidentally removed.
 */
function deduplicateArticles(
  articles: ParsedArticle[],
): ParsedArticle[] {
  const unique: ParsedArticle[] = [];
  const seenTitles = new Set<string>();

  for (const article of articles) {
    const title = cleanArticleTitle(article.title);

    if (!title) {
      continue;
    }

    const normalized = normalizeTitle(title);

    if (!normalized) {
      continue;
    }

    if (seenTitles.has(normalized)) {
      continue;
    }

    seenTitles.add(normalized);

    unique.push({
      ...article,
      title,
    });
  }

  return unique;
}

function parseAIArticles(raw: unknown): ParsedArticle[] {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { articles?: unknown[] }).articles)
  ) {
    return [];
  }

  const rawArticles = (parsed as { articles: unknown[] }).articles;

  return rawArticles
    .map((article) => ArticleSchema.safeParse(article))
    .filter(
      (
        result,
      ): result is z.SafeParseSuccess<ParsedArticle> =>
        result.success,
    )
    .map((result) => result.data);
}

export const processNewspaper = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator((d: { newspaperId: string }) => d)
  .handler(async ({ data, context }) => {
    const { newspaperId } = data;
    const { supabase, userId } = context;
    console.log(
      `[NEWSPAPER] Queueing newspaper for processing: ${newspaperId}`,
    );

    const { data: paper, error: fetchErr } = await supabase
      .from("newspapers")
      .select("*")
      .eq("id", newspaperId)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !paper) {
      throw new Error("Newspaper not found");
    }

    // Mark as accepted and enqueue
    await supabase
      .from("newspapers")
      .update({
        status: "accepted",
        processing_stage: "queued",
        error_message: null,
      })
      .eq("id", newspaperId);

    // Insert into processing queue
    const { error: queueErr } = await supabase
      .from("processing_queue")
      .insert({
        newspaper_id: newspaperId,
        user_id: userId,
        status: "waiting",
        priority: 0,
      });

    if (queueErr) {
      console.error("[QUEUE] Failed to enqueue:", queueErr);
      // Fallback: fire-and-forget (old behavior)
      processNewspaperBackground(newspaperId, userId, supabase).catch(async (error) => {
        console.error(`[NEWSPAPER] Background processing failed for ${newspaperId}:`, error);
        await supabase
          .from("newspapers")
          .update({
            status: "failed",
            processing_stage: "failed",
            error_message: error instanceof Error ? error.message : "Background processing failed",
          })
          .eq("id", newspaperId);
      });
    } else {
      console.log(`[QUEUE] Enqueued newspaper ${newspaperId}`);
    }

    return { status: "accepted", message: "Processing queued" };
  });

/**
 * Queue worker - processes next waiting job
 * Call this via cron, scheduled function, or manually
 */
export const processQueueWorker = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const workerId = `worker-${userId}-${Date.now()}`;

    console.log(`[QUEUE WORKER] ${workerId} claiming next job...`);

    // Claim next waiting job atomically
    const { data: job, error: claimErr } = await supabase.rpc("claim_next_queue_job", {
      worker_id: workerId,
    });

    if (claimErr) {
      console.error("[QUEUE WORKER] Claim error:", claimErr);
      return { status: "error", message: claimErr.message };
    }

    if (!job || job.length === 0) {
      console.log(`[QUEUE WORKER] No waiting jobs`);
      return { status: "idle", message: "No jobs in queue" };
    }

    const jobData = job[0];
    console.log(`[QUEUE WORKER] Claimed job ${jobData.id} for newspaper ${jobData.newspaper_id}`);

    try {
      // Run background processing
      await processNewspaperBackground(jobData.newspaper_id, jobData.user_id, supabase);

      // Mark queue job done
      await supabase.rpc("finish_queue_job", {
        job_id: jobData.id,
        success: true,
      });

      console.log(`[QUEUE WORKER] Job ${jobData.id} completed`);
      return { status: "done", newspaperId: jobData.newspaper_id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed";
      console.error(`[QUEUE WORKER] Job ${jobData.id} failed:`, message);

      // Mark queue job failed
      await supabase.rpc("finish_queue_job", {
        job_id: jobData.id,
        success: false,
        err_msg: message,
      });

      // Also mark newspaper as failed
      await supabase
        .from("newspapers")
        .update({
          status: "failed",
          processing_stage: "failed",
          error_message: message,
        })
        .eq("id", jobData.newspaper_id);

      return { status: "failed", newspaperId: jobData.newspaper_id, error: message };
    }
  });

/**
 * Background processing function - runs asynchronously
 * Updates processing_stage in real-time for UI polling
 */
async function processNewspaperBackground(
  newspaperId: string,
  userId: string,
  supabase: any
) {
  const { generateMcqsForArticle } = await import("./mcqs.functions");
  
  console.log(
    `[NEWSPAPER BG] Starting background processing for newspaper: ${newspaperId}`,
  );

  // Update stage: downloading PDF
  await supabase
    .from("newspapers")
    .update({ status: "processing", processing_stage: "pdf_downloading" })
    .eq("id", newspaperId);

  const { data: paper, error: fetchErr } = await supabase
    .from("newspapers")
    .select("*")
    .eq("id", newspaperId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !paper) {
    throw new Error("Newspaper not found");
  }

  // Update stage: downloading PDF
  await supabase
    .from("newspapers")
    .update({ processing_stage: "pdf_downloading" })
    .eq("id", newspaperId);

  const { data: signed, error: signErr } = await supabase.storage
    .from("newspapers")
    .createSignedUrl(paper.storage_path, 900);

  if (signErr || !signed?.signedUrl) {
    console.error(
      "[NEWSPAPER BG] Storage signed URL error:",
      signErr,
    );
    console.error(
      "[NEWSPAPER BG] Storage path:",
      paper.storage_path,
    );
    throw new Error(
      `Could not read PDF from storage: ${
        signErr?.message ?? "Signed URL was not created"
      }`,
    );
  }

  let pdfRes: Response | null = null;
  let lastFetchErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      pdfRes = await fetch(signed.signedUrl);
      if (pdfRes.ok) break;
    } catch (error) {
      lastFetchErr = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }

  if (!pdfRes?.ok) {
    throw new Error(
      `Failed to download PDF after 3 attempts${
        lastFetchErr instanceof Error ? `: ${lastFetchErr.message}` : ""
      }`,
    );
  }

  const arrayBuf = await pdfRes.arrayBuffer();
  const buf = new Uint8Array(arrayBuf);

  if (buf.length < 5) {
    throw new Error("Uploaded file is empty or invalid.");
  }

  const pdfHeader = new TextDecoder().decode(buf.subarray(0, 5));
  if (pdfHeader !== "%PDF-") {
    throw new Error("The uploaded file is not a valid PDF.");
  }

  // Update stage: OCR running
  await supabase
    .from("newspapers")
    .update({ processing_stage: "ocr_running" })
    .eq("id", newspaperId);

  const runOcrMyPdf = (inputBuf: Uint8Array): Promise<Uint8Array | null> =>
    new Promise((resolve) => {
      const tmpIn = join(tmpdir(), `unie-${randomUUID()}-input.pdf`);
      const tmpOut = join(tmpdir(), `unie-${randomUUID()}-ocr.pdf`);

      writeFile(tmpIn, inputBuf)
        .then(() => {
          const args = [
            "--force-ocr",
            "--deskew",
            "--rotate-pages",
            "--output-type",
            "pdf",
            "--optimize",
            "0",
            tmpIn,
            tmpOut,
          ];

          const proc = spawn("ocrmypdf", args);
          let stderr = "";

          proc.stderr?.on("data", (data) => { stderr += data.toString(); });
          proc.stdout?.on("data", () => {});

          proc.on("error", async () => {
            await unlink(tmpIn).catch(() => {});
            await unlink(tmpOut).catch(() => {});
            resolve(null);
          });

          proc.on("close", async (code) => {
            try {
              if (code !== 0) {
                console.error("OCRmyPDF failed:", stderr.slice(0, 2000));
                resolve(null);
                return;
              }
              const output = await readFile(tmpOut);
              resolve(new Uint8Array(output));
            } catch (error) {
              console.error("Could not read OCR output:", error);
              resolve(null);
            } finally {
              await unlink(tmpIn).catch(() => {});
              await unlink(tmpOut).catch(() => {});
            }
          });
        })
        .catch(async (error) => {
          console.error("Could not start OCRmyPDF:", error);
          await unlink(tmpIn).catch(() => {});
          await unlink(tmpOut).catch(() => {});
          resolve(null);
        });
    });

  const MIN_USABLE_TEXT = 200;

  /*
   * STEP 1 — Native text extraction.
   *
   * Most newspaper PDFs are born-digital (exported from InDesign/Word) and
   * already carry an embedded text layer. Extracting it is near-instant and
   * yields far cleaner text than rasterising + OCR, so it must be tried
   * FIRST. Previously we went straight to OCRmyPDF, which needlessly
   * rasterised every page of a digital PDF and produced low-confidence
   * garbage that then triggered an expensive Tesseract fallback.
   */
  let ocrText = "";
  try {
    const nativeParser = new PDFParse({ data: buf });
    const nativeResult = await nativeParser.getText();
    ocrText = (nativeResult.text ?? "").trim();
    console.log(
      `Native PDF text layer: ${ocrText.length.toLocaleString()} characters.`,
    );
  } catch (error) {
    console.error("Native PDF text extraction failed:", error);
  }

  /*
   * STEP 2 — OCRmyPDF, only when there is no usable text layer
   * (i.e. a genuinely scanned/image-only PDF).
   */
  if (ocrText.length < MIN_USABLE_TEXT) {
    console.log(
      "No usable text layer detected. Running OCRmyPDF (scanned PDF path).",
    );
    const ocrPdf = await runOcrMyPdf(buf);

    if (ocrPdf) {
      try {
        const ocrParser = new PDFParse({ data: ocrPdf });
        const ocrResult = await ocrParser.getText();
        ocrText = (ocrResult.text ?? "").trim();
        console.log(
          `OCRmyPDF text: ${ocrText.length.toLocaleString()} characters.`,
        );
      } catch (error) {
        console.error("Failed to extract text from OCR PDF:", error);
      }
    }
  }

  /*
   * STEP 3 — Tesseract.js last resort.
   *
   * Tesseract lazily downloads `eng.traineddata` from a CDN. When that
   * download fails it throws from inside a worker tick, which is an
   * *uncaught* exception that terminates the whole Node process — taking
   * every other in-flight job down with it. Creating the worker is therefore
   * wrapped so a network failure degrades to "no OCR" instead of a crash.
   */
  if (ocrText.length < MIN_USABLE_TEXT) {
    console.log(
      "OCRmyPDF returned insufficient text. Falling back to Tesseract.js.",
    );

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker("eng");
    } catch (workerError) {
      console.error(
        "Tesseract worker could not start (language data download failed):",
        workerError,
      );
    }

    if (worker) {
      try {
        const parser = new PDFParse({ data: buf });
        const screenshots = await parser.getScreenshot();
        const pageTexts: string[] = [];

        for (const page of screenshots.pages) {
          try {
            const result = await worker.recognize(page.dataUrl);
            pageTexts.push(result.data.text ?? "");
          } catch (pageError) {
            console.error("Tesseract failed on one page:", pageError);
          }
        }
        ocrText = pageTexts.join("\n\n").trim();
      } catch (tesseractError) {
        console.error("Tesseract.js OCR pass failed:", tesseractError);
      } finally {
        await worker.terminate().catch(() => {});
      }
    }
  }

  if (ocrText.length < MIN_USABLE_TEXT) {
    throw new Error(
      "OCR completed, but no usable newspaper text was extracted. " +
        "If this is a scanned PDF, the Tesseract language data could not be " +
        "downloaded — check outbound network access to the Tesseract CDN.",
    );
  }

  console.log(`OCR complete: ${ocrText.length.toLocaleString()} characters extracted.`);

  // Strip base64 image data from OCR text before sending to AI
  const sanitizeOcrText = (text: string): string => {
    return text
      .replace(/data:image\/[^;]+;base64,[^\s"')\]]+/g, '[IMAGE_DATA_REMOVED]')
      .replace(/image\.png/gi, '[IMAGE_REF]')
      .replace(/\.png/gi, '');
  };
  ocrText = sanitizeOcrText(ocrText);

  // Update stage: AI analyzing
  await supabase
    .from("newspapers")
    .update({ processing_stage: "ai_analyzing" })
    .eq("id", newspaperId);

  const textChunks = chunkText(ocrText);
  if (textChunks.length === 0) {
    throw new Error("No analysable newspaper text was found after OCR.");
  }
  if (textChunks.length > MAX_CHUNKS_PER_NEWSPAPER) {
    throw new Error(`This newspaper is too large to process safely. OCR produced ${textChunks.length} chunks.`);
  }

  console.log(`OCR text split into ${textChunks.length} AI chunks.`);

  // AI Credentials - support multiple keys via comma-separated env vars
  const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
  const groqKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
  const omnirouteUrl = process.env.OMNIROUTE_URL?.trim();

  // Disable OmniRoute - it's causing image input errors and is not properly configured
  const useOmniRoute = false;

  if (geminiKeys.length === 0 && groqKeys.length === 0 && !useOmniRoute) {
    throw new Error("Missing AI credentials. Configure GEMINI_API_KEYS or GROQ_API_KEYS.");
  }

  // Schema for structured output
  const schema = {
    type: "object",
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          required: [
            "title",
            "content",
            "topics",
            "upsc_relevance_score",
            "is_hot_topic",
          ],
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            summary: { type: "string" },
            subject: { type: "string" },
            topics: { type: "array", items: { type: "string" } },
            gs_paper: { type: "string", enum: ["GS1", "GS2", "GS3", "GS4"] },
            upsc_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
            upsc_reasoning: { type: "string" },
            is_hot_topic: { type: "boolean" },
            page_number: { type: "integer" },
          },
        },
      },
    },
    required: ["articles"],
  };

  // Retry helper with exponential backoff + jitter
  const withRetry = async (fn: () => Promise<Response>): Promise<Response> => {
    const delays = [3_000, 8_000, 15_000];

    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        const response = await fn();

        if (response.ok) {
          return response;
        }

        const retryable =
          response.status === 408 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (!retryable) {
          return response;
        }

        if (attempt === delays.length - 1) {
          return response;
        }

        let delay = delays[attempt];

        const retryAfter = response.headers.get("retry-after");

        if (retryAfter) {
          const retryAfterSeconds = Number(retryAfter);

          if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            delay = Math.max(delay, Math.min(retryAfterSeconds * 1000, 60_000));
          } else {
            const retryAfterDate = Date.parse(retryAfter);

            if (Number.isFinite(retryAfterDate)) {
              const dateDelay = retryAfterDate - Date.now();

              if (dateDelay > 0) {
                delay = Math.max(delay, Math.min(dateDelay, 60_000));
              }
            }
          }
        }

        const jitter = Math.floor(Math.random() * 1_000);
        delay += jitter;

        console.warn(
          `[AI RETRY] HTTP ${response.status}. ` +
            `Retrying in ${Math.ceil(delay / 1000)} seconds ` +
            `(${attempt + 1}/${delays.length})...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "Unknown";
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.warn("[AI NETWORK ERROR]", {
          attempt: attempt + 1,
          totalAttempts: delays.length,
          name: errorName,
          message: errorMessage,
          cause: error instanceof Error ? error.cause : undefined,
        });

        if (attempt === delays.length - 1) {
          return new Response(
            JSON.stringify({
              error: `AI network failure after ${delays.length} attempts: ${errorMessage}`,
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        const delay = delays[attempt] + Math.floor(Math.random() * 1_000);

        console.warn(
          `[AI NETWORK RETRY] ` +
            `Retrying in ${Math.ceil(delay / 1000)} seconds ` +
            `(${attempt + 2}/${delays.length})...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return new Response(
      JSON.stringify({ error: "AI request failed after all retries." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  };

  // Round-robin key selection for multi-key support
  let geminiKeyIndex = 0;
  let groqKeyIndex = 0;

  function nextGeminiKey(): string {
    if (geminiKeys.length === 0) throw new Error("No Gemini keys configured");
    const key = geminiKeys[geminiKeyIndex % geminiKeys.length];
    geminiKeyIndex++;
    return key;
  }

  function nextGroqKey(): string {
    if (groqKeys.length === 0) throw new Error("No Groq keys configured");
    const key = groqKeys[groqKeyIndex % groqKeys.length];
    groqKeyIndex++;
    return key;
  }

  // AI provider functions
  // Strip base64 image data from prompts before sending to AI models
  const sanitizePromptText = (text: string): string => {
    return text
      .replace(/data:image\/[^;]+;base64,[^\s"')\]]+/g, '[IMAGE_DATA_REMOVED]')
      .replace(/image\.png/gi, '[IMAGE_REF]')
      .replace(/\.png/gi, '');
  };

  const callGemini = async (model: string, text: string): Promise<Response> => {
    const key = nextGeminiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Analyse ONLY this newspaper text chunk.\n\nDo not assume information that is not contained in this chunk.\n\nReturn STRICT JSON with an "articles" array.\n\nNEWSPAPER CHUNK:\n\n${sanitizePromptText(text)}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1 },
      }),
    });
  };

  const callGroq = async (text: string): Promise<Response> => {
    const key = nextGroqKey();
    return fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analyse ONLY this newspaper text chunk.\n\nDo not assume information that is not contained in this chunk.\n\nReturn JSON with an "articles" array.\n\nNEWSPAPER CHUNK:\n\n${sanitizePromptText(text)}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });
  };

  const callOmniRouteWithRetry = async (text: string): Promise<Response> => {
    return withRetry(async () => {
      const result = await callOmniRoute({
        task: "newspaper-analysis",
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: text,
      });
      return new Response(result.content, { status: 200, headers: { "Content-Type": "application/json" } });
    });
  };

  // Simple semaphore for concurrency control
  class Semaphore {
    private permits: number;
    private waitQueue: Array<() => void> = [];

    constructor(permits: number) {
      this.permits = permits;
    }

    async acquire(): Promise<void> {
      if (this.permits > 0) {
        this.permits--;
        return;
      }
      return new Promise((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    release(): void {
      this.permits++;
      const next = this.waitQueue.shift();
      if (next) {
        this.permits--;
        next();
      }
    }
  }

  // Concurrency limiter: max 4 parallel AI calls
  const aiSemaphore = new Semaphore(4);

  const processChunkWithAI = async (text: string): Promise<{
    response: Response | null;
    provider: "gemini" | "groq" | "omniroute" | null;
    failureReason?: string;
  }> => {
    await aiSemaphore.acquire();
    try {
      // Try Gemini first (using round-robin keys)
      if (geminiKeys.length > 0) {
        console.log(`[AI PROVIDER] Trying Gemini`);
        for (const model of GEMINI_MODEL_CANDIDATES) {
          let response: Response;
          try {
            response = await withRetry(() => callGemini(model, text));
          } catch (error) {
            console.error(`Gemini network failure for model ${model}:`, error);
            continue;
          }

          if (response.ok) {
            return { response, provider: "gemini" };
          }

          if (response.status === 404) continue;
          if (response.status === 429 || response.status === 503) break;
          break;
        }
      }

      // Try Groq (using round-robin keys)
      if (groqKeys.length > 0) {
        console.log(`[AI PROVIDER] Trying Groq`);
        let response: Response;
        try {
          response = await withRetry(() => callGroq(text));
        } catch (error) {
          console.error("[GROQ NETWORK FAILURE]", error);
          response = new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown Groq network error" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        if (response.ok) {
          return { response, provider: "groq" };
        }
      }

      // Try OmniRoute (only if properly configured)
      if (useOmniRoute) {
        console.log(`[AI PROVIDER] Trying OmniRoute`);
        try {
          const omniResponse = await callOmniRouteWithRetry(text);

          if (omniResponse.ok) {
            console.log(`[AI PROVIDER SUCCESS] OmniRoute successfully processed chunk`);
            return { response: omniResponse, provider: "omniroute" };
          }
          console.error(`[OMNIROUTE] Unsuccessful response. Status: ${omniResponse.status}`);
        } catch (error) {
          console.error("[OMNIROUTE NETWORK FAILURE]", error);
        }
      } else {
        console.log(`[AI PROVIDER] Skipping OmniRoute (not configured)`);
      }

      return {
        response: null,
        provider: null,
        failureReason: "All configured AI providers failed to return a response.",
      };
    } finally {
      aiSemaphore.release();
    }
  };

  // PARALLEL: Process all chunks concurrently (max 4 at a time via semaphore)
  console.log(`Starting parallel AI analysis of ${textChunks.length} chunks (concurrency: 4)...`);

  const chunkPromises = textChunks.map(async (chunk, chunkIndex) => {
    console.log(`Analysing chunk ${chunkIndex + 1}/${textChunks.length} (${chunk.length} chars)`);

    // Update stage periodically (every 5 chunks)
    if (chunkIndex % 5 === 0) {
      await supabase
        .from("newspapers")
        .update({ processing_stage: `ai_analyzing_chunk_${chunkIndex + 1}_of_${textChunks.length}` })
        .eq("id", newspaperId);
    }

    const { response, provider, failureReason } = await processChunkWithAI(chunk);

    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      let errorText = "No response from AI service.";
      if (response) {
        errorText = await response.text().catch(() => "Unable to read AI error.");
      }

      // Return failure info for retry logic
      return { chunkIndex, chunk, status, errorText, failureReason, articles: [] as any[], provider };
    }

    let json: unknown;
    try { json = await response.json(); } catch { return { chunkIndex, chunk, articles: [] as any[], provider, error: "Invalid JSON" }; }

    let raw: unknown = null;
    if (provider === "gemini") {
      const geminiJson = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      raw = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } else {
      const openAiJson = json as { choices?: Array<{ message?: { content?: string } }> };
      raw = openAiJson.choices?.[0]?.message?.content ?? null;
    }

    if (!raw) return { chunkIndex, chunk, articles: [] as any[], provider, error: "Empty response" };

    const chunkArticles = parseAIArticles(raw);
    if (chunkArticles.length === 0) return { chunkIndex, chunk, articles: [] as any[], provider, error: "No valid articles" };

    return { chunkIndex, chunk, articles: chunkArticles, provider };
  });

  const chunkResults = await Promise.all(chunkPromises);

  // Collect successful articles
  const allArticles: any[] = [];
  type FailedChunk = { index: number; text: string; reason: string; };
  const failedChunks: FailedChunk[] = [];

  for (const result of chunkResults) {
    if (result.articles && result.articles.length > 0) {
      allArticles.push(...result.articles);
      console.log(`[AI CHUNK SUCCESS] Chunk ${result.chunkIndex + 1}/${textChunks.length}: ${result.articles.length} articles (${result.provider})`);
    } else {
      const reason = result.error || result.failureReason || `Status: ${result.status}`;
      failedChunks.push({ index: result.chunkIndex, text: result.chunk, reason });
      console.warn(`Chunk ${result.chunkIndex + 1} failed: ${reason}`);
    }
  }

  // Retry failed chunks sequentially with delay
  if (failedChunks.length > 0) {
    console.log(`Retrying ${failedChunks.length} failed chunks...`);
    const remainingFailed: FailedChunk[] = [];

    for (let retryIndex = 0; retryIndex < failedChunks.length; retryIndex++) {
      const failedChunk = failedChunks[retryIndex];
      console.log(`Retrying failed chunk ${failedChunk.index + 1}/${textChunks.length} (${retryIndex + 1}/${failedChunks.length})`);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const { response, provider, failureReason } = await processChunkWithAI(failedChunk.text);

      if (!response || !response.ok) {
        const status = response?.status ?? 0;
        let errorText = "No response from AI service.";
        if (response) errorText = await response.text().catch(() => "Unable to read AI error.");
        remainingFailed.push({ ...failedChunk, reason: `${failureReason ?? "AI retry failed"} Status: ${status}. ${errorText.slice(0, 300)}` });
        console.warn(`Retry failed for chunk ${failedChunk.index + 1}`);
        continue;
      }

      let json: unknown;
      try { json = await response.json(); } catch { remainingFailed.push({ ...failedChunk, reason: "Invalid JSON during retry" }); continue; }

      let raw: unknown = null;
      if (provider === "gemini") {
        const geminiJson = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        raw = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      } else {
        const openAiJson = json as { choices?: Array<{ message?: { content?: string } }> };
        raw = openAiJson.choices?.[0]?.message?.content ?? null;
      }

      if (!raw) { remainingFailed.push({ ...failedChunk, reason: "Empty response during retry" }); continue; }

      const retryArticles = parseAIArticles(raw);
      if (retryArticles.length === 0) { remainingFailed.push({ ...failedChunk, reason: "No valid articles during retry" }); continue; }

      allArticles.push(...retryArticles);
      console.log(`Retry successful for chunk ${failedChunk.index + 1}: ${retryArticles.length} articles`);
    }

    if (remainingFailed.length > 0) {
      console.warn(`${remainingFailed.length} chunks could not be processed after retry.`);
      for (const failed of remainingFailed) {
        console.warn(`Unprocessed chunk ${failed.index + 1}: ${failed.reason}`);
      }
    }
  }

  // Deduplicate
  const uniqueArticles = deduplicateArticles(allArticles);
  console.log(`AI extraction complete: ${allArticles.length} raw, ${uniqueArticles.length} unique.`);

  // Save articles
  let insertedArticles: { id: string; upsc_relevance_score: number | null }[] = [];
  if (uniqueArticles.length > 0) {
    const rows = uniqueArticles.map((article) => ({
      newspaper_id: newspaperId,
      user_id: userId,
      title: article.title,
      content: article.content,
      summary: article.summary ?? null,
      subject: article.subject ?? null,
      topics: article.topics ?? [],
      gs_paper: article.gs_paper ?? null,
      upsc_relevance_score: article.upsc_relevance_score,
      upsc_reasoning: article.upsc_reasoning ?? null,
      is_hot_topic: article.is_hot_topic ?? false,
      page_number: article.page_number ?? null,
    }));

    const { data, error: insertError } = await supabase
      .from("articles")
      .insert(rows)
      .select("id, upsc_relevance_score");

    if (insertError) throw insertError;
    insertedArticles = data ?? [];
  }

  // Update stage: MCQ generation
  await supabase
    .from("newspapers")
    .update({ processing_stage: "mcq_generating" })
    .eq("id", newspaperId);

  // MCQ generation - PARALLEL (max 4 concurrent)
  const mcqCandidateIds = insertedArticles
    .filter((a) => (a.upsc_relevance_score ?? 0) >= 40)
    .sort((a, b) => (b.upsc_relevance_score ?? 0) - (a.upsc_relevance_score ?? 0))
    .map((a) => a.id);

  const mcqSemaphore = new Semaphore(4);
  const mcqPromises = mcqCandidateIds.map(async (articleId) => {
    await mcqSemaphore.acquire();
    try {
      const result = await generateMcqsForArticle(supabase, userId, articleId, 5);
      return { articleId, inserted: result.inserted, cached: result.cached };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown MCQ generation error";
      return { articleId, inserted: 0, cached: false, error: message };
    } finally {
      mcqSemaphore.release();
    }
  });

  const mcqResults = await Promise.all(mcqPromises);
  for (const r of mcqResults) {
    if (r.error) {
      console.error(`[NEWSPAPER] MCQ generation failed for article ${r.articleId}:`, r.error);
    } else {
      console.log(`[NEWSPAPER] MCQs generated for article ${r.articleId}: ${r.inserted}`);
    }
  }

  // Mark complete
  await supabase
    .from("newspapers")
    .update({
      status: "completed",
      processing_stage: "completed",
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", newspaperId)
    .eq("user_id", userId);

  return { articles: uniqueArticles.length, chunks: textChunks.length, mcqCandidateIds, mcqResults };
}

