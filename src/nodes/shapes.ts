import type { Position } from "reactflow";

/**
 * All shapes are authored in a 0..100 x 0..100 coordinate space and stretched
 * to fill the node. Add more shapes here if you like — the more awkward the
 * shape, the better the test.
 */
export type ShapeKind = "rectangle" | "circle" | "diamond" | "triangle" | "hexagon" | "star";

/**
 * A connection point placed anywhere on a side of a node.  `x`/`y` are
 * percentages (0–100) of the node's width/height.  For top/bottom handles the
 * `x` percentage runs along the width; for left/right handles the `y`
 * percentage runs along the height.  These are created on the fly when a user
 * drops a connection at a spot that isn't one of the four default handles.
 */
export interface CustomHandle {
  id: string;
  position: Position;
  x: number;
  y: number;
}

export interface ShapeNodeData {
  label: string;
  shape: ShapeKind;
  /** Extra handles created where the user dropped a connection. */
  handles?: CustomHandle[];
}

/** SVG polygon/ellipse geometry in the 0..100 viewBox. */
export const SHAPES: Record<ShapeKind, { points: string } | { ellipse: true }> = {
  rectangle: { points: "3,3 97,3 97,97 3,97" },
  circle: { ellipse: true },
  diamond: { points: "50,3 97,50 50,97 3,50" },
  triangle: { points: "50,3 97,97 3,97" },
  hexagon: { points: "27,4 73,4 96,50 73,96 27,96 4,50" },
  star: { points: "50,3 61,35 97,35 68,57 79,91 50,70 21,91 32,57 3,35 39,35" },
};

/** The four always-present handle IDs, one at the centre of each side. */
export const DEFAULT_HANDLE_IDS = ["top", "right", "bottom", "left"] as const;
export type DefaultHandleId = (typeof DEFAULT_HANDLE_IDS)[number];

export function isDefaultHandleId(id: string | null | undefined): id is DefaultHandleId {
  return id === "top" || id === "right" || id === "bottom" || id === "left";
}
