import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Check, X } from "lucide-react";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type {
  AskUserQuestionItem,
  ConfirmPlanExecutionItem,
} from "./tool-types";
import {
  DEFAULT_CUSTOM_ANSWER_PLACEHOLDER,
  isCustomAnswerOptionLabel,
} from "./tool-utils";

const TOOL_CARD_MARKDOWN_PLUGINS = [remarkGfm];

function ToolCardMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const content = children.trim();
  if (!content) {
    return null;
  }

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none text-inherit [&_p]:my-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={TOOL_CARD_MARKDOWN_PLUGINS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function AskUserQuestionToolCard({
  toolCallId,
  questions,
  addResult,
}: {
  toolCallId: string;
  questions: AskUserQuestionItem[];
  addResult?: ToolCallMessagePartProps<
    Record<string, unknown>,
    unknown
  >["addResult"];
}) {
  const [answersByIndex, setAnswersByIndex] = React.useState<
    Record<number, string[]>
  >({});
  const [customAnswersByIndex, setCustomAnswersByIndex] = React.useState<
    Record<number, string>
  >({});
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0);
  const [isAnimatingIn, setIsAnimatingIn] = React.useState(true);
  const [transitionDirection, setTransitionDirection] = React.useState<
    "next" | "prev"
  >("next");

  React.useEffect(() => {
    setCurrentQuestionIndex((previous) =>
      Math.min(previous, Math.max(questions.length - 1, 0)),
    );
  }, [questions.length]);

  React.useEffect(() => {
    setIsAnimatingIn(false);
    const frame = requestAnimationFrame(() => {
      setIsAnimatingIn(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [currentQuestionIndex]);

  const isCustomOnlyQuestion = React.useCallback(
    (question: AskUserQuestionItem) =>
      question.options.length === 1 &&
      isCustomAnswerOptionLabel(question.options[0]?.label ?? ""),
    [],
  );

  const currentQuestion = questions[currentQuestionIndex];
  const currentSelectedLabels = answersByIndex[currentQuestionIndex] ?? [];
  const isCurrentQuestionCustomOnly = currentQuestion
    ? isCustomOnlyQuestion(currentQuestion)
    : false;
  const currentHasCustomSelection =
    currentSelectedLabels.some(isCustomAnswerOptionLabel) ||
    isCurrentQuestionCustomOnly;
  const currentCustomAnswerText =
    customAnswersByIndex[currentQuestionIndex] ?? "";

  const getQuestionValidationError = React.useCallback(
    (questionIndex: number): string | null => {
      const question = questions[questionIndex];
      if (!question) {
        return null;
      }

      const isCustomOnly = isCustomOnlyQuestion(question);
      if (isCustomOnly) {
        const customAnswerText =
          customAnswersByIndex[questionIndex]?.trim() ?? "";
        if (!customAnswerText) {
          return `Please enter a custom answer for "${question.header}".`;
        }
        return null;
      }

      const selectedLabels = answersByIndex[questionIndex] ?? [];
      if (selectedLabels.length === 0) {
        return `Please answer "${question.header}" before continuing.`;
      }

      const hasCustomAnswer = selectedLabels.some(isCustomAnswerOptionLabel);
      if (hasCustomAnswer) {
        const customAnswerText =
          customAnswersByIndex[questionIndex]?.trim() ?? "";
        if (!customAnswerText) {
          return `Please enter a custom answer for "${question.header}".`;
        }
      }

      return null;
    },
    [answersByIndex, customAnswersByIndex, isCustomOnlyQuestion, questions],
  );

  const toggleAnswer = React.useCallback(
    (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
      setValidationError(null);
      setAnswersByIndex((previous) => {
        const existing = previous[questionIndex] ?? [];
        if (!multiSelect) {
          return { ...previous, [questionIndex]: [optionLabel] };
        }

        const hasOption = existing.includes(optionLabel);
        const next = hasOption
          ? existing.filter((entry) => entry !== optionLabel)
          : [...existing, optionLabel];
        return { ...previous, [questionIndex]: next };
      });
    },
    [],
  );

  const handleCustomAnswerChange = React.useCallback(
    (questionIndex: number, nextValue: string) => {
      setValidationError(null);
      setCustomAnswersByIndex((previous) => ({
        ...previous,
        [questionIndex]: nextValue,
      }));
    },
    [],
  );

  const handleSubmit = React.useCallback(() => {
    if (!addResult) {
      setValidationError("Cannot submit answers in this context.");
      return;
    }

    const firstInvalidIndex = questions.findIndex(
      (_, questionIndex) => getQuestionValidationError(questionIndex) !== null,
    );
    if (firstInvalidIndex !== -1) {
      const message = getQuestionValidationError(firstInvalidIndex);
      setValidationError(
        message ??
          `Please answer "${questions[firstInvalidIndex]?.header ?? `Question ${firstInvalidIndex + 1}`}" before submitting.`,
      );
      return;
    }

    const answers = questions.map((question, questionIndex) => {
      const isCustomOnly = isCustomOnlyQuestion(question);
      const rawSelectedLabels = answersByIndex[questionIndex] ?? [];
      const selectedLabels = isCustomOnly
        ? []
        : rawSelectedLabels.filter(
            (label) => !isCustomAnswerOptionLabel(label),
          );
      const hasCustomAnswer =
        isCustomOnly || rawSelectedLabels.some(isCustomAnswerOptionLabel);
      const customAnswerText = hasCustomAnswer
        ? (customAnswersByIndex[questionIndex] ?? "").trim()
        : "";
      const answerParts = [...selectedLabels];
      if (customAnswerText) {
        answerParts.push(customAnswerText);
      }

      return {
        question: question.question,
        answer: answerParts.join(", "),
      };
    });
    const answersRecord = Object.fromEntries(
      answers.map((entry) => [entry.question, entry.answer]),
    );

    addResult({
      success: true,
      answeredAt: new Date().toISOString(),
      responseCount: answers.length,
      answers: answersRecord,
    });
    setIsSubmitted(true);
  }, [
    addResult,
    answersByIndex,
    customAnswersByIndex,
    getQuestionValidationError,
    isCustomOnlyQuestion,
    questions,
  ]);

  const handleNext = React.useCallback(() => {
    if (!currentQuestion) {
      return;
    }

    const validationMessage = getQuestionValidationError(currentQuestionIndex);
    if (validationMessage) {
      setValidationError(validationMessage);
      return;
    }

    setValidationError(null);
    setTransitionDirection("next");
    setCurrentQuestionIndex((previous) =>
      Math.min(previous + 1, questions.length - 1),
    );
  }, [
    currentQuestion,
    currentQuestionIndex,
    getQuestionValidationError,
    questions.length,
  ]);

  const handlePrevious = React.useCallback(() => {
    setValidationError(null);
    setTransitionDirection("prev");
    setCurrentQuestionIndex((previous) => Math.max(previous - 1, 0));
  }, []);

  return (
    <div className="w-full max-w-2xl rounded-lg border border-(--card-border) bg-(--card-bg) p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-foreground">
          Requires Clarifications
        </div>
      </div>

      {currentQuestion && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] text-(--muted-foreground)">
            <span>
              Question {currentQuestionIndex + 1} of {questions.length}
            </span>
          </div>
          <div
            className={cn(
              "rounded-md will-change-transform transition-all duration-300 ease-out",
              isAnimatingIn
                ? "translate-x-0 scale-100 opacity-100"
                : transitionDirection === "next"
                  ? "translate-x-3 scale-[0.99] opacity-0"
                  : "-translate-x-3 scale-[0.99] opacity-0",
            )}
          >
            <div className="text-xs font-semibold text-foreground">
              {currentQuestion.header}
            </div>
            <div className="mt-1 text-xs text-(--muted-foreground)">
              {currentQuestion.question}
            </div>
            <div className="mt-2 space-y-2  p-2">
              {!isCurrentQuestionCustomOnly &&
                currentQuestion.options.map((option, optionIndex) => {
                  const checked = currentSelectedLabels.includes(option.label);
                  const inputId = `${toolCallId}-${currentQuestionIndex}-${optionIndex}`;
                  return (
                    <label
                      key={inputId}
                      htmlFor={inputId}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition-all duration-200",
                        checked
                          ? "scale-[1.01] border-blue-400 bg-blue-50 shadow-sm dark:border-blue-500/50 dark:bg-blue-500/10"
                          : "border-(--card-border) bg-(--card-bg) hover:border-blue-300/60 hover:bg-blue-50/30",
                      )}
                    >
                      <input
                        id={inputId}
                        type={
                          currentQuestion.multiSelect ? "checkbox" : "radio"
                        }
                        name={`${toolCallId}-${currentQuestionIndex}`}
                        checked={checked}
                        onChange={() =>
                          toggleAnswer(
                            currentQuestionIndex,
                            option.label,
                            currentQuestion.multiSelect,
                          )
                        }
                        className="mt-0.5 h-3.5 w-3.5 accent-blue-600"
                        disabled={isSubmitted}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">
                          {option.label}
                        </div>
                        <div className="text-(--muted-foreground)">
                          {option.description}
                        </div>
                      </div>
                    </label>
                  );
                })}
              {currentHasCustomSelection && (
                <div className="rounded-md border border-(--card-border) bg-(--card-bg) p-2">
                  <div className="text-xs font-medium text-foreground">
                    Custom answer
                  </div>
                  {isCurrentQuestionCustomOnly &&
                  currentQuestion.options[0]?.description ? (
                    <div className="mt-1 text-xs text-(--muted-foreground)">
                      {currentQuestion.options[0].description}
                    </div>
                  ) : null}
                  <Textarea
                    value={currentCustomAnswerText}
                    onChange={(event) =>
                      handleCustomAnswerChange(
                        currentQuestionIndex,
                        event.target.value,
                      )
                    }
                    placeholder={DEFAULT_CUSTOM_ANSWER_PLACEHOLDER}
                    className="mt-2 min-h-[72px] text-xs"
                    disabled={isSubmitted}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {validationError && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {validationError}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handlePrevious}
          disabled={isSubmitted || currentQuestionIndex === 0}
        >
          Previous
        </Button>
        {currentQuestionIndex < questions.length - 1 ? (
          <Button
            type="button"
            size="sm"
            onClick={handleNext}
            disabled={isSubmitted}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitted}
          >
            {isSubmitted ? "Submitted" : "Submit Answers"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConfirmPlanExecutionToolCard({
  toolCallId,
  plan,
  addResult,
}: {
  toolCallId: string;
  plan: ConfirmPlanExecutionItem;
  addResult?: ToolCallMessagePartProps<
    Record<string, unknown>,
    unknown
  >["addResult"];
}) {
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const reviewHeader =
    plan.reviewHeader?.trim() || "Review Plan Before Applying Changes";
  const approveLabel = plan.approveButtonLabel?.trim() || "Approve & Apply";
  const requestChangesLabel =
    plan.requestChangesButtonLabel?.trim() ||
    plan.submitChangesButtonLabel?.trim() ||
    "Suggest Edits";
  const feedbackPrompt =
    plan.feedbackPrompt?.trim() ||
    "Add feedback for the agent (optional for approval, required for edits).";

  const handleApprove = React.useCallback(() => {
    if (!addResult) {
      setValidationError("Cannot submit approval in this context.");
      return;
    }

    const trimmedFeedback = feedback.trim();
    addResult({
      success: true,
      approved: true,
      decision: "approved",
      feedback: trimmedFeedback.length > 0 ? trimmedFeedback : null,
      answeredAt: new Date().toISOString(),
      title: plan.title,
    });
    setValidationError(null);
    setIsSubmitted(true);
  }, [addResult, feedback, plan.title]);

  const handleSubmitChangesRequest = React.useCallback(() => {
    if (!addResult) {
      setValidationError("Cannot submit feedback in this context.");
      return;
    }

    const trimmed = feedback.trim();
    if (!trimmed) {
      setValidationError("Please add feedback before requesting changes.");
      return;
    }

    addResult({
      success: true,
      approved: false,
      decision: "rejected",
      feedback: trimmed,
      answeredAt: new Date().toISOString(),
      title: plan.title,
    });
    setValidationError(null);
    setIsSubmitted(true);
  }, [addResult, feedback, plan.title]);

  return (
    <div className="w-full max-w-2xl ">
      <div className="mb-2 text-xs font-semibold text-foreground">
        {reviewHeader}
      </div>

      <div className="rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-3">
        <div className="max-h-[28rem] overflow-y-auto pr-1">
          <div className="text-sm font-semibold text-foreground">
            {plan.title}
          </div>
          <ToolCardMarkdown className="mt-1 text-xs text-(--muted-foreground)">
            {plan.summary}
          </ToolCardMarkdown>
          {plan.reason ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <ToolCardMarkdown>{plan.reason}</ToolCardMarkdown>
            </div>
          ) : null}

          <div className="prose prose-sm py-2 text-xs text-(--muted-foreground)">
            <p>
              <strong>Steps</strong>
            </p>
            <ol className="ml-2 list-decimal">
              {plan.steps.map((step, index) => (
                <li key={`${toolCallId}-step-${index}`}>{step}</li>
              ))}
            </ol>

            {plan.risks.length > 0 ? (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-2">
                <div className="text-[11px] font-semibold text-red-700">
                  Risks
                </div>
                <ol className="!mt-0 !mb-0 ml-2 list-decimal">
                  {plan.risks.map((risk, index) => (
                    <li
                      key={`${toolCallId}-risk-${index}`}
                      className="!m-0 pb-1 text-red-700"
                    >
                      {risk}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-(--card-border) bg-(--card-bg-subtle) p-2">
        <div className="text-xs font-medium text-foreground">
          {feedbackPrompt}
        </div>
        <Textarea
          value={feedback}
          onChange={(event) => {
            setValidationError(null);
            setFeedback(event.target.value);
          }}
          placeholder="Share feedback for the agent."
          className="mt-2 min-h-[84px] text-xs"
          disabled={isSubmitted}
        />
      </div>

      {validationError ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {validationError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleApprove}
          disabled={isSubmitted}
          className="h-7 rounded-md px-2.5 text-xs"
        >
          <Check className="h-3 w-3" />
          {isSubmitted ? "Submitted" : approveLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleSubmitChangesRequest}
          disabled={isSubmitted}
          className="h-7 rounded-md px-2.5 text-xs"
        >
          <X className="h-3 w-3" />
          {requestChangesLabel}
        </Button>
      </div>
    </div>
  );
}
