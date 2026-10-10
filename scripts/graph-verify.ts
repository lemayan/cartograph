import assert from "node:assert/strict";
import { frameworkEntryFiles } from "../lib/adapters/entry-files";
import { repositoryInsights, walkDependencies } from "../lib/graph/analysis";
import { readParserResult } from "../lib/parser/data";
import type { ParsedEdge, ParsedFile } from "../lib/parser/types";
import { categoryFiles, categoryVisibility } from "../lib/map/categories";
import { foldFolders } from "../lib/map/folding";
import { createScene, scrollScene } from "../lib/map/scene";

function file(path: string, lines = 1): ParsedFile {
  const slash = path.lastIndexOf("/");
  return { path, folder: slash < 0 ? "." : path.slice(0, slash), extension: path.slice(path.lastIndexOf(".")),
    lines, hash: "0".repeat(64), module: "module", kind: null, fanIn: 0, fanOut: 0 };
}
function edge(source: string, target: string): ParsedEdge { return { source, target, kinds: ["import"] }; }

function verifyFixtures() {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "isolated.ts"].map((path) => file(path));
  const edges = [edge("a.ts", "b.ts"), edge("a.ts", "c.ts"), edge("b.ts", "c.ts"), edge("c.ts", "a.ts"),
    edge("c.ts", "d.ts"), edge("d.ts", "e.ts"), edge("e.ts", "e.ts")];
  const before = JSON.stringify({ files, edges });
  const walk = (direction: "incoming" | "outgoing", depth = 2) => walkDependencies(files, edges, "a.ts", direction, depth)
    .map((item) => [item.file.path, item.depth]);
  assert.deepEqual(walk("outgoing"), [["b.ts", 1], ["c.ts", 1], ["d.ts", 2]]);
  assert.deepEqual(walk("incoming"), [["c.ts", 1], ["b.ts", 2]]);
  assert.deepEqual(walk("outgoing", 1), [["b.ts", 1], ["c.ts", 1]]);
  assert.deepEqual(walk("outgoing", 0), []);
  assert.deepEqual(walk("outgoing", 100), [["b.ts", 1], ["c.ts", 1], ["d.ts", 2], ["e.ts", 3]]);
  assert.deepEqual(walkDependencies(files, edges, "isolated.ts", "incoming"), []);
  assert.throws(() => walk("incoming", -1), /nonnegative/);
  assert.throws(() => walk("incoming", 1.5), /nonnegative/);
  assert.throws(() => walkDependencies(files, edges, "absent.ts", "incoming"), /absent/);
  assert.throws(() => repositoryInsights(files, [edge("a.ts", "absent.ts")], new Set()), /absent endpoint/);
  const insights = repositoryInsights(files, edges, new Set());
  assert.deepEqual(insights.cycles.map((cycle) => cycle.files.map((item) => item.path)), [["a.ts", "b.ts", "c.ts"], ["e.ts"]]);
  assert.deepEqual(insights.cycles.map((cycle) => cycle.witness), [["a.ts", "b.ts", "c.ts", "a.ts"], ["e.ts", "e.ts"]]);
  assert.deepEqual(insights, repositoryInsights([...files].reverse(), [...edges].reverse(), new Set()));
  assert.equal(JSON.stringify({ files, edges }), before);
  assert.deepEqual(repositoryInsights([], [], new Set()), { unimported: [], highlyImported: [], cycles: [], longFiles: [], averageFanIn: 0 });

  const entries = ["app/page.tsx", "src/app/api/route.ts", "apps/site/src/app/(group)/layout.tsx", "examples/site/pages/api/a.ts",
    "src/pages/index.tsx", "src/routes/users.ts", "src/middleware.ts", "proxy.ts", "next.config.ts", "tools/vite.config.mts",
    "babel.config.js", "eslint.config.mjs", ".lintstagedrc.js", ".eslintrc.cjs", ".storybook/main.ts", "dev-docs/docusaurus.config.js", "dev-docs/sidebars.js", "config.ts", "src/app/error.tsx"].map((path) => file(path));
  const ordinary = [file("src/utils/page.ts"), file("src/layout.ts"), file("src/app/helper.ts"), file("src/configuration.ts"), file("utility.ts"), file("src/sidebars.ts")];
  const exclusion = frameworkEntryFiles([...entries, ...ordinary, { ...file("custom.ts"), kind: "route" }]);
  assert.deepEqual([...exclusion].sort(), [...entries.map((item) => item.path), "custom.ts"].sort());
  assert.deepEqual(repositoryInsights([...entries, ...ordinary], [], exclusion).unimported.map((item) => item.path), ordinary.map((item) => item.path).sort());
  const thresholdFiles = [file("hub.ts", 501), file("boundary.ts", 500), ...Array.from({ length: 12 }, (_, i) => file(`consumer${i}.ts`))];
  const thresholdEdges = thresholdFiles.slice(2).map((item) => edge(item.path, "hub.ts"));
  const thresholdInsights = repositoryInsights(thresholdFiles, thresholdEdges, new Set());
  assert.deepEqual(thresholdInsights.highlyImported.map((item) => [item.file.path, item.importers]), [["hub.ts", 12]]);
  assert.deepEqual(thresholdInsights.longFiles.map((item) => item.path), ["hub.ts"]);
  assert.equal(repositoryInsights(thresholdFiles, thresholdEdges.slice(0, 9), new Set()).highlyImported.length, 0);
  const dense = Array.from({ length: 12 }, (_, i) => file(`dense${i}.ts`));
  assert.equal(repositoryInsights(dense, dense.flatMap((a) => dense.filter((b) => a !== b).map((b) => edge(a.path, b.path))), new Set()).highlyImported.length, 0);
  console.log("PASS: both walk directions, default/explicit depths, shortest-hop deduplication, cycles/self imports, disconnected files, thresholds, framework exclusions, deterministic output and unchanged input.");
}

