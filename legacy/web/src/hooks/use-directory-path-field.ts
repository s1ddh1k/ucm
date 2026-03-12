import { useCallback, useState } from "react";
import type { BrowseResult } from "@/api/types";
import { useDirectoryBrowser } from "@/hooks/use-directory-browser";

interface UseDirectoryPathFieldOptions {
  path: string;
  setPath: (path: string) => void;
  clearSubmitError: () => void;
  onDirectorySelected?: (path: string) => void;
}

interface UseDirectoryPathFieldResult {
  browsing: boolean;
  loading: boolean;
  browseResult: BrowseResult | null;
  browseError: string | null;
  openPathBrowser: () => Promise<void>;
  navigateBrowser: (path: string) => Promise<void>;
  closeBrowser: () => void;
  clearBrowseError: () => void;
  handlePathChange: (nextPath: string) => void;
  selectDirectory: (dirPath: string) => void;
  selectionNotice: string | null;
  clearSelectionNotice: () => void;
}

export function useDirectoryPathField({
  path,
  setPath,
  clearSubmitError,
  onDirectorySelected,
}: UseDirectoryPathFieldOptions): UseDirectoryPathFieldResult {
  const {
    browsing,
    loading,
    browseResult,
    browseError,
    openBrowser,
    navigateBrowser,
    closeBrowser,
    clearBrowseError,
  } = useDirectoryBrowser();
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const clearSelectionNotice = useCallback(() => {
    setSelectionNotice(null);
  }, []);

  const handlePathChange = useCallback(
    (nextPath: string) => {
      clearSubmitError();
      clearBrowseError();
      clearSelectionNotice();
      setPath(nextPath);
    },
    [clearBrowseError, clearSelectionNotice, clearSubmitError, setPath],
  );

  const openPathBrowser = useCallback(async () => {
    clearSelectionNotice();
    await openBrowser(path || undefined);
  }, [clearSelectionNotice, openBrowser, path]);

  const selectDirectory = useCallback(
    (dirPath: string) => {
      clearSubmitError();
      clearSelectionNotice();
      setPath(dirPath);
      setSelectionNotice(`Selected directory: ${dirPath}`);
      closeBrowser();
      onDirectorySelected?.(dirPath);
    },
    [
      clearSelectionNotice,
      clearSubmitError,
      closeBrowser,
      onDirectorySelected,
      setPath,
    ],
  );

  return {
    browsing,
    loading,
    browseResult,
    browseError,
    openPathBrowser,
    navigateBrowser,
    closeBrowser,
    clearBrowseError,
    handlePathChange,
    selectDirectory,
    selectionNotice,
    clearSelectionNotice,
  };
}
