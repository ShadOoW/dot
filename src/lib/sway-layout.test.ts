import { describe, expect, test } from "bun:test";
import { captureLayout, layoutCommands, applyLayout, type LayoutWorkspace } from "./sway-layout.ts";
import type { SwayNode } from "./sway.ts";

function ws(num: number | null, layout: LayoutWorkspace["layout"], nodes: LayoutWorkspace["nodes"]): LayoutWorkspace {
  return { num, layout, nodes };
}

function win(
  appId: string | null,
  widthPpt: number | null = null,
  heightPpt: number | null = null,
  conId: number | null = null,
) {
  return { kind: "window", conId, appId, widthPpt, heightPpt } as const;
}

function box(layout: "splith" | "splitv" | "tabbed" | "stacked", nodes: LayoutWorkspace["nodes"]) {
  return { kind: "container", layout, nodes } as const;
}

/**
 * Resolver over fixed tables; anything absent stands for a window sway cannot find. Capture
 * con_id wins over app_id, which is the order restore uses — a window it launched is known by
 * identity, and only an adopted one has to be matched by app_id.
 */
function resolver(table: Record<string, number>, byConId: Record<number, number> = {}) {
  return (w: { conId: number | null; appId: string | null }) =>
    (w.conId != null ? byConId[w.conId] : undefined) ?? (w.appId != null ? table[w.appId] : undefined) ?? null;
}

// ── captureLayout ────────────────────────────────────────────────────────────────────

let nextId = 100;
function node(over: Partial<SwayNode> & Pick<SwayNode, "type">): SwayNode {
  return { id: nextId++, name: null, ...over };
}

const RECT = (width: number, height: number) => ({ x: 8, y: 8, width, height });

/**
 * Trimmed from `swaymsg -t get_tree` on this host. Kept: the hidden scratchpad output, a
 * tabbed workspace of agent terminals (six reduced to two), the 70/30 split measured with two
 * probe kitties, an xwayland window that has a class but no app_id, and a focused-but-empty
 * workspace. Every rect and app_id below is as recorded.
 */