function verifyIndependentCycles() {
  let random = 17;
  for (let sample = 0; sample < 20; sample++) {
    const files = Array.from({ length: 14 }, (_, i) => file(`f${i}.ts`));
    const edges = files.flatMap((a) => files.flatMap((b) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % 9 === 0 ? [edge(a.path, b.path)] : [];
    }));
    // Independent reachability closure, rather than repeating the SCC algorithm.
    const reachable = new Map(files.map((item) => {
      const found = new Set(edges.filter((itemEdge) => itemEdge.source === item.path).map((itemEdge) => itemEdge.target));
      for (const source of found) for (const itemEdge of edges) if (itemEdge.source === source) found.add(itemEdge.target);
      return [item.path, found] as const;
    }));
    const grouped = new Set<string>();
    const expected: string[][] = [];
    for (const item of files) {
      if (grouped.has(item.path) || !reachable.get(item.path)?.has(item.path)) continue;
      const component = files.filter((other) => reachable.get(item.path)?.has(other.path) && reachable.get(other.path)?.has(item.path)).map((other) => other.path).sort();
      component.forEach((path) => grouped.add(path));
      expected.push(component);
    }
    const actual = repositoryInsights(files, edges, new Set()).cycles;
    assert.deepEqual(actual.map((cycle) => cycle.files.map((item) => item.path)).sort(), expected.sort());
    for (const cycle of actual) {
      assert.equal(cycle.witness[0], cycle.witness.at(-1));
      for (let i = 1; i < cycle.witness.length; i++) assert.ok(edges.some((item) => item.source === cycle.witness[i - 1] && item.target === cycle.witness[i]));
    }
  }
  const deepFiles = Array.from({ length: 20000 }, (_, i) => file(`deep/${i.toString().padStart(5, "0")}.ts`));
  const chain = deepFiles.slice(1).map((item, i) => edge(deepFiles[i].path, item.path));
  assert.equal(repositoryInsights(deepFiles, chain, new Set()).cycles.length, 0);
  const deepCycle = repositoryInsights(deepFiles, [...chain, edge(deepFiles[19999].path, deepFiles[0].path)], new Set()).cycles;
  assert.equal(deepCycle.length, 1);
  assert.equal(deepCycle[0].files.length, 20000);
  assert.equal(deepCycle[0].witness.length, 20001);
  console.log("PASS: cycle groups match independent reachability on 20 graphs; 20,000-file chain and closed cycle finish without recursive stack use.");
}

