import promptsConfig from "../../prompts.config.json";

/**
 * Load AI prompts from external config file (gitignored).
 * This keeps proprietary prompts out of the source code repository.
 */
export const AI_PROMPTS = {
  newspaperExtraction: promptsConfig.newspaperExtraction,
  mcqGeneration: promptsConfig.mcqGeneration,
  dailyQuiz: promptsConfig.dailyQuiz,
} as const;

export type PromptKey = keyof typeof AI_PROMPTS;