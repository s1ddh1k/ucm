import { useCallback, useState } from "react";
import { api } from "@/api/client";
import type { BrowseResult } from "@/api/types";

interface UseDirectoryBrowserResult {
  browsing: boolean;
  loading: boolean;
  browseResult: BrowseResult | null;
  browseError: string | null;
  openBrowser: (path?: string) => Promise<void>;
  navigateBrowser: (path: string) => Promise<void>;
  closeBrowser: () => void;
  clearBrowseError: () => void;
}

function toBrowseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `${error.message}. You can type a path manually or try browsing again.`;
  }
  return "Unable to load directories. You can type a path manually or try browsing again.";
}

export function useDirectoryBrowser(): UseDirectoryBrowserResult {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const openBrowser = useCallback(async (path?: string) => {
    setLoading(true);
    setBrowseError(null);
    setBrowsing(true);
    try {
      const result = await api.browse.list(path || undefined);
      setBrowseResult(result);
    } catch (error) {
      setBrowseError(toBrowseErrorMessage(error));
      setBrowsing(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const navigateBrowser = useCallback(async (path: string) => {
    setLoading(true);
    setBrowseError(null);
    try {
      const result = await api.browse.list(path);
      setBrowseResult(result);
    } catch (error) {
      setBrowseError(toBrowseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const closeBrowser = useCallback(() => {
    setBrowsing(false);
    setBrowseResult(null);
    setBrowseError(null);
  }, []);

  const clearBrowseError = useCallback(() => {
    setBrowseError(null);
  }, []);

  return {
    browsing,
    loading,
    browseResult,
    browseError,
    openBrowser,
    navigateBrowser,
    closeBrowser,
    clearBrowseError,
  };
}
