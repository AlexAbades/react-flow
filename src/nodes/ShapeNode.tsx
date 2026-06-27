import { memo, useEffect, type CSSProperties } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import { SHAPES, type CustomHandle, type ShapeNodeData } from './shapes';

/**
 * Positions a custom handle at a percentage along one side of the node, the
 * same way React Flow positions its built-in handles. The handle is kept in
 * the DOM (so React Flow can measure it and anchor an edge to it) but is
 * visually hidden — the edge itself is what the user sees.
 */
function customHandleStyle(handle: CustomHandle): CSSProperties {
  const { position, x, y } = handle;
  const isHorizontalSide = position === Position.Top || position === Position.Bottom;
  return {
    position: 'absolute',
    width: 1,
    height: 1,
    minWidth: 0,
    minHeight: 0,
    border: 'none',
    background: 'transparent',
    opacity: 0,
    [position]: 0,
    ...(isHorizontalSide ? { left: `${x}%` } : { top: `${y}%` }),
  };
}

/**
 * A node whose outer <div> is a plain square box, but which DRAWS an arbitrary
 * shape with SVG. Four cardinal handles let connections start and end at the
 * node, while leaving the shape body free for dragging. ConnectionMode.Loose
 * means the same handles act as both source and target.
 *
 * In addition to the four cardinal handles, a node can carry any number of
 * CUSTOM handles (data.handles) created when a user drops a connection at an
 * arbitrary point on a side. Those points stay fixed to the node for good.
 */
function ShapeNodeComponent({ id, data }: NodeProps<ShapeNodeData>) {
  const shape = SHAPES[data.shape];
  const customHandles = data.handles ?? [];
  const updateNodeInternals = useUpdateNodeInternals();

  // React Flow caches handle positions; tell it to re-measure whenever the set
  // of custom handles changes, otherwise edges to new handles won't render.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, customHandles.length, updateNodeInternals]);

  return (
    <div className="shape-node">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {'ellipse' in shape ? (
          <ellipse className="shape-path" cx="50" cy="50" rx="47" ry="47" />
        ) : (
          <polygon className="shape-path" points={shape.points} />
        )}
      </svg>

      <div className="shape-label">{data.label}</div>

      {/* Cardinal handles — appear on hover, act as both source and target
          (ConnectionMode.Loose). The node body stays free for dragging. */}
      <Handle type="source" position={Position.Top} id="top" className="cardinal-handle" />
      <Handle type="source" position={Position.Right} id="right" className="cardinal-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="cardinal-handle" />
      <Handle type="source" position={Position.Left} id="left" className="cardinal-handle" />

      {/* Custom handles dropped anywhere on a side — hidden but real, so the
          edge anchored to them renders and stays put. */}
      {customHandles.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          id={handle.id}
          position={handle.position}
          style={customHandleStyle(handle)}
          isConnectable
        />
      ))}
    </div>
  );
}

export const ShapeNode = memo(ShapeNodeComponent);
