import { callGroq } from "./ai/groq.adapter";
import { callGemini } from "./ai/gemini.adapter";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DEFAULT_QUESTION_COUNT = 20;
const DEFAULT_DURATION_SECONDS = 30 * 60;

const QuizQuestionSchema = z.object({
  question: z.string().min(20),

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
    .min(5),

  topic: z
    .string()
    .min(1),

  subject: z
    .string()
    .min(1),

  difficulty: z.enum([
    "easy",
    "medium",
    "hard",
  ]),

  article_index: z
    .number()
    .int()
    .min(0),
});

const QuizResponseSchema = z.object({
  questions: z
    .array(QuizQuestionSchema)
    .min(1),
});

type QuizQuestion = z.infer<
  typeof QuizQuestionSchema
>;

const SYSTEM_PROMPT = `
You are UNIE-Examiner, a senior UPSC Civil Services Examination
Prelims question-setting expert.

You are creating a complete UPSC Prelims-style examination paper
from a collection of newspaper articles that have already been
analysed for UPSC relevance.

The newspaper is the source universe.

IMPORTANT:

1. Do NOT create one question per article.

2. Treat the entire newspaper as one integrated current-affairs
   knowledge source.

3. Connect current affairs with static UPSC syllabus concepts.

4. Questions should test:
   - Polity
   - Constitution
   - Governance
   - Economy
   - Environment and Ecology
   - Geography
   - Science and Technology
   - International Relations
   - History and Culture
   - Government schemes and institutions
   - Current-affairs-linked static concepts

5. Avoid trivial headline-recall questions.

6. Prefer authentic UPSC Prelims formats:
   - Multi-statement questions
   - "How many of the above" questions
   - Assertion and Reason
   - Matching pairs
   - Conceptual application
   - Current-affairs-to-static-concept questions

7. At least 80% of the questions should use
   statement-based or analytical formats.

8. Every question must have exactly four options.

9. There must be exactly ONE correct option.

10. correct_index is zero-based:
    0 = first option
    1 = second option
    2 = third option
    3 = fourth option

11. Difficulty must be exactly:
    easy
    medium
    hard

12. Use plausible UPSC-style distractors.

13. Do not make the correct answer obvious because of:
    - unusually long wording
    - unusual specificity
    - grammatical mismatch
    - repeated wording from the question

14. Do not invent facts that are not supported by the supplied
    newspaper material or established static UPSC knowledge.

15. Every question must be independently answerable.

16. Do not refer to:
    "the article"
    "the passage"
    "the newspaper above"
    or missing context.

17. article_index must identify the supplied article that most
    directly supports the question.

18. Questions may connect multiple articles, but article_index
    must point to the primary source article.

19. Do not generate duplicate or near-duplicate questions.

20. Maintain a balanced paper across UPSC subjects.

21. Do not provide answer letters such as "Option A is correct"
    inside the explanation.

22. Return ONLY valid JSON.

The output must exactly follow this structure:

{
  "questions": [
    {
      "question": "...",
      "options": [
        "...",
        "...",
        "...",
        "..."
      ],
      "correct_index": 0,
      "explanation": "...",
      "topic": "...",
      "subject": "...",
      "difficulty": "medium",
      "article_index": 0
    }
  ]
}
`;

function buildNewspaperContext(
  articles: Array<{
    id: string;
    title: string;
    content: string;
    summary: string | null;
    subject: string | null;
    topics: string[];
    gs_paper: string | null;
    upsc_relevance_score: number | null;
  }>,
): string {
  const MAX_DETAILED_ARTICLES = 3;
  const MAX_CONTENT_CHARS_PER_ARTICLE = 550;

  const rankedArticles = [...articles]
    .sort(
      (a, b) =>
        (b.upsc_relevance_score ?? 0) -
        (a.upsc_relevance_score ?? 0),
    );

  const detailedArticleIds = new Set(
    rankedArticles
      .slice(0, MAX_DETAILED_ARTICLES)
      .map((article) => article.id),
  );

  return articles
    .map((article, index) => {
      const content = article.content.trim();

      const limitedContent = detailedArticleIds.has(article.id)
        ? content.length > MAX_CONTENT_CHARS_PER_ARTICLE
          ? `${content.slice(0, MAX_CONTENT_CHARS_PER_ARTICLE)}
[Article content truncated for quiz generation]`
          : content
        : "[Detailed article content omitted; use title, summary, subject and topics]";

      return `
ARTICLE ${index}

Title:
${article.title}

Subject:
${article.subject ?? "Not specified"}

GS Paper:
${article.gs_paper ?? "Not specified"}

Topics:
${article.topics.join(", ") || "Not specified"}

UPSC Relevance:
${article.upsc_relevance_score ?? 0}/100

Summary:
${article.summary ?? "No summary available"}

Content:
${limitedContent}
`;
    })
    .join("\n\n-----------------------------\n\n");
}
function validateQuestionSet(
  questions: QuizQuestion[],
  expectedCount: number,
  articleCount: number,
): void {
  if (questions.length !== expectedCount) {
    throw new Error(
      `AI returned ${questions.length} questions; expected ${expectedCount}.`,
    );
  }

  const seen = new Set<string>();

  for (const question of questions) {
    const normalized = question.question
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    if (seen.has(normalized)) {
      throw new Error(
        "AI returned duplicate quiz questions.",
      );
    }

    seen.add(normalized);

    if (
      question.article_index < 0 ||
      question.article_index >= articleCount
    ) {
      throw new Error(
        `Invalid article_index: ${question.article_index}`,
      );
    }

    if (question.options.length !== 4) {
      throw new Error(
        "Every quiz question must have exactly four options.",
      );
    }

    const uniqueOptions =
      new Set(
        question.options.map((option) =>
          option.trim().toLowerCase(),
        ),
      );

    if (uniqueOptions.size !== 4) {
      throw new Error(
        "Quiz question contains duplicate options.",
      );
    }
  }
}

