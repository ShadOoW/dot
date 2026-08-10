import { swayCommand, type SwayNode } from "./sway.ts";

// Capture the sway container shape of every workspace, and rebuild it on restore.
//
// Restore used to dump each saved window onto its workspace and let autotiling-rs pick the
// arrangement, so a tabbed stack of six agent terminals came back as six tiles and a 70/30
// editor-over-browser split came back even. Nothing about the tree was recorded, so nothing
// could be replayed.
//
// The seam here is deliberate. captureLayout and layoutCommands are pure: the whole rebuild
// — the mark dance, the skips, the depth cutoff — is decided in functions that return
// strings, so it is testable against a hand-built fixture with no compositor in the room.
// applyLayout is the only part that talks to sway, and it makes no decisions.

export type LayoutKind = "splith" | "splitv" | "tabbed" | "stacked";

export type LayoutItem =
  | {
      kind: "window";
      /**
       * The sway con_id this window had at capture time. It is the primary key
       * because app_id is NOT unique: every bare kitty os-window reports
       * `kitty`, so six agent terminals are indistinguishable by app_id and a
       * layout keyed on it can never rebuild the arrangement that matters most.
       * Restore maps this to the con_id of the window it launched in its place.
       */
      conId: number | null;
      appId: string | null;
      widthPpt: number | null;
      heightPpt: number | null;
    }
  | { kind: "container"; layout: LayoutKind; nodes: LayoutItem[] };

/**
 * Resolves a captured window to the live con_id standing in for it. Takes the
 * whole record so a caller can match on capture con_id first and fall back to
 * app_id for a window it adopted rather than launched.
 */
export type WindowResolver = (window: { conId: number | null; appId: string | null }) => number | null;

export interface LayoutWorkspace {
  num: number | null;
  layout: LayoutKind;
  nodes: LayoutItem[];
}

export interface LayoutSnapshot {
  workspaces: LayoutWorkspace[];
}

/**
 * A share within this much of an even split is recorded as null so restore issues no resize at
 * all. Only pixel rounding lands here — three children of a 1896px row measure 33.33 each — so
 * the window is narrow enough to leave a real 55/45 alone.
 */
const EVEN_TOLERANCE_PPT = 2;

/**
 * Deep reconstruction is where i3/sway layout restore stops being trustworthy: every extra
 * `split` + `move to mark` is another chance for autotiling-rs, or sway's own collapsing of
 * single-child containers, to reparent something, and a confidently wrong tree is worse to live
 * in than a flat one. Three levels covers every arrangement this host actually uses (workspace
 * → tabbed group → split pair). Past that we place flat, which is exactly what restore did
 * before this file existed, so the fallback is honest rather than lossy.
 */
const MAX_DEPTH = 3;

const MARK_PREFIX = "dot:layout:";

/** Sway needs a beat between insertions or a `move container to mark` lands in the old parent. */
const SETTLE_MS = 150;

function asLayoutKind(layout: string | undefined): LayoutKind {
  return layout === "splitv" || layout === "tabbed" || layout === "stacked" ? layout : "splith";
}

function children(node: SwayNode): SwayNode[] {
  return node.nodes ?? [];
}

function isContainer(node: SwayNode): boolean {
  return children(node).length > 0;
}

/**
 * Measured against the siblings' total extent, not the parent's rect, so the inner gaps cancel:
 * dividing by the parent made a restored 70/30 pair read back as 69/30, and a save → restore →
 * save cycle would have walked the ratio down a point at a time. Against the sibling sum the
 * same pair reads back 70/30, and an even pair is exactly 50 rather than 49.79.
 */
function ppt(child: number, total: number, siblings: number): number | null {
  if (!total || siblings < 2) return null;
  const value = Math.round((child / total) * 100);
  return Math.abs(value - 100 / siblings) <= EVEN_TOLERANCE_PPT ? null : value;
}

