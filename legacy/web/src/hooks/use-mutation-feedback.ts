import { useCallback, useMemo } from "react";
import { buildActionErrorMessage } from "@/lib/error";

interface MutationFeedbackState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
}

interface UseMutationFeedbackOptions {
  action: string;
  nextStep: string;
  pendingMessage: string;
}

interface UseMutationFeedbackResult {
  pendingStatusMessage: string | null;
  errorMessage: string | null;
  clearError: () => void;
}

export function useMutationFeedback(
  mutation: MutationFeedbackState,
  options: UseMutationFeedbackOptions,
): UseMutationFeedbackResult {
  const pendingStatusMessage = mutation.isPending ? options.pendingMessage : null;

  const errorMessage = useMemo(() => {
    if (!mutation.isError) return null;
    return buildActionErrorMessage(options.action, mutation.error, options.nextStep);
  }, [mutation.isError, mutation.error, options.action, options.nextStep]);

  const clearError = useCallback(() => {
    if (!mutation.isError) return;
    mutation.reset();
  }, [mutation.isError, mutation.reset]);

  return {
    pendingStatusMessage,
    errorMessage,
    clearError,
  };
}
