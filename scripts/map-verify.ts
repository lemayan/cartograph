import assert from "node:assert/strict";
import path from "node:path";
import { readParserResult } from "../lib/parser/data";
import type { ParsedEdge, ParsedFile } from "../lib/parser/types";
import { foldFolders } from "../lib/map/folding";
import { layoutScene } from "../lib/map/layout";
import { countFileKinds, hoverVisibility, repositoryDetails, selectionFiles } from "../lib/map/details";
import { createHoverController, createHoverStore } from "../lib/map/hover";
import { createScene, expectedHandles, fanInHeight, fileRowHeight, panelHeaderHeight, panelRowLimit, rowHandle, rowPortTop, scrollScene, selectionDirection, selectionHighlight, selectionVisibility, uniqueLabels } from "../lib/map/scene";

function fixtureFile(filename: string): ParsedFile {
  return { path: filename, folder: path.posix.dirname(filename), extension: ".ts", lines: 1, hash: "0".repeat(64),
    module: "module", kind: null, fanIn: 0, fanOut: 0 };
}

function verifyHoverEvents(): void {
  const folders = foldFolders(["a/first.ts", "a/second.ts", "b/first.ts", "b/second.ts"].map(fixtureFile), []).folders;
  const store = createHoverStore(folders);
  const changes = new Map(folders.map((folder) => [folder.path, 0]));
  const unsubscribe = folders.map((folder) => {
    let previous = store.getFolderSnapshot(folder.path);
    return store.subscribe(() => {
      const next = store.getFolderSnapshot(folder.path);
      if (next === previous) return;
      changes.set(folder.path, (changes.get(folder.path) ?? 0) + 1);
      previous = next;
    });
  });
  store.set({ type: "file", path: "a/first.ts" });
  store.set({ type: "file", path: "a/second.ts" });
  store.set({ type: "file", path: "a/second.ts" });
  assert.deepEqual(changes, new Map([["a", 2], ["b", 0]]));
  assert.equal(store.getFolderSnapshot("b"), null, "Unrelated node snapshots must stay stable across hover");
  store.set({ type: "file", path: "b/first.ts" });
  assert.deepEqual(changes, new Map([["a", 3], ["b", 1]]));
  assert.equal(store.getFolderSnapshot("a"), null);
  store.set({ type: "folder", path: "b" });
  assert.deepEqual(store.getFolderSnapshot("b"), { type: "folder", path: "b" });
  store.set(null);
  assert.equal(store.getSnapshot(), null);
  assert.throws(() => store.set({ type: "file", path: "absent.ts" }), /absent file/);
  assert.throws(() => store.set({ type: "folder", path: "absent" }), /absent folder/);
  for (const stop of unsubscribe) stop();
  const stoppedChanges = new Map(changes);
  store.set({ type: "file", path: "a/first.ts" });
  assert.deepEqual(changes, stoppedChanges, "Unsubscribed views must not receive hover notifications");
  console.log("PASS: isolated hover store, stable unrelated folder snapshots, only previous/next owner changes, semantic deduplication and subscription cleanup.");
  const frames = new Map<number, () => void>();
  const committed: Array<{ type: "file" | "folder"; path: string } | null> = [];
  let nextFrame = 0;
  const controller = createHoverController((target) => committed.push(target), {
    request: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancel: (id) => { frames.delete(id); },
  });
  const flush = () => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  };
  const first = { type: "file" as const, path: "a/first.ts" };
  const second = { type: "file" as const, path: "a/second.ts" };
  controller.queue(first);
  controller.queue({ type: "folder", path: "a" });
  controller.queue(null);
  controller.queue(second);
  assert.equal(frames.size, 1);
  assert.equal(committed.length, 0);
  flush();
  assert.deepEqual(committed, [second], "A row-to-row move must not commit a folder/clear flash");
  controller.queue({ ...second });
  assert.equal(frames.size, 0, "Crossing text/counters in one row must not render again");
  controller.queue(null);
  controller.queue({ ...second });
  assert.equal(frames.size, 0, "Re-entering before the next frame cancels a stale clear");
  controller.queue(first);
  controller.queue({ type: "folder", path: "a" });
  flush();
  assert.deepEqual(committed.at(-1), { type: "folder", path: "a" });
  controller.queue(null);
  flush();
  assert.equal(committed.at(-1), null);
  const count = committed.length;
  controller.queue(first);
  controller.cancel();
  flush();
  assert.equal(committed.length, count, "Unmount cleanup must cancel pending hover");
  controller.queue(first);
  flush();
  assert.deepEqual(committed.at(-1), first, "The controller must survive effect cleanup/re-setup");
  console.log("PASS: hover event coalescing, semantic deduplication, no intermediate row/folder/clear flashes, stale-clear cancellation and lifecycle cleanup.");
}

