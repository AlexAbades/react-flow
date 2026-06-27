import { Position, type Node, type XYPosition } from 'reactflow';
import { isDefaultHandleId, type ShapeNodeData } from '../nodes/shapes';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDE_TO_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * A node as React Flow tracks it internally: it always has a measured width,
 * height and an absolute position once it has been rendered.
 */
export type MeasuredNode = Node & {
  width: number;
  height: number;
  positionAbsolute: XYPosition;
};

export function isMeasured(node: Node | undefined): node is MeasuredNode {
  return (
    !!node &&
    typeof node.width === 'number' &&
    typeof node.height === 'number' &&
    !!node.positionAbsolute
  );
}

function center(node: MeasuredNode): XYPosition {
  return {
    x: node.positionAbsolute.x + node.width / 2,
    y: node.positionAbsolute.y + node.height / 2,
  };
}

/**
 * Floating-edge intersection: the point where the straight line between the two
 * node centres crosses the border of `intersectionNode`.
 *
 * This is only a FALLBACK now — it runs when an edge references a handle that
 * can't be resolved (see FloatingEdge). The normal render path uses fixed
 * handles via sideAndPctToPos() below. Like everything here it currently uses
 * the rectangular bounding box.
 */
export function getNodeIntersection(
  intersectionNode: MeasuredNode,
  targetNode: MeasuredNode,
): XYPosition {
  const w = intersectionNode.width / 2;
  const h = intersectionNode.height / 2;
  const c1 = center(intersectionNode);
  const c2 = center(targetNode);

  // --- Rectangular bounding-box intersection (the thing to replace) --------
  const xx1 = (c2.x - c1.x) / (2 * w) - (c2.y - c1.y) / (2 * h);
  const yy1 = (c2.x - c1.x) / (2 * w) + (c2.y - c1.y) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return {
    x: w * (xx3 + yy3) + c1.x,
    y: h * (-xx3 + yy3) + c1.y,
  };
}

/**
 * Which side of the node's box the intersection point is closest to. Used only
 * to give the bezier curve a sensible direction to leave/enter the node.
 */
export function getEdgePosition(
  node: MeasuredNode,
  point: XYPosition,
): Position {
  const nx = Math.round(node.positionAbsolute.x);
  const ny = Math.round(node.positionAbsolute.y);
  const px = Math.round(point.x);
  const py = Math.round(point.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + node.width - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + node.height - 1) return Position.Bottom;
  return Position.Top;
}

export interface EdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

/** Endpoints + directions for an edge drawn between two nodes. */
export function getEdgeParams(
  source: MeasuredNode,
  target: MeasuredNode,
): EdgeParams {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}

/* ===========================================================================
 * 🟥  CHALLENGE #1 — PROBABLY STARTS HERE  🟥
 *
 * This is our best guess at where the fix goes, not a spec. If you find a
 * cleaner approach or decide the real fix belongs elsewhere, go for it — we're
 * pointing you at a starting line, not boxing you in.
 *
 * Every edge endpoint is a FIXED point on a node: a side (top/right/bottom/left)
 * plus a fraction (0–1) along that side. sideAndPctToPos() turns that stored
 * point back into absolute canvas coordinates so the edge can render, and the
 * point never moves relative to the node, no matter how nodes are dragged.
 *
 * RIGHT NOW it maps onto the node's rectangular bounding box. That is the bug:
 * for a circle, diamond, triangle, hexagon or star the endpoint sits on the
 * invisible square, floating off the drawn outline. The goal is to make it land
 * on the actual drawn shape. The shape kind is available at `node.data.shape`.
 *
 * The live drag preview uses closestSidePoint() below (also bounding-box based),
 * so a complete solution will usually want to touch that too.
 * (Maths reference: https://reactflow.dev/examples/edges/floating-edges)
 * ======================================================================== */
export function sideAndPctToPos(
  node: MeasuredNode,
  side: string,
  pct: number,
): XYPosition {
  const nx = node.positionAbsolute.x;
  const ny = node.positionAbsolute.y;
  const w = node.width;
  const h = node.height;
  switch (side) {
    case 'top':    return { x: nx + pct * w, y: ny };
    case 'bottom': return { x: nx + pct * w, y: ny + h };
    case 'left':   return { x: nx,           y: ny + pct * h };
    case 'right':  return { x: nx + w,       y: ny + pct * h };
    default:       return { x: nx + w / 2,   y: ny + h / 2 };
  }
}

/**
 * Resolves a stored handle id on `node` to {side, pct}.
 *
 * - A default handle ('top'|'right'|'bottom'|'left') sits at the centre of its
 *   side, so pct = 0.5.
 * - A custom handle is looked up in node.data.handles; its percentage along the
 *   side is read from x (top/bottom) or y (left/right).
 *
 * Returns null if the handle can't be found.
 */
export function handleToSidePct(
  node: MeasuredNode,
  handleId: string | null | undefined,
): { side: Side; pct: number } | null {
  if (!handleId) return null;

  if (isDefaultHandleId(handleId)) {
    return { side: handleId, pct: 0.5 };
  }

  const custom = (node.data as ShapeNodeData).handles?.find((h) => h.id === handleId);
  if (!custom) return null;

  const side = custom.position as Side;
  const pct = side === 'left' || side === 'right' ? custom.y / 100 : custom.x / 100;
  return { side, pct };
}

/**
 * Given a cursor position (cx, cy), find the closest point on the node's
 * bounding-box border and return it as a {side, pct, x, y}.  Used by the
 * connection-line preview so the user can place an edge anywhere on any side.
 */
export function closestSidePoint(
  node: MeasuredNode,
  cx: number,
  cy: number,
): { side: 'top' | 'right' | 'bottom' | 'left'; pct: number; x: number; y: number } {
  const nx = node.positionAbsolute.x;
  const ny = node.positionAbsolute.y;
  const w = node.width;
  const h = node.height;

  const clampedX = Math.max(nx, Math.min(nx + w, cx));
  const clampedY = Math.max(ny, Math.min(ny + h, cy));

  const candidates: { side: 'top' | 'right' | 'bottom' | 'left'; pct: number; x: number; y: number }[] = [
    { side: 'left',   x: nx,     y: clampedY, pct: (clampedY - ny) / h },
    { side: 'right',  x: nx + w, y: clampedY, pct: (clampedY - ny) / h },
    { side: 'top',    x: clampedX, y: ny,     pct: (clampedX - nx) / w },
    { side: 'bottom', x: clampedX, y: ny + h, pct: (clampedX - nx) / w },
  ];

  return candidates.reduce((best, c) =>
    Math.hypot(c.x - cx, c.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? c : best,
  );
}