const RECORDED: SwayNode = node({
  type: "root",
  name: "root",
  layout: "splith",
  rect: RECT(1920, 1080),
  nodes: [
    node({
      type: "output",
      name: "__i3",
      layout: "output",
      rect: RECT(1920, 1080),
      nodes: [
        node({
          type: "workspace",
          name: "__i3_scratch",
          layout: "splith",
          rect: RECT(1920, 1080),
          floating_nodes: [
            node({
              type: "floating_con",
              name: "ncmpcpp",
              app_id: "music-mark",
              rect: RECT(1142, 425),
            }),
          ],
        }),
      ],
    }),
    node({
      type: "output",
      name: "DP-1",
      layout: "output",
      rect: RECT(1920, 1080),
      nodes: [
        node({
          type: "workspace",
          name: "1",
          num: 1,
          layout: "splith",
          rect: RECT(1904, 1064),
          nodes: [
            node({
              type: "con",
              layout: "tabbed",
              rect: RECT(1904, 1064),
              nodes: [
                node({
                  type: "con",
                  id: 201,
                  name: "π > List available skills",
                  app_id: "kitty",
                  rect: RECT(1904, 1036),
                }),
                node({
                  type: "con",
                  id: 202,
                  name: "π > Make a new plan",
                  app_id: "kitty",
                  rect: RECT(1904, 1036),
                }),
              ],
            }),
          ],
        }),
        node({
          type: "workspace",
          name: "2",
          num: 2,
          layout: "splith",
          rect: RECT(1904, 1064),
          nodes: [
            node({
              type: "con",
              id: 203,
              name: "probe-a",
              app_id: "probe-a",
              rect: RECT(1325, 1064),
            }),
            node({
              type: "con",
              id: 204,
              name: "probe-b",
              app_id: "probe-b",
              rect: RECT(571, 1064),
            }),
          ],
        }),
        node({
          type: "workspace",
          name: "9",
          num: 9,
          layout: "splith",
          rect: RECT(1904, 1064),
          nodes: [],
        }),
        node({
          type: "workspace",
          name: "10",
          num: 10,
          layout: "splith",
          rect: RECT(1904, 1064),
          nodes: [
            node({
              type: "con",
              layout: "tabbed",
              rect: RECT(1904, 1064),
              nodes: [
                node({
                  type: "con",
                  id: 205,
                  name: "Element | Hello",
                  rect: RECT(1904, 1036),
                  window_properties: { class: "Element", instance: "element" },
                }),
                node({
                  type: "con",
                  id: 206,
                  name: "Claude",
                  app_id: "vivaldi-Default",
                  rect: RECT(1904, 1036),
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

describe("captureLayout", () => {
  test("recorded tree → snapshot, scratchpad and empty workspaces left out", () => {
    expect(captureLayout(RECORDED)).toEqual({
      workspaces: [
        // The two terminals are indistinguishable by app_id; their con_ids are not.
        ws(1, "splith", [box("tabbed", [win("kitty", null, null, 201), win("kitty", null, null, 202)])]),
        // 1325/1904 = 70 ppt, 571/1904 = 30 ppt — the ratio the probe resize produced.
        ws(2, "splith", [win("probe-a", 70, null, 203), win("probe-b", 30, null, 204)]),
        ws(10, "splith", [
          box("tabbed", [win("Element", null, null, 205), win("vivaldi-Default", null, null, 206)]),
        ]),
      ],
    });
  });

  test("an even split carries no ppt, an uneven one does — on both axes", () => {
    // Hoisted so the expectation can name each window's real id: conId is captured from
    // node.id, and asserting it is the whole point of the field.
    const evenA = node({ type: "con", app_id: "a", rect: RECT(948, 1064) });
    const evenB = node({ type: "con", app_id: "b", rect: RECT(948, 1064) });
    const even = node({
      type: "workspace",
      name: "4",
      num: 4,
      layout: "splith",
      rect: RECT(1904, 1064),
      // 948 + 8px inner gap + 948 = 1904, so an even pair is only 49.79 of the parent rect but
      // exactly 50 of the two windows together — which is the denominator capture uses.
      nodes: [evenA, evenB],
    });
    expect(captureLayout(even).workspaces[0]!.nodes).toEqual([
      win("a", null, null, evenA.id),
      win("b", null, null, evenB.id),
    ]);

    const tallA = node({ type: "con", app_id: "a", rect: RECT(1904, 739) });
    const tallB = node({ type: "con", app_id: "b", rect: RECT(1904, 317) });
    const vertical = node({
      type: "workspace",
      name: "5",
      num: 5,
      layout: "splitv",
      rect: RECT(1904, 1064),
      // 739 + 8 + 317 = 1064: a 70/30 vertical split as sway lays it out.
      nodes: [tallA, tallB],
    });
    expect(captureLayout(vertical).workspaces[0]!.nodes).toEqual([
      win("a", null, 70, tallA.id),
      win("b", null, 30, tallB.id),
    ]);
  });

  // app_id cannot tell two terminals apart — every bare kitty os-window reports `kitty` — so
  // the con_id is the only thing that makes a captured layout replayable.
  test("windows sharing an app_id still get distinct con_ids", () => {
    const first = node({ type: "con", app_id: "kitty", rect: RECT(948, 1064) });
    const second = node({ type: "con", app_id: "kitty", rect: RECT(948, 1064) });
    const shared = node({
      type: "workspace",
      name: "6",
      num: 6,
      layout: "splith",
      rect: RECT(1904, 1064),
      nodes: [first, second],
    });
    const items = captureLayout(shared).workspaces[0]!.nodes;
    expect(items).toEqual([win("kitty", null, null, first.id), win("kitty", null, null, second.id)]);
    expect(first.id).not.toBe(second.id);
  });

  test("a lone window is never given a ppt — there is no split to restore", () => {
    const only = node({ type: "con", app_id: "org.gnome.Nautilus", rect: RECT(1904, 1064) });
    const solo = node({
      type: "workspace",
      name: "3",
      num: 3,
      layout: "splith",
      rect: RECT(1904, 1064),
      nodes: [only],
    });
    expect(captureLayout(solo).workspaces[0]!.nodes).toEqual([win("org.gnome.Nautilus", null, null, only.id)]);
  });
});

// ── layoutCommands ───────────────────────────────────────────────────────────────────

describe("layoutCommands", () => {
  test("a single window is nothing to rebuild", () => {
    expect(layoutCommands(ws(3, "splith", [win("nautilus")]), resolver({ nautilus: 11 }))).toEqual({
      commands: [],
      notes: [],
    });
  });

  test("two side by side rebuild as a split at the captured ratio", () => {
    const pair = ws(2, "splith", [win("probe-a", 70), win("probe-b", 30)]);
    expect(layoutCommands(pair, resolver({ "probe-a": 11, "probe-b": 12 }))).toEqual({
      commands: [
        "[con_id=11] focus",
        // splitv for a splith target: a wrapper matching its parent's orientation gets collapsed.
        "splitv",
        "layout splith",
        "focus parent",
        "mark --add dot:layout:1",
        "focus child",
        "[con_id=12] move container to mark dot:layout:1",
        "[con_id=11] layout splith",
        "[con_id=11] resize set width 70 ppt",
        "[con_id=12] resize set width 30 ppt",
        "unmark dot:layout:1",
      ],
      notes: [],
    });
  });

  test("a splitv pair resizes by height and wraps with splith", () => {
    const vertical = ws(5, "splitv", [win("a", null, 70), win("b", null, 30)]);
    const { commands } = layoutCommands(vertical, resolver({ a: 11, b: 12 }));
    expect(commands[1]).toBe("splith");
    expect(commands[2]).toBe("layout splitv");
    expect(commands.filter((c) => c.includes("resize"))).toEqual([
      "[con_id=11] resize set height 70 ppt",
      "[con_id=12] resize set height 30 ppt",
    ]);
  });

  test("a tabbed three: one mark, one layout, two moves, the re-assert, then cleanup", () => {
    const table = { a: 11, b: 12, c: 13 };
    const { commands, notes } = layoutCommands(ws(1, "tabbed", [win("a"), win("b"), win("c")]), resolver(table));
    expect(commands).toEqual([
      "[con_id=11] focus",
      "splitv",
      "layout tabbed",
      "focus parent",
      "mark --add dot:layout:1",
      "focus child",
      "[con_id=12] move container to mark dot:layout:1",
      "[con_id=13] move container to mark dot:layout:1",
      "[con_id=11] layout tabbed",
      "unmark dot:layout:1",
    ]);
    expect(commands.filter((c) => c.startsWith("mark --add"))).toHaveLength(1);
    expect(commands.filter((c) => c.includes("move container to mark"))).toHaveLength(2);
    // The re-assert anchors on a member, never on the container's own mark: `layout` applies to
    // the parent of whatever it matches, and traced on this host the mark-anchored form turned an
    // already-correct <tabbed>{a,b,c} into <tabbed>{<tabbed>{a,b,c}} — two stacked tab bars.
    expect(commands.some((c) => c.startsWith('[con_mark="dot:layout:1"] layout'))).toBe(false);
    // Tabs each fill the container, so nothing is resized back into place.
    expect(commands.some((c) => c.includes("resize"))).toBe(false);
    expect(notes).toEqual([]);
  });

  test("a window sway cannot resolve is skipped, and the rest still rebuilds", () => {
    const { commands, notes } = layoutCommands(
      ws(1, "tabbed", [win("a"), win("gone"), win("c")]),
      resolver({ a: 11, c: 13 }),
    );
    expect(notes).toEqual(['workspace 1: no window for app_id "gone" — skipped']);
    expect(commands).toEqual([
      "[con_id=11] focus",
      "splitv",
      "layout tabbed",
      "focus parent",
      "mark --add dot:layout:1",
      "focus child",
      "[con_id=13] move container to mark dot:layout:1",
      "[con_id=11] layout tabbed",
      "unmark dot:layout:1",
    ]);
  });

  test("losing all but one member drops the container instead of half-building it", () => {
    expect(layoutCommands(ws(1, "tabbed", [win("a"), win("gone")]), resolver({ a: 11 })).commands).toEqual([]);
  });

  test("a window with no addressable key is skipped with its own note", () => {
    const keyless = ws(7, "splith", [win(null), win("a"), win("b")]);
    const { commands, notes } = layoutCommands(keyless, resolver({ a: 11, b: 12 }));
    expect(notes).toEqual(["workspace 7: no window for a window with no app_id or con_id — skipped"]);
    expect(commands[0]).toBe("[con_id=11] focus");
    expect(commands.at(-1)).toBe("unmark dot:layout:1");
  });

  test("one nested container: built and marked before the parent moves it", () => {
    const table = { a: 11, b: 12, c: 13 };
    const { commands, notes } = layoutCommands(
      ws(1, "splith", [box("tabbed", [win("a"), win("b")]), win("c", 30)]),
      resolver(table),
    );
    expect(notes).toEqual([]);
    expect(commands).toEqual([
      "[con_id=11] focus",
      "splitv",
      "layout tabbed",
      "focus parent",
      "mark --add dot:layout:1",
      "focus child",
      "[con_id=12] move container to mark dot:layout:1",
      '[con_mark="dot:layout:1"] focus',
      "splitv",
      "layout splith",
      "focus parent",
      "mark --add dot:layout:2",
      "focus child",
      "[con_id=13] move container to mark dot:layout:2",
      "[con_id=11] layout tabbed",
      '[con_mark="dot:layout:1"] layout splith',
      "[con_id=13] resize set width 30 ppt",
      "unmark dot:layout:1",
      "unmark dot:layout:2",
    ]);
  });

  test("a container holding one window is transparent — sway would collapse it anyway", () => {
    expect(layoutCommands(ws(1, "splith", [box("tabbed", [win("a")])]), resolver({ a: 11 })).commands).toEqual([]);
  });

  test("nesting past depth 3 is noted and placed flat", () => {
    const deep = ws(1, "splith", [box("tabbed", [box("splith", [box("tabbed", [win("a"), win("b")]), win("c")])])]);
    const { commands, notes } = layoutCommands(deep, resolver({ a: 11, b: 12, c: 13 }));
    expect(notes).toEqual(["workspace 1: nesting past 3 levels — placed flat"]);
    expect(commands).toEqual([
      "[con_id=11] focus",
      "splitv",
      "layout splith",
      "focus parent",
      "mark --add dot:layout:1",
      "focus child",
      "[con_id=12] move container to mark dot:layout:1",
      "[con_id=13] move container to mark dot:layout:1",
      "[con_id=11] layout splith",
      "unmark dot:layout:1",
    ]);
  });

  test("one con_id claimed twice is placed once", () => {
    const { commands, notes } = layoutCommands(
      ws(1, "tabbed", [win("kitty"), win("kitty"), win("other")]),
      resolver({ kitty: 11, other: 12 }),
    );
    expect(notes).toEqual(['workspace 1: duplicate window for app_id "kitty" — skipped']);
    expect(commands.filter((c) => c.includes("move container to mark"))).toEqual([
      "[con_id=12] move container to mark dot:layout:1",
    ]);
  });

  test("marks restart per workspace, so two workspaces never collide mid-restore", () => {
    const table = resolver({ a: 11, b: 12 });
    const first = layoutCommands(ws(1, "tabbed", [win("a"), win("b")]), table);
    const second = layoutCommands(ws(2, "tabbed", [win("a"), win("b")]), table);
    expect(second.commands).toEqual(first.commands);
  });
});

describe("applyLayout", () => {
  test("nothing to rebuild means no sway traffic, but the notes still come back", async () => {
    const snap = { workspaces: [ws(1, "splith", [win("gone")])] };
    expect(await applyLayout(snap, () => null)).toEqual(['workspace 1: no window for app_id "gone" — skipped']);
  });
});