function captureItem(node: SwayNode, axis: "width" | "height" | null, total: number, siblings: number): LayoutItem {
  if (isContainer(node)) {
    return {
      kind: "container",
      layout: asLayoutKind(node.layout),
      nodes: captureItems(node),
    };
  }
  const extent = axis && node.rect ? ppt(node.rect[axis], total, siblings) : null;
  return {
    kind: "window",
    conId: node.id,
    // Xwayland windows carry no app_id — Element on this host is one — and sway addresses them
    // by class instead. Neither present means nothing sway can point at, recorded as null.
    appId: node.app_id ?? node.window_properties?.class ?? null,
    widthPpt: axis === "width" ? extent : null,
    heightPpt: axis === "height" ? extent : null,
  };
}

function captureItems(parent: SwayNode): LayoutItem[] {
  const kids = children(parent);
  const layout = asLayoutKind(parent.layout);
  // Tabbed and stacked children each fill the whole container, so their geometry says nothing
  // about the layout and resizing them on restore would be pure noise.
  const axis = layout === "splith" ? "width" : layout === "splitv" ? "height" : null;
  const total = axis ? kids.reduce((sum, kid) => sum + (kid.rect?.[axis] ?? 0), 0) : 0;
  return kids.map((kid) => captureItem(kid, axis, total, kids.length));
}

/** Pure: walks an already-fetched tree, so a recorded tree is a complete test input. */
export function captureLayout(tree: SwayNode): LayoutSnapshot {
  const workspaces: LayoutWorkspace[] = [];
  const visit = (node: SwayNode): void => {
    // `__i3_scratch` is sway's hidden scratchpad workspace; its children are floating, which is
    // not a tiling layout, and the manifest tracks the scratchpad separately anyway.
    if (node.type === "workspace") {
      if (!node.name?.startsWith("__i3") && isContainer(node)) {
        workspaces.push({
          num: node.num ?? null,
          layout: asLayoutKind(node.layout),
          nodes: captureItems(node),
        });
      }
      return;
    }
    for (const kid of children(node)) visit(kid);
  };
  visit(tree);
  return { workspaces };
}

/** A member of a group being rebuilt: how to address it, and whether it needs a resize. */
interface Member {
  selector: string;
  widthPpt: number | null;
  heightPpt: number | null;
}

interface Group {
  mark: string;
  layout: LayoutKind;
  members: Member[];
}

/**
 * Never split along the axis about to be requested. Sway collapses a fresh split container that
 * has a single child and matches its parent's orientation, and if the wrapper vanishes the
 * following `layout <kind>` retargets the workspace and the mark lands on the wrong node. The
 * working original wrapped with `splitv` before `layout tabbed` for exactly this reason.
 */
function wrapSplit(kind: LayoutKind): "splith" | "splitv" {
  return kind === "splitv" ? "splith" : "splitv";
}

/**
 * Turns one workspace's captured shape into sway commands. Executes nothing, which is what makes
 * the rebuild testable; every decision lives here rather than in applyLayout.
 */