async function verifySnapshot() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: pnpm graph:verify [parser-output.json]");
  if (args.length !== 1) throw new Error("Usage: pnpm graph:verify <parser-output.json>. Generate it with pnpm parser <repository-directory> --out <file.json>.");
  const result = await readParserResult(args[0]);
  const before = JSON.stringify(result);
  const entries = frameworkEntryFiles(result.files);
  const insights = repositoryInsights(result.files, result.edges, entries);
  assert.ok(insights.cycles.length > 0, "The acceptance snapshot must contain a real import cycle");
  const pairs = new Set(result.edges.map((item) => JSON.stringify([item.source, item.target])));
  const seed = insights.highlyImported[0]?.file;
  assert.ok(seed);
  for (const direction of ["incoming", "outgoing"] as const) {
    const neighbours = (path: string) => result.edges.filter((item) => (direction === "incoming" ? item.target : item.source) === path)
      .map((item) => direction === "incoming" ? item.source : item.target);
    const first = new Set(neighbours(seed.path));
    const expected = new Set([...first, ...[...first].flatMap(neighbours)]);
    expected.delete(seed.path);
    const walked = walkDependencies(result.files, result.edges, seed.path, direction);
    assert.deepEqual(new Set(walked.map((item) => item.file.path)), expected);
    assert.ok(walked.every((item) => item.depth === (first.has(item.file.path) ? 1 : 2)));
    console.log(`PASS: independent two-hop ${direction} walk for ${seed.path}: ${walked.length} files.`);
  }
  for (const cycle of insights.cycles) {
    const members = new Set(cycle.files.map((item) => item.path));
    assert.equal(cycle.witness[0], cycle.witness.at(-1));
    assert.ok(cycle.witness.every((path) => members.has(path)));
    for (let i = 1; i < cycle.witness.length; i++) {
      assert.ok(pairs.has(JSON.stringify([cycle.witness[i - 1], cycle.witness[i]])));
      assert.ok(result.coverage.records.some((record) => record.status === "resolved" && record.source === cycle.witness[i - 1] && record.target === cycle.witness[i]));
    }
  }
  assert.ok(insights.unimported.every((item) => !entries.has(item.path) && !result.edges.some((importEdge) => importEdge.target === item.path)));
  const folded = foldFolders(result.files, result.edges);
  const scene = createScene(folded.folders, result.edges, new Set(folded.folders.map((folder) => folder.id)));
  const geometry = JSON.stringify(scene);
  for (const extension of new Set(result.files.map((item) => item.extension))) {
    const matches = categoryFiles(result.files, extension);
    assert.ok(matches);
    assert.equal(folded.folders.reduce((sum, folder) => sum + folder.files.filter((item) => matches.has(item.path)).length, 0), matches.size);
    for (const offsets of [new Map<string, number>(), new Map(folded.folders.map((folder) => [folder.id, Number.MAX_SAFE_INTEGER]))]) {
      const scrolled = scrollScene(scene, result.edges, offsets);
      const visibility = categoryVisibility(scrolled, matches);
      assert.ok(visibility);
      assert.deepEqual(visibility.rows, matches);
      assert.equal(scrolled.nodes.length, folded.folders.length);
      for (const node of scrolled.nodes) {
        assert.equal(visibility.nodes.has(node.id), node.folder.files.some((item) => matches.has(item.path)));
        assert.equal(visibility.above.has(node.id), node.folder.files.slice(0, node.rowStart).some((item) => matches.has(item.path)));
        assert.equal(visibility.below.has(node.id), node.folder.files.slice(node.rowEnd).some((item) => matches.has(item.path)));
      }
      for (const importEdge of scrolled.edges) assert.equal(visibility.edges.has(importEdge.id), importEdge.imports.some((item) => matches.has(item.source) || matches.has(item.target)));
    }
  }
  assert.equal(categoryFiles(result.files, null), null);
  assert.equal(categoryVisibility(scene, null), null);
  assert.equal(categoryVisibility(scene, new Set())?.nodes.size, 0);
  assert.equal(JSON.stringify(scene), geometry);
  assert.equal(JSON.stringify(result), before);
  console.log(`PASS: ${result.repository}: ${insights.unimported.length} unimported files after entry exclusions; ${insights.highlyImported.length} highly imported; ${insights.cycles.length} cyclic groups; ${insights.longFiles.length} files over 500 lines.`);
  console.log(`PASS: all extension counts sum across ${folded.folders.length} panels; filter/clear/zero-match and first/last scroll windows preserve every node, file and import.`);
  const shortest = [...insights.cycles].sort((a, b) => a.witness.length - b.witness.length)[0];
  console.log(`Real cycle witness: ${shortest.witness.join(" -> ")}`);
  console.log(`Unimported example: ${insights.unimported[0]?.path ?? "none"}`);
  console.log(`Excluded unimported page: ${result.files.find((item) => item.path.endsWith("/page.tsx") && entries.has(item.path) && !result.edges.some((importEdge) => importEdge.target === item.path))?.path ?? "none"}`);
}

verifyFixtures();
verifyIndependentCycles();
verifySnapshot().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
