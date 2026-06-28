import { Position, type Node, type XYPosition } from 'reactflow';
import { isDefaultHandleId, SHAPES, type ShapeKind, type ShapeNodeData } from '../nodes/shapes';

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
 * Outline-aware geometry
 *
 * Endpoints are stored as a fixed (side, pct) on the bounding box. To make
 * them land on the drawn shape rather than the square, we cast a ray from
 * the bounding-box parameterisation INWARD (perpendicular to the side) and
 * find the first intersection with the shape outline.
 *
 * `sideAndPctToPos` and `closestSidePoint` share one helper (`rayToOutline`)
 * so they stay consistent — whatever `closestSidePoint` snaps to during a
 * drop, `sideAndPctToPos` produces the same pixel when the edge later
 * renders.
 * ======================================================================== */

type Vertex = [number, number]; // (x, y) in the 0..100 viewBox
type RayDirection = 'down' | 'up' | 'left' | 'right';

const SIDE_TO_RAY: Record<Side, RayDirection> = {
  top: 'down',
  bottom: 'up',
  left: 'right',
  right: 'left',
};

// The circle node draws <ellipse cx=50 cy=50 rx=47 ry=47> in the 0..100 viewBox.
const CIRCLE_RADIUS_FRAC = 0.47;

// Polygon point strings never change, so parse them once per shape kind.
const polygonCache = new Map<ShapeKind, Vertex[]>();
function getPolygonPoints(kind: ShapeKind): Vertex[] | null {
  const def = SHAPES[kind];
  if ('ellipse' in def) return null;
  let cached = polygonCache.get(kind);
  if (!cached) {
    cached = def.points
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number) as Vertex);
    polygonCache.set(kind, cached);
  }
  return cached;
}

interface RayHit {
  x: number;
  y: number;
  dist: number;
}

function intersectRayWithSegment(
  rx: number,
  ry: number,
  dir: RayDirection,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): RayHit | null {
  if (dir === 'down' || dir === 'up') {
    if (ax === bx) return null; // segment parallel to ray
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    if (rx < minX || rx > maxX) return null;
    const t = (rx - ax) / (bx - ax);
    const y = ay + t * (by - ay);
    const dist = dir === 'down' ? y - ry : ry - y;
    if (dist < 0) return null;
    return { x: rx, y, dist };
  }
  if (ay === by) return null;
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  if (ry < minY || ry > maxY) return null;
  const t = (ry - ay) / (by - ay);
  const x = ax + t * (bx - ax);
  const dist = dir === 'right' ? x - rx : rx - x;
  if (dist < 0) return null;
  return { x, y: ry, dist };
}

function intersectRayWithEllipse(
  rx: number,
  ry: number,
  dir: RayDirection,
  cx: number,
  cy: number,
  a: number, // semi-axis x
  b: number, // semi-axis y
): RayHit | null {
  if (dir === 'down' || dir === 'up') {
    const dx = rx - cx;
    const inside = 1 - (dx * dx) / (a * a);
    if (inside < 0) return null;
    const off = b * Math.sqrt(inside);
    const y1 = cy - off; // top of ellipse at this x
    const y2 = cy + off; // bottom of ellipse at this x
    if (dir === 'down') {
      if (y1 >= ry) return { x: rx, y: y1, dist: y1 - ry };
      if (y2 >= ry) return { x: rx, y: y2, dist: y2 - ry };
      return null;
    }
    if (y2 <= ry) return { x: rx, y: y2, dist: ry - y2 };
    if (y1 <= ry) return { x: rx, y: y1, dist: ry - y1 };
    return null;
  }
  const dy = ry - cy;
  const inside = 1 - (dy * dy) / (b * b);
  if (inside < 0) return null;
  const off = a * Math.sqrt(inside);
  const x1 = cx - off;
  const x2 = cx + off;
  if (dir === 'right') {
    if (x1 >= rx) return { x: x1, y: ry, dist: x1 - rx };
    if (x2 >= rx) return { x: x2, y: ry, dist: x2 - rx };
    return null;
  }
  if (x2 <= rx) return { x: x2, y: ry, dist: rx - x2 };
  if (x1 <= rx) return { x: x1, y: ry, dist: rx - x1 };
  return null;
}

/**
 * Cast a ray from (startX, startY) on the bounding box, perpendicular to a
 * side, and return the first point it meets on the drawn outline. Falls back
 * to the start point if the shape is unknown or no intersection exists, so
 * the worst-case is the old bounding-box behaviour — never NaN.
 */
