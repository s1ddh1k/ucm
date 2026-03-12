import { useEffect, useRef } from "react";

export function useAutoScroll<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const shouldScroll = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      shouldScroll.current = scrollHeight - scrollTop - clientHeight < 50;
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (shouldScroll.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return ref;
}
