import type { UcmDesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    ucm: UcmDesktopApi;
  }
}

export {};
