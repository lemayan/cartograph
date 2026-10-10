import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ExplanationProse } from "../components/explanation-prose";

const markup = renderToStaticMarkup(<ExplanationProse
  content={'# Unsupported heading\n\nUses **`src/core/b.ts`** and `src/core/b.ts`.\n\n- **Shared** behaviour\n- [src/core/b.ts](https://example.com)\n\n<script>unsafe</script> and stray *** markers.'}
  paths={[{ type: "file", path: "src/core/b.ts" }]} onSelect={() => undefined} />);
assert.ok(markup.includes("<strong><code>"));
assert.ok(markup.includes("<ul>"));
assert.equal((markup.match(/class="explanation-path"/g) ?? []).length, 3);
assert.equal(/[`*#]/.test(markup), false);
assert.equal(/<h[1-6]|<script>|href=/.test(markup), false);
assert.ok(markup.includes("&lt;script&gt;"));
const boundaries = renderToStaticMarkup(<ExplanationProse content="prefix/src/core/b.ts.bak is different; src/core/b.ts."
  paths={[{ type: "file", path: "src/core/b.ts" }]} onSelect={() => undefined} />);
assert.equal((boundaries.match(/class="explanation-path"/g) ?? []).length, 1);
console.log("PASS: inline code, nested bold/code, bullets, every known path link, unsupported Markdown reduction, and escaped HTML.");
