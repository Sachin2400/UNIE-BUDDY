import type {
  AIRequest,
  AIResponse,
} from "./ai-orchestrator";

const GROQ_MODEL =
  "openai/gpt-oss-120b";

/**
 * Strip base64 image data from prompts before sending to AI models.
 * Prevents "Cannot read image.png" errors when OCR text contains image data.
 */
function sanitizePrompt(text: string): string {
  return text
    .replace(/data:image\/[^;]+;base64,[^\s"')\]]+/g, '[IMAGE_DATA_REMOVED]')
    .replace(/image\.png/gi, '[IMAGE_REF]')
    .replace(/\.png/gi, '');
}

export async function callGroq(
  request: AIRequest,
): Promise<AIResponse> {
  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not configured.",
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${apiKey}`,
      },

      body: JSON.stringify({
        model: GROQ_MODEL,

        messages: [
          {
            role: "system",
            content:
              sanitizePrompt(request.systemPrompt),
          },

          {
            role: "user",
            content:
              sanitizePrompt(request.userPrompt),
          },
        ],

        response_format: {
          type: "json_object",
        },

        temperature: 0.1,
  max_completion_tokens:
  request.maxCompletionTokens ?? 4096,      
      }),
      
    },
    
  );
  

  if (!response.ok) {
    throw new Error(
      `Groq HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const json =
    (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

  const content =
    json.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
      "Groq returned an empty response.",
    );
  }

  return {
    provider: "groq",
    content,
    attempts: 1,
  };
}