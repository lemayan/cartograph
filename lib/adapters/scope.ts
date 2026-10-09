export interface FrameworkRoot { directory: string; app: string | null; pages: string | null; config: string | null }
export function ownerDirectory(file: string, directories: readonly string[]): string | null {
  return directories.filter((directory) => directory === "." || file.startsWith(directory + "/"))
    .sort((a, b) => (b === "." ? -1 : b.length) - (a === "." ? -1 : a.length))[0] ?? null;
}
export function relativeTo(file: string, root: string) { return root === "." ? file : file.slice(root.length + 1); }
