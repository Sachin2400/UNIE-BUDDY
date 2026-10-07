export type AIProviderName =
  | "gemini"
  | "groq"
  |"omniroute";

export type AIProviderStatus =
  | "healthy"
  | "rate_limited"
  | "temporarily_unavailable"
  | "failed"
  | "disabled";

export type AIFailureType =
  | "rate_limit"
  | "temporary"
  | "authentication"
  | "bad_request"
  | "server_error"
  | "network"
  | "empty_response"
  | "unknown";

export type AIRequest = {
  task: string;
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
  maxCompletionTokens?: number;
};

export type AIResponse = {
  provider: AIProviderName;
  content: string;
  attempts: number;
};

export type AIProviderState = {
  name: AIProviderName;
  status: AIProviderStatus;

  consecutiveFailures: number;
  consecutiveRateLimits: number;

  lastFailureAt?: number;
  lastSuccessAt?: number;

  rateLimitedUntil?: number;

  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
};

const providerStates: Record<
  AIProviderName,
  AIProviderState
> = {
  gemini: {
    name: "gemini",
    status: "healthy",
    consecutiveFailures: 0,
    consecutiveRateLimits: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
  },

  groq: {
    name: "groq",
    status: "healthy",
    consecutiveFailures: 0,
    consecutiveRateLimits: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
  },

    omniroute: {
    name: "omniroute",
    status: "healthy",
    consecutiveFailures: 0,
    consecutiveRateLimits: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
  },
};

export function getProviderStates(): AIProviderState[] {
  return Object.values(providerStates);
}

export function getProviderState(
  provider: AIProviderName,
): AIProviderState {
  return providerStates[provider];
}

export function markProviderSuccess(
  provider: AIProviderName,
): void {
  const state =
    providerStates[provider];

  state.status = "healthy";

  state.consecutiveFailures = 0;
  state.consecutiveRateLimits = 0;

  state.lastSuccessAt = Date.now();

  state.rateLimitedUntil = undefined;

  state.successfulRequests++;
}

export function markProviderFailure(
  provider: AIProviderName,
  failureType: AIFailureType,
): void {
  const state =
    providerStates[provider];

  state.failedRequests++;
  state.consecutiveFailures++;
  state.lastFailureAt = Date.now();

  switch (failureType) {
    case "rate_limit": {
      state.status = "rate_limited";
      state.consecutiveRateLimits++;

      /*
       * Start with a short cooldown.
       *
       * The retry layer will apply the actual
       * Retry-After value when available.
       */
      const cooldown =
        Math.min(
          30_000 *
            Math.max(
              1,
              state.consecutiveRateLimits,
            ),
          5 * 60_000,
        );

      state.rateLimitedUntil =
        Date.now() + cooldown;

      break;
    }

    case "temporary":
    case "server_error":
    case "network": {
      state.status =
        "temporarily_unavailable";

      break;
    }

    case "authentication":
    case "bad_request": {
      state.status = "failed";

      break;
    }

    default: {
      state.status = "failed";
    }
  }
}

export function recordProviderRequest(
  provider: AIProviderName,
): void {
  providerStates[provider]
    .totalRequests++;
}

export function isProviderAvailable(
  provider: AIProviderName,
): boolean {
  const state = providerStates[provider];

  /*
   * Permanently disabled providers must never
   * participate in routing.
   */
  if (state.status === "disabled") {
    return false;
  }

  /*
   * Rate-limited providers remain outside the
   * rotation until their cooldown expires.
   */
  if (state.status === "rate_limited") {
    if (
      state.rateLimitedUntil &&
      Date.now() < state.rateLimitedUntil
    ) {
      return false;
    }

    /*
     * Rate-limit cooldown expired.
     * Allow a controlled re-test.
     */
    state.status = "healthy";
    state.rateLimitedUntil = undefined;
  }

  /*
   * Temporarily unavailable providers are controlled
   * by the circuit breaker.
   *
   * Do NOT immediately route traffic back to them.
   */
  if (
    state.status ===
    "temporarily_unavailable"
  ) {
    return false;
  }

  /*
   * Failed providers remain outside the normal
   * rotation until explicitly reset.
   */
  if (state.status === "failed") {
    return false;
  }

  return true;
}

export function classifyHTTPFailure(
  status: number,
): AIFailureType {
  switch (status) {
    case 400:
      return "bad_request";

    case 401:
    case 403:
      return "authentication";

    case 429:
      return "rate_limit";

    case 500:
    case 502:
    case 503:
    case 504:
      return "server_error";

    default:
      return "unknown";
  }
}

export function classifyNetworkFailure(
  error: unknown,
): AIFailureType {
  if (
    error instanceof TypeError
  ) {
    return "network";
  }

  return "network";
}

