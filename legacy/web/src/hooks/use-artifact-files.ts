import { useMemo } from "react";

export type ArtifactKind = "verify" | "polish-summary" | "ux-review" | "generic";

const SUMMARY_FILES = new Set(["summary.md", "memory.json"]);

export function getArtifactKind(filename: string): ArtifactKind {
  if (filename.match(/^verify(-.*)?\.json$/)) return "verify";
  if (filename.match(/^polish-summary(-.*)?\.json$/)) return "polish-summary";
  if (filename.match(/^ux-review(-.*)?\.json$/)) return "ux-review";
  return "generic";
}

interface UseArtifactFilesParams {
  files: string[];
  contents: Record<string, unknown> | null | undefined;
}

interface StructuredArtifactFile {
  filename: string;
  data: unknown;
  kind: ArtifactKind;
}

interface UseArtifactFilesResult {
  structuredFiles: StructuredArtifactFile[];
  plainFiles: string[];
}

export function useArtifactFiles({ files, contents }: UseArtifactFilesParams): UseArtifactFilesResult {
  return useMemo(() => {
    const normalizedContents = contents ?? {};
    const knownStructuredFiles = Object.keys(normalizedContents);
    const order: ArtifactKind[] = ["verify", "polish-summary", "ux-review", "generic"];

    const structuredFiles: StructuredArtifactFile[] = [];
    for (const kind of order) {
      for (const filename of knownStructuredFiles) {
        if (getArtifactKind(filename) !== kind) continue;
        structuredFiles.push({
          filename,
          data: normalizedContents[filename],
          kind,
        });
      }
    }

    const structuredFileSet = new Set(structuredFiles.map((file) => file.filename));
    const plainFiles = files.filter(
      (filename) => !structuredFileSet.has(filename) && !SUMMARY_FILES.has(filename),
    );

    return { structuredFiles, plainFiles };
  }, [contents, files]);
}