export function layoutCommands(
  ws: LayoutWorkspace,
  conIdFor: WindowResolver,
): { commands: string[]; notes: string[] } {
  const notes: string[] = [];
  const where = `workspace ${ws.num ?? "?"}`;
  const groups: Group[] = [];
  const placed = new Set<number>();
  let marks = 0;

  const resolveWindow = (item: Extract<LayoutItem, { kind: "window" }>): Member | null => {
    const label =
      item.appId != null
        ? `app_id "${item.appId}"`
        : item.conId != null
          ? `con ${item.conId}`
          : "a window with no app_id or con_id";
    const conId = conIdFor(item);
    // A partial layout beats an aborted one, so anything sway cannot point at is dropped and the
    // rest of the sequence carries on without it.
    if (conId == null) {
      notes.push(`${where}: no window for ${label} — skipped`);
      return null;
    }
    // One live window must not stand in for two captured ones: the second placement would move a
    // window into the container it is already anchoring.
    if (placed.has(conId)) {
      notes.push(`${where}: duplicate window for ${label} — skipped`);
      return null;
    }
    placed.add(conId);
    return {
      selector: `[con_id=${conId}]`,
      widthPpt: item.widthPpt,
      heightPpt: item.heightPpt,
    };
  };

  const flatWindows = (items: LayoutItem[]): Extract<LayoutItem, { kind: "window" }>[] =>
    items.flatMap((item) => (item.kind === "window" ? [item] : flatWindows(item.nodes)));

  const resolve = (items: LayoutItem[], depth: number): Member[] => {
    const members: Member[] = [];
    for (const item of items) {
      if (item.kind === "window") {
        const member = resolveWindow(item);
        if (member) members.push(member);
        continue;
      }
      if (depth + 1 > MAX_DEPTH) {
        notes.push(`${where}: nesting past ${MAX_DEPTH} levels — placed flat`);
        for (const window of flatWindows(item.nodes)) {
          const member = resolveWindow(window);
          if (member) members.push(member);
        }
        continue;
      }
      const inner = resolve(item.nodes, depth + 1);
      // A container with one surviving child is not a real container — sway collapses those — so
      // the child stands in for it and no mark is spent.
      if (inner.length === 1) members.push(inner[0]!);
      else if (inner.length > 1) {
        const mark = `${MARK_PREFIX}${++marks}`;
        groups.push({ mark, layout: item.layout, members: inner });
        members.push({
          selector: `[con_mark="${mark}"]`,
          widthPpt: null,
          heightPpt: null,
        });
      }
    }
    return members;
  };

  // Children resolve before their parent, so a nested container is already built and marked by
  // the time the parent moves it into place.
  const top = resolve(ws.nodes, 1);
  if (top.length > 1)
    groups.push({
      mark: `${MARK_PREFIX}${++marks}`,
      layout: ws.layout,
      members: top,
    });

  const commands: string[] = [];
  for (const group of groups) {
    const [first, ...rest] = group.members;
    commands.push(
      `${first!.selector} focus`,
      wrapSplit(group.layout),
      `layout ${group.layout}`,
      "focus parent",
      `mark --add ${group.mark}`,
      "focus child",
    );
    for (const member of rest) commands.push(`${member.selector} move container to mark ${group.mark}`);
  }
  // Re-assert once every insertion is in rather than per container: autotiling-rs reacts to the
  // window events the moves generate and can toggle a split back mid-build.
  //
  // Anchored on the first member, never on the container's own mark. `layout` applies to the
  // PARENT of whatever it matches, so `[con_mark="dot:layout:1"] layout tabbed` retargets the
  // workspace, and sway expresses a tabbed workspace by inserting a container — traced on this
  // host, an already-correct `<tabbed>{a,b,c}` came back as `<tabbed>{<tabbed>{a,b,c}}`, i.e. two
  // stacked tab bars. The original in tools/workspace.ts carried that bug. Matching a child
  // instead lands on the container itself, repairs a toggled split, and is idempotent.
  for (const group of groups) commands.push(`${group.members[0]!.selector} layout ${group.layout}`);
  // In member order, which is not arbitrary. `resize set ... ppt` spreads the difference over a
  // container's other children rather than taking it from one side, so a single sweep is only
  // exact for a pair — and a pair is the split people actually notice. Measured on this host
  // against a 50/30/20 target: forward 48/31/20, forward-skipping-the-last 48/30/21, reverse
  // 50/27/22, reverse-skipping-the-first 44/30/25. Forward wins, and two windows land exactly.
  for (const group of groups) {
    for (const member of group.members) {
      if (member.widthPpt != null) commands.push(`${member.selector} resize set width ${member.widthPpt} ppt`);
      if (member.heightPpt != null) commands.push(`${member.selector} resize set height ${member.heightPpt} ppt`);
    }
  }
  // Leaving marks behind would litter the tree and collide with the next restore.
  for (const group of groups) commands.push(`unmark ${group.mark}`);

  return { commands, notes };
}

/** The settle only matters where sway reparents something. */
function isInsertion(command: string): boolean {
  return command.includes(" move container to mark ");
}

/**
 * Thin executor: feeds layoutCommands' output to sway in order and returns its notes.
 *
 * Run once, against windows restore has just placed. The planner is pure and cannot see that a
 * container already exists, so a second run on the same windows wraps them in another one —
 * verified on this host.
 */
export async function applyLayout(snap: LayoutSnapshot, conIdFor: WindowResolver): Promise<string[]> {
  const notes: string[] = [];
  for (const ws of snap.workspaces) {
    const plan = layoutCommands(ws, conIdFor);
    notes.push(...plan.notes);
    for (const command of plan.commands) {
      await swayCommand(command);
      if (isInsertion(command)) await Bun.sleep(SETTLE_MS);
    }
  }
  return notes;
}