export function classifyFailure(
  error: unknown,
): AIFailureType {
  if (
    error instanceof Error
  ) {
    const message =
      error.message.toLowerCase();

    if (
      message.includes(
        "429",
      ) ||
      message.includes(
        "rate limit",
      ) ||
      message.includes(
        "too many requests",
      )
    ) {
      return "rate_limit";
    }

    if (
      message.includes(
        "401",
      ) ||
      message.includes(
        "403",
      ) ||
      message.includes(
        "unauthorized",
      ) ||
      message.includes(
        "forbidden",
      )
    ) {
      return "authentication";
    }

    if (
      message.includes(
        "500",
      ) ||
      message.includes(
        "502",
      ) ||
      message.includes(
        "503",
      ) ||
      message.includes(
        "504",
      )
    ) {
      return "server_error";
    }

    if (
      message.includes(
        "empty response",
      )
    ) {
      return "empty_response";
    }

    if (
      message.includes(
        "network",
      ) ||
      message.includes(
        "fetch failed",
      ) ||
      message.includes(
        "socket",
      ) ||
      message.includes(
        "timeout",
      ) ||
      message.includes(
        "econn",
      )
    ) {
      return "network";
    }
  }

  return "unknown";
}

export function resetProviderState(
  provider: AIProviderName,
): void {
  providerStates[provider] = {
    ...providerStates[provider],

    status: "healthy",

    consecutiveFailures: 0,
    consecutiveRateLimits: 0,

    rateLimitedUntil:
      undefined,
  };
}
const PROVIDER_PRIORITY: AIProviderName[] = [
  "gemini",
  "groq",
  "omniroute",
];

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;

const CIRCUIT_BREAKER_COOLDOWN_MS =
  60_000;

export function selectProvider(): AIProviderName | null {
  const availableProviders =
    PROVIDER_PRIORITY.filter(
      (provider) =>
        isProviderAvailable(provider),
    );

  if (
    availableProviders.length === 0
  ) {
    return null;
  }

  /*
   * Prefer providers with:
   *
   * 1. Fewer consecutive failures
   * 2. Fewer rate limits
   * 3. Higher success rate
   * 4. Original provider priority
   */

  availableProviders.sort(
    (a, b) => {
      const stateA =
        providerStates[a];

      const stateB =
        providerStates[b];

      if (
        stateA.consecutiveFailures !==
        stateB.consecutiveFailures
      ) {
        return (
          stateA.consecutiveFailures -
          stateB.consecutiveFailures
        );
      }

      if (
        stateA.consecutiveRateLimits !==
        stateB.consecutiveRateLimits
      ) {
        return (
          stateA.consecutiveRateLimits -
          stateB.consecutiveRateLimits
        );
      }

      const successRateA =
        stateA.totalRequests > 0
          ? stateA.successfulRequests /
            stateA.totalRequests
          : 1;

      const successRateB =
        stateB.totalRequests > 0
          ? stateB.successfulRequests /
            stateB.totalRequests
          : 1;

      return (
        successRateB -
        successRateA
      );
    },
  );

  return availableProviders[0] ?? null;
}

export function applyCircuitBreaker(
  provider: AIProviderName,
): void {
  const state =
    providerStates[provider];

  if (
    state.consecutiveFailures <
    CIRCUIT_BREAKER_FAILURE_THRESHOLD
  ) {
    return;
  }

  state.status =
    "temporarily_unavailable";

  state.lastFailureAt =
    Date.now();

  console.warn(
    `[AI CIRCUIT BREAKER] ${provider} temporarily removed from rotation after ${state.consecutiveFailures} consecutive failures.`,
  );

  setTimeout(() => {
    const current =
      providerStates[provider];

    /*
     * Only restore the provider if it
     * has not failed again since the
     * circuit breaker opened.
     */
    if (
      current.status ===
        "temporarily_unavailable" &&
      current.consecutiveFailures >=
        CIRCUIT_BREAKER_FAILURE_THRESHOLD
    ) {
      console.log(
        `[AI CIRCUIT BREAKER] Re-testing ${provider} after cooldown.`,
      );

      current.status =
        "healthy";

      current.consecutiveFailures = 0;
    }
  }, CIRCUIT_BREAKER_COOLDOWN_MS);
}
export type RetryDecision =
  | {
      action: "retry";
      delayMs: number;
      reason: string;
    }
  | {
      action: "switch_provider";
      reason: string;
    }
  | {
      action: "disable_provider";
      reason: string;
    };

const MAX_PROVIDER_RETRIES = 2;

const BASE_RETRY_DELAY_MS = 1_500;

const MAX_RETRY_DELAY_MS = 15_000;

function calculateBackoff(
  attempt: number,
): number {
  const exponentialDelay =
    BASE_RETRY_DELAY_MS *
    Math.pow(2, attempt);

  /*
   * Add small jitter so multiple
   * requests do not retry together.
   */
  const jitter =
    Math.floor(
      Math.random() * 500,
    );

  return Math.min(
    exponentialDelay + jitter,
    MAX_RETRY_DELAY_MS,
  );
}

