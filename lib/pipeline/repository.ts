export interface PublicRepository { owner: string; name: string; url: string }

export function publicRepository(value: string): PublicRepository {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a public GitHub repository URL."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTPS github.com repository URL without credentials, a query, or a fragment.");
  }
  const parts = url.pathname.replace(/\/$/, "").split("/");
  const owner = parts[1]?.toLowerCase();
  const name = parts[2]?.replace(/\.git$/, "").toLowerCase();
  if (parts.length !== 3 || !owner || !name || !/^[a-z0-9][a-z0-9-]*$/.test(owner)
    || !/^[a-z0-9_.-]+$/.test(name) || name === "." || name === "..") {
    throw new Error("Use the repository root URL: https://github.com/owner/repository.");
  }
  return { owner, name, url: `https://github.com/${owner}/${name}` };
}