export async function generateDailyQuizForNewspaper(
  supabase: any,
  userId: string,
  newspaperId: string,
  questionCount = DEFAULT_QUESTION_COUNT,
  durationSeconds = DEFAULT_DURATION_SECONDS,
) {
  const safeQuestionCount = Math.min(
    Math.max(questionCount, 5),
    50,
  );

  const safeDurationSeconds = Math.max(
    durationSeconds,
    5 * 60,
  );

  /*
   * -------------------------------------------------------------
   * 1. VERIFY NEWSPAPER
   * -------------------------------------------------------------
   */

  const {
    data: newspaper,
    error: newspaperError,
  } = await supabase
    .from("newspapers")
    .select("id, name")
    .eq("id", newspaperId)
    .eq("user_id", userId)
    .single();

  if (newspaperError || !newspaper) {
    throw new Error("Newspaper not found.");
  }

  /*
   * -------------------------------------------------------------
   * 2. CHECK EXISTING QUIZ
   * -------------------------------------------------------------
   */

  const {
    data: existingQuiz,
    error: existingQuizError,
  } = await supabase
    .from("daily_quizzes")
    .select(
      "id, title, question_count, duration_seconds, created_at",
    )
    .eq("newspaper_id", newspaperId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingQuizError) {
    throw existingQuizError;
  }

  if (existingQuiz) {
    return {
      quiz: existingQuiz,
      created: false,
    };
  }

  /*
   * -------------------------------------------------------------
   * 3. LOAD UPSC-RELEVANT ARTICLES
   * -------------------------------------------------------------
   */

  const {
    data: articles,
    error: articlesError,
  } = await supabase
    .from("articles")
    .select(
      "id, title, content, summary, subject, topics, gs_paper, upsc_relevance_score",
    )
    .eq("newspaper_id", newspaperId)
    .eq("user_id", userId)
    .gte("upsc_relevance_score", 40)
    .order("upsc_relevance_score", {
      ascending: false,
    });

  if (articlesError) {
    throw articlesError;
  }

  if (!articles || articles.length === 0) {
    throw new Error(
      "No UPSC-relevant articles are available for this newspaper.",
    );
  }

  /*
   * -------------------------------------------------------------
   * 4. BUILD NEWSPAPER KNOWLEDGE CONTEXT
   * -------------------------------------------------------------
   */

  const newspaperContext =
    buildNewspaperContext(articles);

  const userPrompt = `
Create a ${safeQuestionCount}-question UPSC Civil Services
Prelims-style examination paper from the following newspaper
intelligence dataset.

Each question must test an underlying UPSC concept rather than
simply asking for headline recall.

The questions should collectively provide broad coverage across
the available subjects and topics.

QUESTION COUNT:
${safeQuestionCount}

ARTICLE COUNT:
${articles.length}

NEWSPAPER:
${newspaper.name}

IMPORTANT:
Return exactly ${safeQuestionCount} questions.

The article_index field must correspond to the ARTICLE number
in the supplied dataset.

NEWSPAPER INTELLIGENCE DATA:

${newspaperContext}
`;

  /*
   * -------------------------------------------------------------
   * 5. GENERATE COMPLETE PAPER
   * -------------------------------------------------------------
   */

  console.log(
    `[DAILY QUIZ] Generating ${safeQuestionCount} questions for newspaper ${newspaperId}`,
  );

   /*
   * -------------------------------------------------------------
   * AI PROVIDER STRATEGY
   * -------------------------------------------------------------
   *
   * Groq is the primary provider because
   * openai/gpt-oss-120b has already been verified
   * in this project.
   *
   * Gemini is used as a fallback.
   *
   * OmniRoute is intentionally NOT used here because
   * there is no local OmniRoute service running.
   */

 const BATCH_SIZES = [5, 5, 5, 5];

const BATCH_FOCUSES = [
  `
Focus primarily on:
- Polity
- Constitution
- Governance
- Economy
- Government schemes
- Institutions
`,
  `
Focus primarily on:
- Environment and Ecology
- Geography
- Science and Technology
- Agriculture
- Climate
`,
  `
Focus primarily on:
- History and Culture
- International Relations
- Society
- Mixed current-affairs-linked static concepts
`,
];

const generatedQuestions: unknown[] = [];

for (let batchIndex = 0; batchIndex < BATCH_SIZES.length; batchIndex++) {
  const batchSize = BATCH_SIZES[batchIndex];
  const batchFocus = BATCH_FOCUSES[batchIndex];

  const batchPrompt = `
Create EXACTLY ${batchSize} UPSC Civil Services Prelims-style
questions.

This is BATCH ${batchIndex + 1} of 3.

The complete examination will contain 20 questions.

BATCH FOCUS:
${batchFocus}

IMPORTANT:

1. Create exactly ${batchSize} questions.
2. Do NOT create one question per article.
3. Use the supplied newspaper intelligence as the source universe.
4. Connect current affairs with static UPSC concepts.
5. At least 80% must be statement-based or analytical.
6. Prefer:
   - multi-statement questions
   - how-many-of-the-above
   - assertion/reason
   - matching pairs
   - conceptual application
   - current-affairs-to-static-concept questions
7. Exactly four options per question.
8. Exactly ONE correct option.
9. correct_index must be zero-based.
10. Use easy, medium and hard difficulty.
11. Avoid trivial headline recall.
12. Avoid duplicate or near-duplicate questions.
13. Do not repeat the same concept unnecessarily.
14. Do not invent facts.
15. article_index MUST refer to the ARTICLE number in the supplied
    newspaper dataset.
16. Questions may connect multiple articles.
17. Every question must be independently answerable.
18. Do not mention "article", "newspaper", "passage" or "dataset"
    inside the actual question.
19. Do not reveal answers outside the JSON.
20. Return ONLY valid JSON.

QUESTION COUNT:
${batchSize}

NEWSPAPER:
${newspaper.name}

ARTICLE COUNT:
${articles.length}

NEWSPAPER INTELLIGENCE:

${newspaperContext}
`;

  console.log(
    `[DAILY QUIZ] Generating batch ${batchIndex + 1}/3: ${batchSize} questions`,
  );

  let batchResult;

  try {
    console.log(
      `[DAILY QUIZ] Batch ${batchIndex + 1}: trying Groq`,
    );

    batchResult = await callGroq({
      task: `daily-newspaper-prelims-quiz-batch-${batchIndex + 1}`,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: batchPrompt,
      maxCompletionTokens: 1800,
    });

    console.log(
      `[DAILY QUIZ] Batch ${batchIndex + 1}: Groq succeeded.`,
    );
  } catch (groqError) {
    console.error(
      `[DAILY QUIZ] Batch ${batchIndex + 1}: Groq failed:`,
      groqError instanceof Error
        ? groqError.message
        : String(groqError),
    );

    try {
      console.log(
        `[DAILY QUIZ] Batch ${batchIndex + 1}: trying Gemini fallback`,
      );

      batchResult = await callGemini({
        task: `daily-newspaper-prelims-quiz-batch-${batchIndex + 1}`,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: batchPrompt,
        maxCompletionTokens: 2800,
      });

      console.log(
        `[DAILY QUIZ] Batch ${batchIndex + 1}: Gemini succeeded.`,
      );
    } catch (geminiError) {
      console.error(
        `[DAILY QUIZ] Batch ${batchIndex + 1}: Gemini failed:`,
        geminiError instanceof Error
          ? geminiError.message
          : String(geminiError),
      );

      throw new Error(
        `Daily quiz generation failed during batch ${batchIndex + 1}.`,
      );
    }
  }

  let batchParsed: unknown;

  try {
    batchParsed = JSON.parse(batchResult.content);
  } catch (error) {
    console.error(
      `[DAILY QUIZ] Batch ${batchIndex + 1}: invalid JSON`,
      error,
    );

    throw new Error(
      `AI returned invalid JSON during quiz batch ${batchIndex + 1}.`,
    );
  }

  if (
    !batchParsed ||
    typeof batchParsed !== "object" ||
    !("questions" in batchParsed) ||
    !Array.isArray(
      (batchParsed as { questions?: unknown }).questions,
    )
  ) {
    throw new Error(
      `AI returned an invalid question structure during batch ${batchIndex + 1}.`,
    );
  }

  const batchQuestions =
    (batchParsed as { questions: unknown[] }).questions;

  if (batchQuestions.length !== batchSize) {
    throw new Error(
      `Quiz batch ${batchIndex + 1} returned ${batchQuestions.length} questions instead of ${batchSize}.`,
    );
  }

  generatedQuestions.push(...batchQuestions);

  console.log(
    `[DAILY QUIZ] Batch ${batchIndex + 1} complete. Total generated: ${generatedQuestions.length}/20`,
  );
}

const result = {
  provider: "groq" as const,
  content: JSON.stringify({
    questions: generatedQuestions,
  }),
  attempts: 3,
};

  /*
   * -------------------------------------------------------------
   * 6. PARSE + VALIDATE AI RESPONSE
   * -------------------------------------------------------------
   */

  let parsed: unknown;

  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error(
      "AI returned invalid JSON for the daily quiz.",
    );
  }

  const validated =
    QuizResponseSchema.safeParse(parsed);

  if (!validated.success) {
    console.error(
      "[DAILY QUIZ] Schema validation failed:",
      validated.error.flatten(),
    );

    throw new Error(
      "AI returned an invalid daily quiz structure.",
    );
  }

  const questions =
    validated.data.questions;

  validateQuestionSet(
    questions,
    safeQuestionCount,
    articles.length,
  );

  /*
   * -------------------------------------------------------------
   * 7. CREATE QUIZ
   * -------------------------------------------------------------
   */

  const {
    data: quiz,
    error: quizError,
  } = await supabase
    .from("daily_quizzes")
    .insert({
      user_id: userId,
      newspaper_id: newspaperId,
      title: `${newspaper.name} — UPSC Prelims Quiz`,
      question_count: safeQuestionCount,
      duration_seconds: safeDurationSeconds,
    })
    .select(
      "id, title, question_count, duration_seconds, created_at",
    )
    .single();

  if (quizError || !quiz) {
    throw quizError ?? new Error(
      "Failed to create daily quiz.",
    );
  }

  /*
   * -------------------------------------------------------------
   * 8. MAP AI QUESTIONS TO SOURCE ARTICLES
   * -------------------------------------------------------------
   */

  const questionRows = questions.map(
    (question, index) => {
      const sourceArticle =
        articles[question.article_index];

      if (!sourceArticle) {
        throw new Error(
          `Unable to map question ${index + 1} to its source article.`,
        );
      }

      return {
        quiz_id: quiz.id,
        article_id: sourceArticle.id,
        question: question.question,
        options: question.options,
        correct_index:
          question.correct_index,
        explanation:
          question.explanation,
        topic: question.topic,
        subject: question.subject,
        difficulty:
          question.difficulty,
        question_order: index + 1,
      };
    },
  );

  /*
   * -------------------------------------------------------------
   * 9. SAVE QUESTIONS
   * -------------------------------------------------------------
   */

  const {
    data: savedQuestions,
    error: questionsError,
  } = await supabase
    .from("daily_quiz_questions")
    .insert(questionRows)
    .select(
      "id, quiz_id, article_id, question, options, correct_index, explanation, topic, subject, difficulty, question_order",
    )
    .order("question_order", {
      ascending: true,
    });

  if (questionsError) {
    await supabase
      .from("daily_quizzes")
      .delete()
      .eq("id", quiz.id)
      .eq("user_id", userId);

    throw questionsError;
  }

  console.log(
    `[DAILY QUIZ] Created quiz ${quiz.id} with ${savedQuestions?.length ?? 0} questions.`,
  );

  return {
    quiz,
    questions: savedQuestions ?? [],
    created: true,
    provider: result.provider,
  };
}

/*
 * HTTP/server entry point.
 *
 * This is deliberately separate from the core generator so the
 * newspaper processing pipeline can call the same function later
 * without duplicating quiz-generation logic.
 */

export const generateDailyQuiz =
  createServerFn({
    method: "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      (data: {
        newspaperId: string;
        questionCount?: number;
        durationSeconds?: number;
      }) => data,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        return generateDailyQuizForNewspaper(
          context.supabase,
          context.userId,
          data.newspaperId,
          data.questionCount ??
            DEFAULT_QUESTION_COUNT,
          data.durationSeconds ??
            DEFAULT_DURATION_SECONDS,
        );
      },
    );