function verifySelection(): void {
  const filePaths = ["a/a01.ts", "a/a02.ts", "c/c01.ts", "c/c02.ts", "d/d01.ts", "d/d02.ts",
    ...["b", "isolated"].flatMap((folder) => Array.from({ length: 14 }, (_, index) => `${folder}/${folder}${String(index + 1).padStart(2, "0")}.ts`))];
  const pairs = [
    ["a/a01.ts", "b/b01.ts"], ["d/d01.ts", "a/a01.ts"],
    ["b/b01.ts", "c/c01.ts"], ["b/b01.ts", "d/d01.ts"],
    ["a/a02.ts", "b/b02.ts"], ["b/b02.ts", "b/b01.ts"],
    ["d/d01.ts", "a/a02.ts"], ["a/a01.ts", "a/a01.ts"],
  ];
  const edges: ParsedEdge[] = pairs.map(([source, target]) => ({ source, target, kinds: ["import"] }));
  const folders = foldFolders(filePaths.map(fixtureFile), edges).folders;
  const opened = new Set(folders.map((folder) => folder.id));
  const scene = layoutScene(createScene(folders, edges, opened));
  const geometry = JSON.stringify(scene);
  const fileHighlight = selectionHighlight({ type: "file", path: "a/a01.ts" }, folders, edges);
  const visible = selectionVisibility(scene, fileHighlight);
  assert.ok(fileHighlight && visible);
  assert.deepEqual(fileHighlight.files, new Set(["a/a01.ts", "b/b01.ts", "d/d01.ts"]));
  assert.deepEqual(visible.nodes, new Set(["folder:a", "folder:b", "folder:d"]));
  assert.deepEqual(visible.rows, new Set(["a/a01.ts", "b/b01.ts", "d/d01.ts"]));
  assert.equal(visible.above.size, 0);
  assert.equal(visible.below.size, 0, "A related panel's unrelated hidden files must remain dim");
  assert.deepEqual(scene.edges.filter((edge) => visible.edges.has(edge.id)).flatMap((edge) => edge.imports)
    .map((edge) => `${edge.source} -> ${edge.target}`).sort(), [
    "a/a01.ts -> a/a01.ts", "a/a01.ts -> b/b01.ts", "d/d01.ts -> a/a01.ts",
  ]);
  // Even an edge between two bright neighbours must dim if it does not touch the selection.
  assert.ok(scene.edges.filter((edge) => edge.imports.some((pair) => pair.source === "b/b01.ts"))
    .every((edge) => !visible.edges.has(edge.id)));
  assert.deepEqual(scene.edges.map((edge) => [
    `${edge.imports[0].source} -> ${edge.imports[0].target}`, selectionDirection(edge, fileHighlight),
  ]).sort(([a], [b]) => String(a).localeCompare(String(b))), [
    ["a/a01.ts -> a/a01.ts", "both"], ["a/a01.ts -> b/b01.ts", "outgoing"],
    ["a/a02.ts -> b/b02.ts", null], ["b/b01.ts -> c/c01.ts", null],
    ["b/b01.ts -> d/d01.ts", null], ["b/b02.ts -> b/b01.ts", null],
    ["d/d01.ts -> a/a01.ts", "incoming"], ["d/d01.ts -> a/a02.ts", null],
  ]);
  assert.ok(scene.edges.every((edge) => selectionDirection(edge, null) === null));

  const folderVisible = selectionVisibility(scene, selectionHighlight({ type: "folder", path: "a" }, folders, edges));
  assert.ok(folderVisible);
  assert.deepEqual(folderVisible.nodes, new Set(["folder:a", "folder:b", "folder:d"]));
  assert.deepEqual(folderVisible.rows, new Set(["a/a01.ts", "a/a02.ts", "b/b01.ts", "b/b02.ts", "d/d01.ts"]));
  assert.equal(folderVisible.edges.size, 5);
  assert.equal(folderVisible.above.size, 0);
  assert.equal(folderVisible.below.size, 0);

  const withHiddenTarget: ParsedEdge[] = [...edges, { source: "a/a01.ts", target: "b/b14.ts", kinds: ["import"] }];
  const hiddenScene = createScene(folders, withHiddenTarget, opened);
  const hiddenVisible = selectionVisibility(hiddenScene, selectionHighlight({ type: "file", path: "a/a01.ts" }, folders, withHiddenTarget));
  assert.ok(hiddenVisible);
  assert.deepEqual(hiddenVisible.below, new Set(["folder:b"]));
  assert.ok(!hiddenVisible.rows.has("b/b14.ts"), "A hidden neighbour must not create a fictional row");
  assert.ok(hiddenScene.edges.some((edge) => hiddenVisible.edges.has(edge.id) && edge.targetHandle === "in:below"));
  const bottom = scrollScene(layoutScene(hiddenScene), withHiddenTarget, new Map([["folder:b", 48]]));
  const bottomVisible = selectionVisibility(bottom, selectionHighlight({ type: "file", path: "a/a01.ts" }, folders, withHiddenTarget));
  assert.ok(bottomVisible);
  assert.deepEqual(bottomVisible.above, new Set(["folder:b"]));
  assert.equal(bottomVisible.below.size, 0);
  assert.ok(bottomVisible.rows.has("b/b14.ts"));
  assert.ok(bottom.edges.some((edge) => edge.sourceHandle === rowHandle("out", "a/a01.ts") && edge.targetHandle === rowHandle("in", "b/b14.ts")));
  const mixedEdges: ParsedEdge[] = [...edges,
    { source: "b/b13.ts", target: "b/b14.ts", kinds: ["import"] },
    { source: "b/b14.ts", target: "b/b13.ts", kinds: ["import"] }];
  const mixedScene = createScene(folders, mixedEdges, opened);
  const mixed = mixedScene.edges.find((edge) => edge.sourceHandle === "out:below" && edge.targetHandle === "in:below");
  assert.ok(mixed);
  assert.equal(selectionDirection(mixed, selectionHighlight({ type: "file", path: "b/b14.ts" }, folders, mixedEdges)), "both");

  const isolated = selectionVisibility(scene, selectionHighlight({ type: "file", path: "isolated/isolated01.ts" }, folders, edges));
  assert.ok(isolated);
  assert.deepEqual(isolated.nodes, new Set(["folder:isolated"]));
  assert.deepEqual(isolated.rows, new Set(["isolated/isolated01.ts"]));
  assert.equal(isolated.edges.size, 0);
  assert.equal(isolated.above.size, 0);
  assert.equal(isolated.below.size, 0);
  assert.equal(selectionVisibility(scene, selectionHighlight(null, folders, edges)), null);
  assert.equal(JSON.stringify(scene), geometry, "Selecting and clearing cannot change layout or import data");
  assert.throws(() => selectionHighlight({ type: "file", path: "absent.ts" }, folders, edges), /absent file/);
  assert.throws(() => selectionHighlight({ type: "folder", path: "absent" }, folders, edges), /absent folder/);
  console.log("PASS: folder/file selection, incoming/outgoing/self imports, no second-hop highlighting, dim edges between bright neighbours, exact row/summary brightness, isolated files, clearing, and unchanged geometry.");
  console.log("PASS: exact incoming/outgoing colour classification, neutral unrelated edges, and internal/mixed bundles without a guessed direction.");
}

