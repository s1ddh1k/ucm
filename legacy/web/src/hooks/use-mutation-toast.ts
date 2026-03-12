import { useCallback } from "react";
import { toast } from "sonner";
import { buildActionErrorMessage } from "@/lib/error";

type SuccessMessage<TData, TVariables> =
  | string
  | ((data: TData, variables: TVariables) => string);

interface UseMutationToastOptions<TData, TVariables> {
  success?: SuccessMessage<TData, TVariables>;
  errorAction: string;
  errorNextStep: string;
}

interface MutationToastHandlers<TData, TVariables> {
  notifySuccess: (data: TData, variables: TVariables) => void;
  notifyError: (error: unknown) => void;
}

export function useMutationToast<TData = unknown, TVariables = unknown>({
  success,
  errorAction,
  errorNextStep,
}: UseMutationToastOptions<TData, TVariables>): MutationToastHandlers<
  TData,
  TVariables
> {
  const notifySuccess = useCallback(
    (data: TData, variables: TVariables) => {
      if (!success) return;
      const message =
        typeof success === "function" ? success(data, variables) : success;
      toast.success(message);
    },
    [success],
  );

  const notifyError = useCallback(
    (error: unknown) => {
      toast.error(buildActionErrorMessage(errorAction, error, errorNextStep));
    },
    [errorAction, errorNextStep],
  );

  return {
    notifySuccess,
    notifyError,
  };
}
