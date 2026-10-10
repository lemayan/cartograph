import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRepository } from "../lib/parser/parse";
import { validateParserResult } from "../lib/parser/contract";

async function verify() {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-commonjs-"));
  async function put(file: string, contents: string) {
    const destination = path.join(root, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  try {
    await put("package.json", '{"dependencies":{"express":"5"}}');
    await put("jsconfig.json", '{"compilerOptions":{"paths":{"@local/*":["./lib/*"]}}}');
    await put("entry.js", [
      "import value from './lib/value';",
      "const same = require('./lib/value'); require('./lib/value');",
      "const alias = require('@local/value');",
      "const folder = require('./lib/directory');",
      "require('./lib/explicit.cjs');",
      "require('node:fs'); require('express'); require('./missing');",
      "require('./data.json'); require('./broken'); require('./dist/generated');",
      "const target = './lib/value'; require(target); require(`./lib/${target}`); require();",
      "require.resolve('./missing-resolve'); loader.require('./missing-method');",
      "// require('./comment')",
      "const text = \"require('./string')\";",
      "function local(require) { require('./shadowed-parameter'); }",
      "function hoisted() { require('./shadowed-variable'); var require = () => 1; }",
      "{ const require = () => 1; require('./shadowed-block'); }",
    ].join("\n"));
    await put("lib/value.js", "exports.value = 1; exports.value = 2; module.exports.other = 3;");
    await put("lib/directory/index.js", "module.exports = {value: 1, method(){}, get getter(){return 1}, 'literal-key': 2, 4: 4, [unknown]: 5, ...opaque};");
    await put("lib/explicit.cjs", "module.exports = function named() {}; module.exports.extra = 1;");
    await put("data.json", "{}"); await put("broken.js", "const = ;"); await put("dist/generated.js", "exports.x = 1;");
    await put("local-exports.js", "function shadow(exports, module) { exports.fake = 1; module.exports = {fake: 1}; } exports.real = 1;");
    await put("named-import.js", "import {require} from './lib/value'; require('./shadowed-import');");
    await put("global-lookalikes.js", "function require() {} function module() {} const exports = {}; ");
    await put("typescript.cts", "import value = require('./lib/value'); module.exports = value;");
    const result = validateParserResult(await parseRepository(root));
    const records = result.coverage.records.filter((record) => record.source === "entry.js");
    assert.equal(records.length, 15);
    assert.equal(result.coverage.byKind.require?.found, 15);
    assert.deepEqual(result.edges.find((edge) => edge.source === "entry.js" && edge.target === "lib/value.js")?.kinds, ["import", "require"]);
    assert.equal(result.edges.filter((edge) => edge.source === "entry.js" && edge.target === "lib/value.js").length, 1);
    assert.equal(records.find((record) => record.specifier === "@local/value")?.target, "lib/value.js");
    assert.equal(records.find((record) => record.specifier === "./lib/directory")?.target, "lib/directory/index.js");
    assert.equal(records.find((record) => record.specifier === "./lib/explicit.cjs")?.target, "lib/explicit.cjs");
    assert.equal(records.filter((record) => record.status === "external").length, 2);
    assert.equal(records.filter((record) => record.status === "excluded").length, 3);
    assert.equal(records.filter((record) => record.status === "unresolved").length, 4);
    assert.equal(records.find((record) => record.specifier === "./broken")?.reason, "syntax_error");
    assert.ok(records.every((record) => record.line > 0 && record.column > 0));
    assert.ok(!result.coverage.records.some((record) => record.specifier?.includes("shadowed")));
    assert.deepEqual(result.files.find((file) => file.path === "lib/value.js")?.commonjsExports, ["other", "value"]);
    assert.deepEqual(result.files.find((file) => file.path === "lib/directory/index.js")?.commonjsExports, ["4", "getter", "literal-key", "method", "value"]);
    assert.deepEqual(result.files.find((file) => file.path === "lib/explicit.cjs")?.commonjsExports, ["default", "extra"]);
    assert.deepEqual(result.files.find((file) => file.path === "local-exports.js")?.commonjsExports, ["real"]);
    assert.equal(result.coverage.records.find((record) => record.source === "typescript.cts")?.kind, "require");
    console.log("PASS: CommonJS literal/alias/directory/explicit resolution, coverage denominator and reasons, source positions, mixed syntax deduplication, local shadowing and explicit export names.");

    await put("conditional/package.json", '{"type":"module","imports":{"#local":{"import":"./esm.ts","require":"./common.ts"}}}');
    await put("conditional/tsconfig.json", '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}');
    await put("conditional/esm.ts", "export const value = 1;"); await put("conditional/common.ts", "export const value = 2;");
    await put("conditional/entry.mts", "import {value} from '#local'; const same = require('#local');");
    const conditional = validateParserResult(await parseRepository(root));
    assert.equal(conditional.coverage.records.find((record) => record.source === "conditional/entry.mts" && record.kind === "import")?.target, "conditional/esm.ts");
    assert.equal(conditional.coverage.records.find((record) => record.source === "conditional/entry.mts" && record.kind === "require")?.target, "conditional/common.ts");
    console.log("PASS: require and import respect their own NodeNext conditions through the unchanged resolver.");

    const legacy = await parseRepository(await mkdtemp(path.join(root, "legacy-")));
    delete legacy.coverage.byKind.require;
    assert.deepEqual(validateParserResult(legacy), legacy);
    assert.throws(() => validateParserResult({ ...result, files: result.files.map((file) => ({ ...file, commonjsExports: ["duplicate", "duplicate"] })) }), /CommonJS export/);
    const missingCounts = structuredClone(result); delete missingCounts.coverage.byKind.require;
    assert.throws(() => validateParserResult(missingCounts), /coverage for require/);
    console.log("PASS: old results remain readable; malformed exports and a missing CommonJS denominator fail loudly.");
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("cartograph-commonjs-")) throw new Error("Unsafe CommonJS fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
}
verify().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
