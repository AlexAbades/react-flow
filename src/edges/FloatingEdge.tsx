import { useCallback } from 'react';
import {
  BaseEdge,
  getBezierPath,
  useStore,
  type EdgeProps,
  type ReactFlowState,
} from 'reactflow';
import {
  getEdgeParams,
  getEdgePosition,
  handleToSidePct,
  isMeasured,
  sideAndPctToPos,
  SIDE_TO_POSITION,
} from '../lib/geometry';

/**
 * Custom edge that renders between two FIXED handles.
 *
 * Each endpoint is pinned to the handle stored on the edge (sourceHandleId /
 * targetHandleId) — either a default cardinal handle or a custom handle the
 * user created by dropping a connection at an arbitrary point on a side.
 * Because the position is a fixed (side, percentage), the endpoint never moves
 * relative to its node, no matter how the nodes are dragged around.
 *
 * The (side, pct) → pixel conversion is handled by sideAndPctToPos() in
 * geometry.ts, which currently maps to the rectangular bounding box. Making
 * that land on the actual drawn shape's outline is Challenge 1.
 */
export function FloatingEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(source), [source]),
  );
  const targetNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(target), [target]),
  );

  if (!isMeasured(sourceNode) || !isMeasured(targetNode)) {
    return null;
  }

  const sourceSide = handleToSidePct(sourceNode, sourceHandleId);
  const targetSide = handleToSidePct(targetNode, targetHandleId);

  let sx: number, sy: number, tx: number, ty: number;
  let sourcePos: ReturnType<typeof getEdgePosition>;
  let targetPos: ReturnType<typeof getEdgePosition>;

  if (sourceSide && targetSide) {
    const sp = sideAndPctToPos(sourceNode, sourceSide.side, sourceSide.pct);
    const tp = sideAndPctToPos(targetNode, targetSide.side, targetSide.pct);
    sx = sp.x; sy = sp.y;
    tx = tp.x; ty = tp.y;
    sourcePos = SIDE_TO_POSITION[sourceSide.side];
    targetPos = SIDE_TO_POSITION[targetSide.side];
  } else {
    // Fallback for edges without resolvable handles.
    const params = getEdgeParams(sourceNode, targetNode);
    sx = params.sx; sy = params.sy;
    tx = params.tx; ty = params.ty;
    sourcePos = params.sourcePos;
    targetPos = params.targetPos;
  }

  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{ stroke: 'var(--edge)', strokeWidth: 2, ...style }}
    />
  );
}
