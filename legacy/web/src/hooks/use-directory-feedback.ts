import { useMemo } from "react";

interface UseDirectoryFeedbackOptions {
  loading: boolean;
  browseError: string | null;
  selectionNotice: string | null;
}

interface DirectoryFeedback {
  message: string;
  tone: "status" | "error";
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export function useDirectoryFeedback({
  loading,
  browseError,
  selectionNotice,
}: UseDirectoryFeedbackOptions): DirectoryFeedback | null {
  return useMemo(() => {
    if (loading) {
      return {
        message: "Loading directories...",
        tone: "status",
        role: "status",
        ariaLive: "polite",
      };
    }

    if (browseError) {
      return {
        message: browseError,
        tone: "error",
        role: "alert",
        ariaLive: "assertive",
      };
    }

    if (selectionNotice) {
      return {
        message: selectionNotice,
        tone: "status",
        role: "status",
        ariaLive: "polite",
      };
    }

    return null;
  }, [browseError, loading, selectionNotice]);
}
