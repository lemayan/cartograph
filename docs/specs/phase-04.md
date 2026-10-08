# Phase 4 — The canvas

**Goal.** The map on screen, drawn from what the parser just produced.

## Build

- Run the parser against a real repository sitting on disk and check its output
  into the project as a typed data file. This is scaffolding — it exists so the
  interface can be built without an account, a database or a network, and it
  goes away once analyses are stored properly.
- **Pick something big enough to be worth looking at.** A few hundred files,
  with real nesting and a few folders that everything leans on. A twenty-file
  repository will make the folding look like it works when it hasn't been
  tested at all.
- **Don't reshape that output to suit the canvas.** If the canvas needs
  something different, derive it. The parser's shape is the contract; bending it
  here means bending it again everywhere later.
- A preview route that renders that data through the real interface.
- **The shell, settled here and not rearranged later.** Three columns. A
  narrow rail on the left. The map filling the middle. A detail pane on the
  right. Later phases fill these; they do not move them.
- The left rail lists categories of file — a colour swatch, a name, and how many
  files are in it. Nothing happens when you click one yet.
- **Folding, and this is the rule the whole map rests on.** Every directory
  starts as its own node. Then, working from the deepest directory upward, any
  directory holding fewer than a couple of files merges into its parent. If that
  still leaves more nodes than anyone can read, raise the threshold and go
  again, stopping at the lowest threshold that lands under roughly two dozen.
  The repository's own shape decides the depth. Nothing is picked in advance.
- Clicking a folded node opens it.
- **An opened folder becomes a panel, not loose nodes.** It stays one object on
  the canvas — a bordered box with a header carrying the folder's name, how many
  files are in it, and its fan-in and fan-out — and the files appear as rows
  inside that box. When there are more rows than fit, the panel says how many
  more rather than growing without limit. Edges connect to the rows.
- A node's **height** carries how many things depend on it. Width comes from the
  label, so a long name doesn't read as an important file.
- Opening a folder refits the view so the new panel is visible.
- Clicking an open panel's header closes it back to a single node.
- **A file row inside a panel is selectable, the same as a node is.** Selecting
  either one keeps it, its edges, and whatever those edges connect to at full
  strength, and dims everything else.
- Layout is deterministic. The same data produces the same picture every time.

## Constraints

- Folding runs deepest-first, and each pass is computed fresh, so no merge at
  one depth changes what another merge at the same depth sees.
- Labels are the shortest thing that is still unique among what's on screen.
- The right pane exists as an empty column in this phase. It is not a modal, a
  drawer, or an overlay, and it does not get rebuilt or relocated later.
- **Refitting on open may only ever zoom out, never in.** Fitting to a newly
  opened panel will otherwise zoom into it and lose the rest of the graph, and
  because the refit reads the expansion state, it is easy to fit against the
  state before the change rather than after it.

## Acceptance check

**Count these and report the numbers.** No browser, no judgement.

1. Node count, under roughly two dozen, and in the region of one node per ten
   files.
2. Every node holds more than one file. Single files appearing as nodes means
   the folding rule isn't implemented, because it cannot produce that.
3. Every edge terminates on a node that exists.

**Then two of mine, five seconds each:**

4. Click a folded node. It opens into its files as rows inside the node, the
   header shows the count, edges reconnect to the rows, and clicking the header
   closes it again. **If clicking does nothing, this phase isn't done whatever
   the numbers say.**
5. The graph uses the canvas rather than huddling in a corner, and labels are
   readable without zooming.