function rayToOutline(
  node: MeasuredNode,
  startX: number,
  startY: number,
  dir: RayDirection,
): XYPosition {
  const shapeKind = (node.data as ShapeNodeData).shape;
  const def = SHAPES[shapeKind];
  const nx = node.positionAbsolute.x;
  const ny = node.positionAbsolute.y;
  const w = node.width;
  const h = node.height;

  if ('ellipse' in def) {
    const hit = intersectRayWithEllipse(
      startX,
      startY,
      dir,
      nx + w * 0.5,
      ny + h * 0.5,
      w * CIRCLE_RADIUS_FRAC,
      h * CIRCLE_RADIUS_FRAC,
    );
    return hit ? { x: hit.x, y: hit.y } : { x: startX, y: startY };
  }

  const pts = getPolygonPoints(shapeKind);
  if (!pts) return { x: startX, y: startY };

  let best: RayHit | null = null;
  for (let i = 0; i < pts.length; i++) {
    const [pax, pay] = pts[i];
    const [pbx, pby] = pts[(i + 1) % pts.length];
    const ax = nx + (pax / 100) * w;
    const ay = ny + (pay / 100) * h;
    const bx = nx + (pbx / 100) * w;
    const by = ny + (pby / 100) * h;
    const hit = intersectRayWithSegment(startX, startY, dir, ax, ay, bx, by);
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }

  return best ? { x: best.x, y: best.y } : { x: startX, y: startY };
}

function isSide(s: string): s is Side {
  return s === 'top' || s === 'right' || s === 'bottom' || s === 'left';
}

function bboxStartPoint(
  node: MeasuredNode,
  side: Side,
  pct: number,
): { startX: number; startY: number } {
  const nx = node.positionAbsolute.x;
  const ny = node.positionAbsolute.y;
  const w = node.width;
  const h = node.height;
  switch (side) {
    case 'top':    return { startX: nx + pct * w, startY: ny };
    case 'bottom': return { startX: nx + pct * w, startY: ny + h };
    case 'left':   return { startX: nx,           startY: ny + pct * h };
    case 'right':  return { startX: nx + w,       startY: ny + pct * h };
  }
}

/**
 * Convert a stored (side, pct) endpoint to a pixel on the shape's outline.
 */
export function sideAndPctToPos(
  node: MeasuredNode,
  side: string,
  pct: number,
): XYPosition {
  if (!isSide(side)) {
    return {
      x: node.positionAbsolute.x + node.width / 2,
      y: node.positionAbsolute.y + node.height / 2,
    };
  }
  const { startX, startY } = bboxStartPoint(node, side, pct);
  return rayToOutline(node, startX, startY, SIDE_TO_RAY[side]);
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
 * Given a cursor (cx, cy), find the closest point on the drawn outline and
 * report it as {side, pct, x, y}. `pct` stays a fraction along the
 * bounding-box side so the result round-trips back through sideAndPctToPos
 * exactly — the snap point during a drop matches the rendered endpoint.
 */
export function closestSidePoint(
  node: MeasuredNode,
  cx: number,
  cy: number,
): { side: Side; pct: number; x: number; y: number } {
  const nx = node.positionAbsolute.x;
  const ny = node.positionAbsolute.y;
  const w = node.width;
  const h = node.height;

  const clampedX = Math.max(nx, Math.min(nx + w, cx));
  const clampedY = Math.max(ny, Math.min(ny + h, cy));

  const candidates: { side: Side; pct: number }[] = [
    { side: 'left',   pct: (clampedY - ny) / h },
    { side: 'right',  pct: (clampedY - ny) / h },
    { side: 'top',    pct: (clampedX - nx) / w },
    { side: 'bottom', pct: (clampedX - nx) / w },
  ];

  let best: { side: Side; pct: number; x: number; y: number } | null = null;
  let bestDist = Infinity;

  for (const cand of candidates) {
    const { startX, startY } = bboxStartPoint(node, cand.side, cand.pct);
    const hit = rayToOutline(node, startX, startY, SIDE_TO_RAY[cand.side]);
    const d = Math.hypot(hit.x - cx, hit.y - cy);
    if (d < bestDist) {
      bestDist = d;
      best = { side: cand.side, pct: cand.pct, x: hit.x, y: hit.y };
    }
  }

  return best!;
}
