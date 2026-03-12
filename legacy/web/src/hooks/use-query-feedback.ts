import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getErrorDetail } from "@/lib/error";

type RetryableQuery = Pick<
  UseQueryResult<unknown, unknown>,
  "error" | "isRefetching" | "refetch"
>;

interface UseQueryFeedbackOptions {
  fallbackDetail: string;
  nextStep: string;
}

interface QueryFeedback {
  errorMessage: string;
  isRetrying: boolean;
  retryLabel: string;
  retry: () => void;
}

function appendNextStep(detail: string, nextStep: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return nextStep;
  return trimmed.endsWith(".") ? `${trimmed} ${nextStep}` : `${trimmed}. ${nextStep}`;
}

export function useQueryFeedback(
  query: RetryableQuery,
  options: UseQueryFeedbackOptions,
): QueryFeedback {
  const { error, isRefetching, refetch } = query;
  const { fallbackDetail, nextStep } = options;

  const errorMessage = useMemo(
    () => appendNextStep(getErrorDetail(error, fallbackDetail), nextStep),
    [error, fallbackDetail, nextStep],
  );

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    errorMessage,
    isRetrying: isRefetching,
    retryLabel: isRefetching ? "Retrying..." : "Retry",
    retry,
  };
}