export function getRetryDecision(
  failureType: AIFailureType,
  attempt: number,
  retryAfterMs?: number,
): RetryDecision {
  /*
   * -------------------------------------------------------------
   * RATE LIMIT
   * -------------------------------------------------------------
   */

  if (
    failureType ===
    "rate_limit"
  ) {
    /*
     * Rate limits are different from
     * ordinary temporary failures.
     *
     * Do not repeatedly hammer the
     * provider.
     */

    if (
      attempt >=
      MAX_PROVIDER_RETRIES
    ) {
      return {
        action: "switch_provider",

        reason:
          "Provider remains rate-limited after maximum retry attempts.",
      };
    }

    const delay =
      retryAfterMs ??
      calculateBackoff(attempt);

    return {
      action: "retry",

      delayMs: Math.min(
        delay,
        MAX_RETRY_DELAY_MS,
      ),

      reason:
        "Provider rate limit detected.",
    };
  }

  /*
   * -------------------------------------------------------------
   * NETWORK FAILURE
   * -------------------------------------------------------------
   */

  if (
    failureType ===
    "network"
  ) {
    /*
     * Network failures are often
     * transient, so give the same
     * provider a short second chance.
     */

    if (
      attempt >=
      MAX_PROVIDER_RETRIES
    ) {
      return {
        action: "switch_provider",

        reason:
          "Provider network failure persisted after retries.",
      };
    }

    return {
      action: "retry",

      delayMs:
        calculateBackoff(attempt),

      reason:
        "Temporary network failure.",
    };
  }

  /*
   * -------------------------------------------------------------
   * SERVER FAILURE
   * -------------------------------------------------------------
   */

  if (
    failureType ===
      "server_error" ||
    failureType ===
      "temporary"
  ) {
    if (
      attempt >=
      MAX_PROVIDER_RETRIES
    ) {
      return {
        action: "switch_provider",

        reason:
          "Provider server failure persisted after retries.",
      };
    }

    return {
      action: "retry",

      delayMs:
        calculateBackoff(attempt),

      reason:
        "Temporary provider server failure.",
    };
  }

  /*
   * -------------------------------------------------------------
   * AUTHENTICATION
   * -------------------------------------------------------------
   */

  if (
    failureType ===
    "authentication"
  ) {
    /*
     * Never retry an invalid API
     * credential repeatedly.
     */

    return {
      action: "disable_provider",

      reason:
        "Provider authentication failed. Retrying will not fix invalid credentials.",
    };
  }

  /*
   * -------------------------------------------------------------
   * BAD REQUEST
   * -------------------------------------------------------------
   */

  if (
    failureType ===
    "bad_request"
  ) {
    /*
     * A malformed request will normally
     * fail again with the same payload.
     */

    return {
      action: "switch_provider",

      reason:
        "Provider rejected the request as invalid.",
    };
  }

  /*
   * -------------------------------------------------------------
   * EMPTY RESPONSE
   * -------------------------------------------------------------
   */

  if (
    failureType ===
    "empty_response"
  ) {
    if (
      attempt >=
      MAX_PROVIDER_RETRIES
    ) {
      return {
        action: "switch_provider",

        reason:
          "Provider repeatedly returned an empty response.",
      };
    }

    return {
      action: "retry",

      delayMs:
        calculateBackoff(attempt),

      reason:
        "Provider returned an empty response.",
    };
  }

  /*
   * -------------------------------------------------------------
   * UNKNOWN FAILURE
   * -------------------------------------------------------------
   */

  if (
    attempt >=
    MAX_PROVIDER_RETRIES
  ) {
    return {
      action: "switch_provider",

      reason:
        "Unknown provider failure persisted after retries.",
    };
  }

  return {
    action: "retry",

    delayMs:
      calculateBackoff(attempt),

    reason:
      "Unknown temporary provider failure.",
  };
}

export function disableProvider(
  provider: AIProviderName,
): void {
  const state =
    providerStates[provider];

  state.status = "disabled";

  state.rateLimitedUntil =
    undefined;

  console.warn(
    `[AI PROVIDER] ${provider} has been disabled because it requires configuration correction.`,
  );
}

export function getRetryAfterMs(
  retryAfter: string | null,
): number | undefined {
  if (!retryAfter) {
    return undefined;
  }

  /*
   * Retry-After may be expressed
   * as seconds.
   */

  const seconds =
    Number(retryAfter);

  if (
    Number.isFinite(seconds) &&
    seconds > 0
  ) {
    return seconds * 1000;
  }

  /*
   * Retry-After can also theoretically
   * be an HTTP date.
   */

  const date =
    Date.parse(retryAfter);

  if (
    Number.isFinite(date)
  ) {
    const delay =
      date - Date.now();

    if (delay > 0) {
      return delay;
    }
  }

  return undefined;
}



