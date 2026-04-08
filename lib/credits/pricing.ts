import { FREE_DAILY_CREDITS } from "@/lib/billing/plans";

export const INITIAL_CREDITS = FREE_DAILY_CREDITS;
export const MIN_CREDITS_PER_RUN = 1;
export const MAX_CREDITS_PER_RUN = 100; // Increased cap for heavy agentic runs

// 1 credit = $0.05 USD (20 credits = $1)
const DOLLARS_PER_CREDIT = 0.05;

type CreditPricingInput = {
  model?: string;
  inputChars?: number;
  outputChars: number;
  toolCallCount: number;
};

// Model pricing per 1M tokens (in USD)
// Source: https://www.anthropic.com/pricing, https://openai.com/pricing
type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models
  "claude-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  "claude-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-sonnet-4-6-low": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus": { inputPerMillion: 15.0, outputPerMillion: 75.0 },

  // OpenAI models (approximate)
  "gpt-5.4-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-5-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-5.4-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-5-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4.1-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-5.2-chat": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-4.1": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
};

// Default pricing for unknown models (conservative estimate)
const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

export const estimateTokensFromChars = (chars: number) => {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  // Average ~4 characters per token for English text
  return Math.ceil(chars / 4);
};

const resolveModelPricing = (model?: string): ModelPricing => {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) return DEFAULT_PRICING;

  // Check for exact match first
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key)) {
      return pricing;
    }
  }

  return DEFAULT_PRICING;
};

// For backward compatibility - used by some UI components
export const resolveModelMultiplier = (model?: string) => {
  const pricing = resolveModelPricing(model);
  // Normalize to a 1-3 multiplier scale based on output pricing
  if (pricing.outputPerMillion <= 1.25) return 1;
  if (pricing.outputPerMillion <= 15) return 2;
  return 3;
};

export const calculateChatRunCredits = ({
  model,
  inputChars = 0,
  outputChars,
  toolCallCount,
}: CreditPricingInput) => {
  const pricing = resolveModelPricing(model);

  // Estimate tokens from characters
  // Note: outputChars only captures the final assistant text message,
  // not the intermediate outputs (tool calls, reasoning, etc.)
  const baseOutputTokens = estimateTokensFromChars(outputChars);

  // Each tool call also generates output: tool call JSON + tool result
  // Average ~500 tokens per tool call for output
  const toolOutputTokens = toolCallCount * 500;
  const estimatedOutputTokens = baseOutputTokens + toolOutputTokens;

  // For agentic runs, input is typically much larger than output
  // If we don't have inputChars, estimate based on output and tool calls
  let estimatedInputTokens: number;
  if (inputChars > 0) {
    estimatedInputTokens = estimateTokensFromChars(inputChars);
  } else {
    // Heuristic for agentic runs:
    // - Each tool call triggers a new model invocation with full context
    // - Context grows QUADRATICALLY as conversation progresses
    // - Heavy agentic runs accumulate massive input across calls
    //
    // Formula models the growing context window:
    // - Base: 5x output tokens (system prompt + initial context)
    // - Per tool call: grows as context accumulates
    //   - First few calls: ~10K tokens each
    //   - Later calls: context has grown significantly
    // - Approximate with: sum of (base + i*growth) for i in 0..toolCalls
    //   = toolCalls * base + growth * toolCalls * (toolCalls-1) / 2
    //
    // Simplified: base_per_call * tools + growth_factor * tools^2
    const baseInputMultiplier = 5;
    const baseTokensPerToolCall = 10000;
    const contextGrowthPerCall = 3000; // Context grows with each tool result

    // Quadratic growth model for heavy agentic runs
    const linearComponent = toolCallCount * baseTokensPerToolCall;
    const quadraticComponent =
      (contextGrowthPerCall * toolCallCount * (toolCallCount - 1)) / 2;

    estimatedInputTokens =
      estimatedOutputTokens * baseInputMultiplier +
      linearComponent +
      quadraticComponent;
  }

  // Calculate estimated cost in USD
  const inputCost =
    (estimatedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost =
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion;
  const tokenBasedCostUSD = inputCost + outputCost;

  // Add empirical per-tool-call cost to capture agentic overhead
  // Each tool call triggers a model invocation with growing context
  // Based on observed data: agentic runs cost ~$0.08-0.15 per tool call
  const perToolCallCost =
    pricing.outputPerMillion <= 1.25
      ? 0.08 // cheap models (Haiku)
      : pricing.outputPerMillion <= 15
        ? 0.15 // mid-tier (Sonnet)
        : 0.4; // expensive models (Opus)
  const toolCallCostUSD = toolCallCount * perToolCallCost;

  const estimatedCostUSD = tokenBasedCostUSD + toolCallCostUSD;

  // Convert to credits (1 credit = $0.05)
  const rawCredits = estimatedCostUSD / DOLLARS_PER_CREDIT;

  // Apply min/max bounds
  const credits = Math.max(
    MIN_CREDITS_PER_RUN,
    Math.min(MAX_CREDITS_PER_RUN, Math.ceil(rawCredits)),
  );

  return {
    credits,
    rawCredits,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUSD,
    pricing,
    modelMultiplier: resolveModelMultiplier(model),
  };
};
