import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readParserResult, validateParserResult, writeParserResult } from "../lib/parser/data";
import { parseRepository } from "../lib/parser/parse";

async function verify(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-parser-"));
  async function put(name: string, contents: string): Promise<void> {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
  try {
    await put("entry.ts", "import { value } from './leaf';\nexport { value } from './leaf';\nvoid import('./leaf');\nconsole.log(value);\n");
    await put("leaf.ts", "export const value = 1;\n");
    const before = validateParserResult(await parseRepository(root));
    assert.equal(before.coverage.imports.found, 3);
    assert.equal(before.coverage.imports.resolved, 3);
    assert.equal(before.edges.length, 1);
    assert.deepEqual(before.edges[0].kinds, ["import", "re-export", "dynamic-import"]);
    assert.equal(before.files.find((file) => file.path === "entry.ts")?.fanOut, 1);
    assert.equal(before.files.find((file) => file.path === "leaf.ts")?.fanIn, 1);
    assert.equal(before.files.find((file) => file.path === "entry.ts")?.lines, 4);
    assert.equal(await readFile(path.join(root, "entry.ts"), "utf8"), "import { value } from './leaf';\nexport { value } from './leaf';\nvoid import('./leaf');\nconsole.log(value);\n");
    console.log("PASS: no-config directory, three import kinds, deduplication, fan counts, physical lines, and unchanged source.");

    // Exactly one importing occurrence makes the rename acceptance check unambiguous.
    await put("entry.ts", "import { value } from './leaf';\nconsole.log(value);\n");
    const healthy = validateParserResult(await parseRepository(root));
    assert.equal(healthy.coverage.imports.unresolved, 0);
    await rename(path.join(root, "leaf.ts"), path.join(root, "renamed.ts"));
    const renamed = validateParserResult(await parseRepository(root));
    assert.equal(renamed.coverage.imports.unresolved, 1);
    assert.equal(renamed.edges.length, 0);
    const failure = renamed.coverage.records.find((record) => record.status === "unresolved");
    assert.equal(failure?.source, "entry.ts");
    assert.equal(failure?.specifier, "./leaf");
    assert.match(failure?.reason ?? "", /module_not_found/);
    console.log(`PASS: rename -> exactly ${renamed.coverage.imports.unresolved} unresolved import; ${failure?.source}:${failure?.line} ${failure?.reason}`);

    await put("entry.ts", [
      "import { value } from '@nested/value';",
      "export * from './nested/barrel';",
      "export type { Shape } from './nested/value';",
      "void import(`./nested/value`);",
      "declare const dynamic: string; void import(dynamic);",
      "import './style.css';",
      "import './dist/generated';",
      "import './broken';",
      "import 'node:fs';",
      "import 'node:test';",
      "import 'declared-package';",
      "import 'undeclared-package';",
      "type Imported = import('./nested/value').Shape;",
      "import old = require('./nested/value');",
      "require('./missing-require-is-out-of-scope');",
      "// import './comment-is-not-an-import';",
      "console.log(\"import './string-is-not-an-import'\", value);",
    ].join("\n"));
    await put("nested/value.ts", "export const value = 1; export interface Shape { value: number }\n");
    await put("nested/barrel.ts", "export { value } from './value';\nexport * from './value';\n");
    await put("style.css", "body {}\n");
    await put("dist/generated.ts", "export {};\n");
    await put("broken.ts", "export const = ;\n");
    await put("empty.js", "");
    await put("package.json", JSON.stringify({ dependencies: { "declared-package": "1.0.0" } }));
    await put("tsconfig.json", JSON.stringify({ compilerOptions: { moduleResolution: "bundler", module: "esnext", paths: { "@nested/*": ["./nested/*"] } } }));
    const complex = validateParserResult(await parseRepository(root));
    assert.equal(complex.coverage.imports.found, 16);
    assert.equal(complex.coverage.imports.unresolved, 2);
    assert.equal(complex.coverage.imports.external, 3);
    assert.equal(complex.coverage.imports.excluded, 4);
    assert.equal(complex.coverage.byKind["re-export"].found, 4);
    assert.equal(complex.coverage.byKind["re-export"].resolved, 4);
    assert.equal(complex.coverage.skipped.find((file) => file.path === "broken.ts")?.reason, "syntax_error");
    assert.equal(complex.coverage.records.find((record) => record.specifier === "./broken")?.reason, "syntax_error");
    assert.equal(complex.coverage.records.find((record) => record.specifier === "./style.css")?.reason, "unsupported_extension");
    assert.equal(complex.coverage.records.find((record) => record.specifier === "./dist/generated")?.reason, "generated_directory");
    assert.equal(complex.files.find((file) => file.path === "nested/value.ts")?.folder, "nested");
    assert.equal(complex.files.find((file) => file.path === "empty.js")?.lines, 0);
    assert.equal(complex.files.find((file) => file.path === "empty.js")?.module, "script");
    const sortedPaths = complex.files.map((file) => file.path);
    assert.deepEqual(sortedPaths, [...sortedPaths].sort());
    assert.deepEqual(validateParserResult(await parseRepository(root)), complex);
    console.log("PASS: aliases, barrels, type imports, template literals, nonliteral failures, builtins, packages, assets, generated directories, syntax errors, deterministic output, and exact folders.");

    await put("nested/tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@own": ["./value.ts"] } } }));
    await put("nested/consumer.ts", "import { value } from '@own'; console.log(value);\n");
    const nested = validateParserResult(await parseRepository(root));
    assert.equal(nested.coverage.records.find((record) => record.source === "nested/consumer.ts")?.target, "nested/value.ts");
    const custom = validateParserResult(await parseRepository(root, { name: "test", classify: (file) => file.path === "empty.js" ? "fixture" : null }));
    assert.equal(custom.files.find((file) => file.path === "empty.js")?.kind, "fixture");
    assert.deepEqual(custom.edges, nested.edges);
    console.log("PASS: nearest nested configuration and adapter classifications cannot change import edges.");

    await put("conditional/tsconfig.json", JSON.stringify({ compilerOptions: { module: "nodenext", moduleResolution: "nodenext" } }));
    await put("conditional/package.json", JSON.stringify({ type: "module", imports: { "#local": { import: "./esm.ts", require: "./common.ts" } } }));
    await put("conditional/esm.ts", "export const value = 1;\n");
    await put("conditional/common.ts", "export const value = 2;\n");
    await put("conditional/consumer.mts", "import { value } from '#local'; console.log(value);\n");
    await put("conditional/consumer.cts", "import { value } from '#local'; console.log(value);\n");
    const conditional = validateParserResult(await parseRepository(root));
    assert.equal(conditional.coverage.records.find((record) => record.source === "conditional/consumer.mts")?.target, "conditional/esm.ts");
    assert.equal(conditional.coverage.records.find((record) => record.source === "conditional/consumer.cts")?.target, "conditional/common.ts");
    await put("invalid/tsconfig.json", JSON.stringify({ extends: "missing-config-package" }));
    await put("invalid/entry.ts", "import '../empty.js';\n");
    await assert.rejects(() => parseRepository(root), /missing-config-package/);
    await rm(path.join(root, "invalid", "entry.ts"));
    console.log("PASS: NodeNext conditional imports and loud failure for a missing tsconfig dependency.");

    const output = path.join(root, "result.json");
    await writeParserResult(output, nested);
    const readback = await readParserResult(output);
    assert.deepEqual(readback, nested);
    assert.throws(() => validateParserResult({ ...nested, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateParserResult({ ...nested, files: nested.files.map((file) => ({ ...file, folder: "wrong" })) }), /folder/);
    assert.throws(() => validateParserResult({ ...nested, coverage: { ...nested.coverage, filesFound: 0 } }), /coverage/);
    assert.throws(() => validateParserResult({ ...nested, edges: [...nested.edges, nested.edges[0]] }), /Duplicate edges/);
    assert.throws(() => validateParserResult({ ...nested, edges: [{ source: "absent.ts", target: "empty.js", kinds: ["import"] }] }), /absent endpoint/);
    assert.throws(() => validateParserResult({ ...nested, files: nested.files.map((file) => ({ ...file, fanIn: 100 })) }), /Fan counts/);
    assert.throws(() => validateParserResult({ ...nested, coverage: { ...nested.coverage, records: [] } }), /Edge list/);
    console.log("PASS: typed JSON roundtrip and rejection of corrupt versions, folders, counts, duplicates, endpoints, fan counts, and provenance.");
  } finally {
    // Only this mkdtemp-created fixture is removed; the supplied repository is never modified.
    const resolved = path.resolve(root);
    const temporary = path.resolve(tmpdir());
    if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith("cartograph-parser-")) throw new Error("Unsafe fixture cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
}

verify().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
