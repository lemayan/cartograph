export function repositoryLabel(repositoryUrl: string): string {
  try {
    const url = new URL(repositoryUrl);
    const path = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
    if (url.hostname === "github.com" && path) {
      const repository = path[2].replace(/\.git$/, "");
      if (repository) return `${path[1]}/${repository}`;
    }
  } catch {
    // Keep an unrecognized stored value visible rather than guessing a repository.
  }
  return repositoryUrl;
}

export function relativeTime(timestamp: string, now: number): string {
  const difference = now - Date.parse(timestamp);
  const seconds = Math.floor(Math.abs(difference) / 1000);
  if (seconds === 0) return "now";
  const elapsed = seconds < 60 ? `${seconds}s`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h`
    : `${Math.floor(seconds / 86400)}d`;
  return difference >= 0 ? `${elapsed} ago` : `in ${elapsed}`;
}
