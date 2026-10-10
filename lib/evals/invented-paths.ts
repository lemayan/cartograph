export interface PathCheck {
  score: number;
  tokens: string[];
  invented: { path: string; offset: number; excerpt: string }[];
}

/** Lexical candidates, followed by exact membership. Never resolve or repair a path. */
export function inventedPaths(content: string, paths: readonly string[]): PathCheck {
  const allowed = new Set(paths);
  const mentions: { path: string; offset: number }[] = [];
  const knownExtensions = new Set([...paths.map((path) => path.split(".").at(-1)), "graphql", "gql", "markdown", "lock", "config", "gitignore"]);
  // URLs are not repository paths. Inline code also permits filenames containing spaces.
  const pattern = /https?:\/\/[^\s`<>]+|`([^`\n]+)`|[\p{L}\p{N}_@.$~+()[\]\\/-]+(?::\d+(?::\d+)?)?/gu;
  for (const match of content.matchAll(pattern)) {
    if (/^https?:\/\//.test(match[0])) continue;
    const candidates = match[1] && !/^[\p{L}\p{N}_@.$~+()[\]\\/ :\d-]+$/u.test(match[1])
      ? [...match[1].matchAll(/[\p{L}\p{N}_@.$~+()[\]\\/-]+(?::\d+(?::\d+)?)?/gu)].map((part) => ({ token: part[0], offset: match.index + 1 + part.index }))
      : [{ token: match[1] ?? match[0], offset: match.index + (match[1] ? 1 : 0) }];
    for (const candidate of candidates) {
      let token = candidate.token;
      if (!match[1] || candidates.length > 1) {
        token = token.replace(/[.,]+$/, "");
        // Keep Next.js route groups and dynamic segments; remove unmatched prose wrappers.
        for (const [open, close] of [["(", ")"], ["[", "]"]]) {
          while (!allowed.has(token) && token.startsWith(open) && token.endsWith(close)) token = token.slice(1, -1);
          while (token.endsWith(close) && token.split(close).length > token.split(open).length) token = token.slice(0, -1);
          while (token.startsWith(open) && token.split(open).length > token.split(close).length) token = token.slice(1);
        }
      }
      const extension = token.split(".").at(-1) ?? "";
      const shaped = /[/\\]/.test(token) && /[\p{L}\p{N}_]/u.test(token)
        || /^\.[a-zA-Z][\w.-]*$/.test(token)
        || /^[\p{L}_@][\p{L}\p{N}_@.+~-]*\.[a-zA-Z][a-zA-Z0-9]*$/u.test(token)
          && (/^(?:[a-z][a-z0-9]*|[A-Z][A-Z0-9]*)$/.test(extension) || knownExtensions.has(extension));
      if ((shaped || allowed.has(token)) && token) mentions.push({ path: token, offset: candidate.offset + candidate.token.indexOf(token) });
    }
  }
  const invented = mentions.filter((mention) => !allowed.has(mention.path)).map(({ path, offset }) => ({
    path, offset, excerpt: content.slice(Math.max(0, offset - 45), offset + path.length + 45),
  }));
  return { score: invented.length === 0 ? 1 : 0, tokens: mentions.map((mention) => mention.path), invented };
}

export function pathFeedback(check: PathCheck) {
  return { key: "path_grounded", score: check.score, comment: check.invented.length
    ? JSON.stringify(check.invented) : `All ${check.tokens.length} path mentions belong to the supplied set.` };
}
