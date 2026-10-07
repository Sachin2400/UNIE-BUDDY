import type {
  AIRequest,
  AIResponse,
} from "./ai-orchestrator";

const OMNIROUTE_URL =
  process.env.OMNIROUTE_URL?.trim() ?? "";

const OMNIROUTE_MODEL =
  process.env.OMNIROUTE_MODEL ??
  "auto";

export async function callOmniRoute(
  request: AIRequest,
): Promise<AIResponse> {

  console.log(
    "[OMNIROUTE] Starting request",
    {
      url: OMNIROUTE_URL,
      model: OMNIROUTE_MODEL,
      task: request.task,
      promptLength:
        request.userPrompt.length,
    },
  );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      console.warn(
        "[OMNIROUTE] Request timeout after 120 seconds.",
      );

      controller.abort();
    }, 120000);

  try {
    // Sanitize prompts to strip any base64 image data that could cause errors
    const sanitizePrompt = (text: string): string => {
      return text
        .replace(/data:image\/[^;]+;base64,[^\s"']+/g, '[IMAGE_REMOVED]')
        .replace(/image\.png/gi, '[IMAGE_REF]')
        .replace(/\.png/gi, '');
    };

    const sanitizedSystemPrompt = sanitizePrompt(request.systemPrompt);
    const sanitizedUserPrompt = sanitizePrompt(request.userPrompt);

    const response =
      await fetch(
        OMNIROUTE_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            model: OMNIROUTE_MODEL,

            messages: [
              {
                role: "system",
                content:
                  sanitizedSystemPrompt,
              },

              {
                role: "user",
                content:
                  sanitizedUserPrompt,
              },
            ],

            temperature: 0.3,

            response_format: {
              type: "json_object",
            },
          }),

          signal:
            controller.signal,
        },
      );

    console.log(
      `[OMNIROUTE] HTTP status: ${response.status}`,
    );

    if (!response.ok) {

      const errorText =
        await response
          .text()
          .catch(
            () =>
              "Unable to read OmniRoute error",
          );

      console.error(
        "[OMNIROUTE ERROR]",
        {
          status:
            response.status,

          body:
            errorText.slice(
              0,
              1000,
            ),
        },
      );

      throw new Error(
        `OmniRoute HTTP ${response.status}: ${errorText.slice(
          0,
          1000,
        )}`,
      );
    }

    const json =
      (await response.json()) as {
        model?: string;

        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

    console.log(
      "[OMNIROUTE] Response received",
      {
        model:
          json.model ??
          "unknown",

        hasChoices:
          Boolean(
            json.choices?.length,
          ),
      },
    );

    const content =
      json.choices?.[0]
        ?.message?.content;

    if (!content) {

      console.error(
        "[OMNIROUTE] Empty response received.",
      );

      throw new Error(
        "OmniRoute returned an empty response.",
      );
    }

    console.log(
      "[OMNIROUTE SUCCESS]",
      {
        provider:
          "omniroute",

        contentLength:
          content.length,
      },
    );

    return {
      provider:
        "omniroute",

      content,

      attempts: 1,
    };

  } catch (error) {

    console.error(
      "[OMNIROUTE REQUEST FAILED]",
      {
        message:
          error instanceof Error
            ? error.message
            : String(error),

        name:
          error instanceof Error
            ? error.name
            : "Unknown",
      },
    );

    throw error;

  } finally {

    clearTimeout(timeout);

  }

}