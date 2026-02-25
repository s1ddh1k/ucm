import { useEffect } from "react";
import { useSearchParams } from "react-router";

interface UseOpenFromSearchParamOptions {
  param: string;
  openValue?: string;
  clearParams?: readonly string[];
  onOpen: () => void;
}

export function useOpenFromSearchParam({
  param,
  openValue = "1",
  clearParams = [],
  onOpen,
}: UseOpenFromSearchParamOptions) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get(param) !== openValue) return;

    onOpen();
    const next = new URLSearchParams(searchParams);
    next.delete(param);
    for (const key of clearParams) {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }, [clearParams, onOpen, openValue, param, searchParams, setSearchParams]);
}
