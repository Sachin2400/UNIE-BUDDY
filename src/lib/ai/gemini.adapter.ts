import type {
  AIRequest,
  AIResponse,
} from "./ai-orchestrator";

const GEMINI_MODEL =
  "gemini-3.6-flash";

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

export async function callGemini(
  request: AIRequest,
): Promise<AIResponse> {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured.",
    );
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: sanitizePrompt(request.systemPrompt),
          },
        ],
      },

      contents: [
        {
          role: "user",

          parts: [
            {
              text: sanitizePrompt(request.userPrompt),
            },
          ],
        },
      ],

      generationConfig: {
        responseMimeType:
          "application/json",

        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const json =
    (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };

  const content =
    json.candidates?.[0]
      ?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error(
      "Gemini returned an empty response.",
    );
  }

  return {
    provider: "gemini",
    content,
    attempts: 1,
  };
}

