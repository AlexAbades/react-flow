import { useCallback } from 'react';
import {
  getBezierPath,
  useStore,
  type ConnectionLineComponentProps,
  type ReactFlowState,
} from 'reactflow';
import {
  closestSidePoint,
  isMeasured,
  SIDE_TO_POSITION,
  type MeasuredNode,
} from '../lib/geometry';

/**
 * The line drawn while dragging out a new connection.
 *
 * Source end: fromX/fromY — the handle the user grabbed.
 *
 * Target end: snaps to the closest point on the hovered node's border, which
 * can be ANYWHERE on any side (not just the four cardinal handles). This is a
 * preview of where onConnectEnd will drop a custom handle, so what you see is
 * what you get.
 */
export function FloatingConnectionLine({
  fromX,
  fromY,
  fromPosition,
  fromNode,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  const nodes = useStore(
    useCallback(
      (s: ReactFlowState) => Array.from(s.nodeInternals.values()),
      [],
    ),
  );

  const hoveredNode = nodes
    .filter((n): n is MeasuredNode => isMeasured(n) && n.id !== fromNode?.id)
    .find(
      (n) =>
        toX >= n.positionAbsolute.x &&
        toX <= n.positionAbsolute.x + n.width &&
        toY >= n.positionAbsolute.y &&
        toY <= n.positionAbsolute.y + n.height,
    );

  let endX = toX;
  let endY = toY;
  let targetPos;

  if (hoveredNode) {
    const snap = closestSidePoint(hoveredNode, toX, toY);
    endX = snap.x;
    endY = snap.y;
    targetPos = SIDE_TO_POSITION[snap.side];
  }

  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: endX,
    targetY: endY,
    targetPosition: targetPos,
  });

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="var(--edge)"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      <circle cx={endX} cy={endY} r={3} fill="var(--edge)" />
    </g>
  );
}