async function verify(): Promise<void> {
  verifyHoverEvents();
  verifySelection();
  const detailFixture = [fixtureFile("a/a.ts"), { ...fixtureFile("b/b.ts"), kind: "utility" }, fixtureFile("c/c.ts"), fixtureFile("d/d.ts")];
  const detailEdges: ParsedEdge[] = [
    { source: "a/a.ts", target: "b/b.ts", kinds: ["import", "re-export"] },
    { source: "c/c.ts", target: "b/b.ts", kinds: ["dynamic-import"] },
    { source: "b/b.ts", target: "b/b.ts", kinds: ["import"] },
  ];
  const fixtureDetails = repositoryDetails(detailFixture, detailEdges);
  assert.equal(fixtureDetails.importCount, 3);
  assert.equal(fixtureDetails.unknownCount, 3);
  assert.deepEqual(fixtureDetails.files.get("b/b.ts")?.dependents.map((file) => file.path), ["a/a.ts", "b/b.ts", "c/c.ts"]);
  assert.deepEqual(fixtureDetails.files.get("b/b.ts")?.imports.map((file) => file.path), ["b/b.ts"]);
  assert.deepEqual(fixtureDetails.startingPoints.map((item) => item.file.path), ["a/a.ts", "c/c.ts", "d/d.ts"]);
  assert.deepEqual(countFileKinds(detailFixture), [{ kind: null, count: 3 }, { kind: "utility", count: 1 }]);
  assert.throws(() => repositoryDetails(detailFixture, [...detailEdges, detailEdges[0]]), /Duplicate detail import/);
  assert.throws(() => repositoryDetails(detailFixture, [{ source: "absent.ts", target: "b/b.ts", kinds: ["import"] }]), /absent endpoint/);
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: pnpm map:verify [parser-output.json]");
  const filename = path.resolve(args[0] ?? "data/preview/excalidraw.json");
  const data = await readParserResult(filename);
  console.log(`Repository: ${data.repository}; input: ${filename}`);
  const frozen = JSON.stringify(data);
  const folded = foldFolders(data.files, data.edges);
  const details = repositoryDetails(data.files, data.edges);
  assert.equal(details.importCount, data.edges.length);
  assert.deepEqual(details, repositoryDetails([...data.files].reverse(), [...data.edges].reverse()));
  assert.equal(details.mostImported.length + details.startingPoints.length, data.files.length);
  assert.ok(details.startingPoints.every((item) => item.dependents.length === 0));
  for (let index = 1; index < details.startingPoints.length; index++) {
    const previous = details.startingPoints[index - 1];
    const current = details.startingPoints[index];
    assert.ok(previous.imports.length >= current.imports.length);
    if (previous.imports.length === current.imports.length) assert.ok(previous.file.path < current.file.path);
  }
  for (let index = 1; index < details.mostImported.length; index++) {
    assert.ok(details.mostImported[index - 1].dependents.length >= details.mostImported[index].dependents.length);
  }
  for (const file of data.files) {
    const detail = details.files.get(file.path);
    assert.ok(detail);
    assert.equal(detail.imports.length, file.fanOut);
    assert.equal(detail.dependents.length, file.fanIn);
    assert.deepEqual(detail.imports.map((item) => item.path).sort(), data.edges.filter((edge) => edge.source === file.path).map((edge) => edge.target).sort());
    assert.deepEqual(detail.dependents.map((item) => item.path).sort(), data.edges.filter((edge) => edge.target === file.path).map((edge) => edge.source).sort());
  }
  assert.equal(folded.folders.reduce((count, folder) => count + countFileKinds(folder.files).reduce((sum, kind) => sum + kind.count, 0), 0), data.files.length);
  console.log(`PASS: repository summary, full neighbour lists/counts, kinds and stable rankings; ${details.unknownCount} unknown files, ${details.startingPoints.length} starting points, ${details.mostImported.length} depended-on files.`);
  assert.ok(folded.folders.length <= 24);
  assert.ok(folded.folders.every((folder) => folder.files.length > 1));
  const paths = folded.folders.flatMap((folder) => folder.files.map((file) => file.path));
  assert.equal(paths.length, data.files.length);
  assert.equal(new Set(paths).size, data.files.length);
  assert.deepEqual([...paths].sort(), data.files.map((file) => file.path).sort());
  assert.deepEqual(foldFolders([...data.files].reverse(), [...data.edges].reverse()), folded);
  console.log(`Folded nodes: ${folded.folders.length}; files: ${paths.length}; threshold: ${folded.threshold}; files/node: ${(paths.length / folded.folders.length).toFixed(1)}`);
  console.log(`Files/node range: ${Math.min(...folded.folders.map((folder) => folder.files.length))}–${Math.max(...folded.folders.map((folder) => folder.files.length))}; singleton nodes: 0`);
  const scene = layoutScene(createScene(folded.folders, data.edges, new Set()));
  const beforeHover = JSON.stringify(scene);
  const hoveredFile = data.files[0];
  const hoverOwner = folded.folders.find((folder) => folder.files.some((file) => file.path === hoveredFile.path));
  assert.ok(hoverOwner);
  const hover = { type: "file" as const, path: hoveredFile.path };
  assert.deepEqual(selectionFiles(hover, folded.folders), new Set([hoveredFile.path]));
  assert.deepEqual(hoverVisibility(scene, hover)?.nodes, new Set([hoverOwner.id]));
  assert.equal(hoverVisibility(scene, hover)?.edges.size, 0);
  assert.deepEqual(selectionFiles({ type: "folder", path: hoverOwner.path }, folded.folders), new Set(hoverOwner.files.map((file) => file.path)));
  const hoveredPanel = layoutScene(createScene(folded.folders, data.edges, new Set([hoverOwner.id])));
  const hiddenFile = hoverOwner.files.at(-1);
  assert.ok(hiddenFile);
  const hiddenHover = { type: "file" as const, path: hiddenFile.path };
  const bottomPanel = scrollScene(hoveredPanel, data.edges, new Map([[hoverOwner.id, Number.MAX_SAFE_INTEGER]]));
  assert.ok(hoverVisibility(bottomPanel, hiddenHover)?.rows.has(hiddenFile.path));
  if (hoverOwner.files.length > panelRowLimit) assert.ok(hoverVisibility(hoveredPanel, hiddenHover)?.below.has(hoverOwner.id));
  assert.equal(hoverVisibility(scene, null), null);
  assert.throws(() => hoverVisibility(scene, { type: "file", path: "absent.ts" }), /absent file/);
  assert.equal(JSON.stringify(scene), beforeHover);
  console.log("PASS: bidirectional file/folder hover projection, folded owner and off-screen indicators, clearing, and unchanged geometry/edges.");
  const nodeIds = new Set(scene.nodes.map((node) => node.id));
  assert.ok(scene.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
  const provenance = new Set(data.edges.map((edge) => JSON.stringify([edge.source, edge.target])));
  assert.ok(scene.edges.every((edge) => edge.imports.every((original) => provenance.has(JSON.stringify([original.source, original.target])))));
  assert.deepEqual(layoutScene(createScene(folded.folders, data.edges, new Set())), scene);
  const maxX = Math.max(...scene.nodes.map((node) => node.position.x + node.width));
  const maxY = Math.max(...scene.nodes.map((node) => node.position.y + node.height));
  console.log(`Visible folded edges: ${scene.edges.length}; absent endpoints: 0; layout bounds: ${Math.ceil(maxX)} × ${Math.ceil(maxY)}`);

  for (const node of scene.nodes) {
    const selected = new Set(node.folder.files.map((file) => file.path));
    const incoming = new Set(data.edges.filter((edge) => !selected.has(edge.source) && selected.has(edge.target)).map((edge) => edge.source));
    const outgoing = new Set(data.edges.filter((edge) => selected.has(edge.source) && !selected.has(edge.target)).map((edge) => edge.target));
    assert.equal(node.folder.fanIn, incoming.size);
    assert.equal(node.folder.fanOut, outgoing.size);
    assert.equal(node.height, fanInHeight(incoming.size));
    const opened = layoutScene(createScene(folded.folders, data.edges, new Set([node.id])));
    const panel = opened.nodes.find((candidate) => candidate.id === node.id);
    assert.ok(panel);
    assert.equal(opened.nodes.length, scene.nodes.length);
    assert.equal(panel.rows.length, Math.min(panelRowLimit, node.folder.files.length));
    assert.equal(panel.hiddenFiles, node.folder.files.length - panel.rows.length);
    assert.equal(panel.allRows.length, node.folder.files.length);
    for (const edge of opened.edges) {
      const source = opened.nodes.find((candidate) => candidate.id === edge.source);
      const target = opened.nodes.find((candidate) => candidate.id === edge.target);
      assert.ok(source && target);
      assert.ok(expectedHandles(source, "out").includes(edge.sourceHandle));
      assert.ok(expectedHandles(target, "in").includes(edge.targetHandle));
    }
    const labels = opened.nodes.flatMap((candidate) => [candidate.label, ...candidate.rows.map((row) => row.label)]);
    assert.equal(new Set(labels).size, labels.length);
  }
  assert.ok(fanInHeight(1) > fanInHeight(0) && fanInHeight(100) > fanInHeight(1));
  const bothOpen = createScene(folded.folders, data.edges, new Set(scene.nodes.map((node) => node.id)));
  assert.equal(bothOpen.edges.reduce((sum, edge) => sum + edge.imports.length, 0), data.edges.length);
  assert.equal(JSON.stringify(data), frozen);
  console.log(`PASS: all ${scene.nodes.length} folders open into bounded panels; row and overflow endpoints exist; labels stay unique; fan counts are exact; all-open edges preserve all ${data.edges.length} real imports.`);

  let reached = 0;
  for (const folder of folded.folders) {
    const original = layoutScene(createScene(folded.folders, data.edges, new Set([folder.id])));
    const visited = new Set<string>();
    const originalGeometry = original.nodes.map((node) => ({ id: node.id, position: node.position, width: node.width, height: node.height }));
    const originalImports = original.edges.flatMap((edge) => edge.imports).map((edge) => JSON.stringify([edge.source, edge.target])).sort();
    for (let row = 0; row < folder.files.length; row += panelRowLimit) {
      const scrolled = scrollScene(original, data.edges, new Map([[folder.id, row * fileRowHeight]]));
      assert.deepEqual(scrolled.nodes.map((node) => ({ id: node.id, position: node.position, width: node.width, height: node.height })), originalGeometry);
      assert.deepEqual(scrolled.edges.flatMap((edge) => edge.imports).map((edge) => JSON.stringify([edge.source, edge.target])).sort(), originalImports);
      for (const node of scrolled.nodes) {
        for (const edge of scrolled.edges.filter((edge) => edge.source === node.id || edge.target === node.id)) {
          if (edge.source === node.id) assert.ok(expectedHandles(node, "out").includes(edge.sourceHandle));
          if (edge.target === node.id) assert.ok(expectedHandles(node, "in").includes(edge.targetHandle));
        }
      }
      const panel = scrolled.nodes.find((node) => node.id === folder.id);
      assert.ok(panel);
      panel.rows.forEach((row) => visited.add(row.file.path));
    }
    assert.equal(visited.size, folder.files.length, `Some files in ${folder.path} are unreachable by scrolling`);
    reached += visited.size;
    const fractional = scrollScene(original, data.edges, new Map([[folder.id, 13.5]]));
    const panel = fractional.nodes.find((node) => node.id === folder.id);
    assert.ok(panel);
    assert.ok(panel.rows.length <= panelRowLimit + 1);
    panel.rows.forEach((_, index) => {
      const top = rowPortTop(panel, panel.rowStart + index);
      assert.ok(top >= panelHeaderHeight + 2 && top <= panelHeaderHeight + panel.viewportHeight - 2);
    });
    const last = scrollScene(original, data.edges, new Map([[folder.id, Number.MAX_SAFE_INTEGER]]));
    const end = last.nodes.find((node) => node.id === folder.id);
    assert.ok(end);
    assert.equal(end.rows.at(-1)?.file.path, folder.files.at(-1)?.path);
    assert.equal(end.belowFiles, 0);
    assert.equal(end.aboveFiles + end.rows.length + end.belowFiles, folder.files.length);
  }
  console.log(`PASS: all ${reached} files reachable by scrolling; first/middle/last windows, partial-row ports, bounded panels, exact above/below counts, all edge endpoints, and unchanged layout/provenance.`);

  const fixtures = ["a/one.ts", "a/two.ts", "b/deep/three.ts", "b/other/four.ts", "root.ts"].map(fixtureFile);
  const small = foldFolders(fixtures, []);
  assert.ok(small.folders.every((folder) => folder.files.length > 1));
  assert.equal(small.folders.flatMap((folder) => folder.files).length, fixtures.length);
  const labels = uniqueLabels(["a/index.ts", "b/index.ts", "b/value.ts"]);
  assert.equal(labels.get("a/index.ts"), "a/index.ts");
  assert.equal(labels.get("b/index.ts"), "b/index.ts");
  assert.equal(labels.get("b/value.ts"), "value.ts");
  const selectedFile = data.files.find((file) => file.fanIn > 0 || file.fanOut > 0);
  assert.ok(selectedFile);
  const highlight = selectionHighlight({ type: "file", path: selectedFile.path }, folded.folders, data.edges);
  assert.ok(highlight);
  assert.ok(highlight.files.has(selectedFile.path));
  assert.equal(highlight.pairs.size, data.edges.filter((edge) => edge.source === selectedFile.path || edge.target === selectedFile.path).length);
  assert.throws(() => foldFolders(data.files, [{ source: "absent.ts", target: selectedFile.path, kinds: ["import"] }]), /absent endpoint/);
  console.log("PASS: deepest-first structural folding, root singleton handling, shortest unique labels, direct-neighbour highlighting, unchanged parser data, and loud failure on an absent endpoint.");
}

verify().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
