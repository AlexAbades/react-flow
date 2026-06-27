import { useCallback, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  MarkerType,
  Panel,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Connection,
  type Edge,
  type Node,
  type OnConnectStart,
  type OnConnectEnd,
} from "reactflow";
import "reactflow/dist/style.css";

import { ShapeNode } from "./nodes/ShapeNode";
import type { CustomHandle, ShapeNodeData } from "./nodes/shapes";
import { FloatingEdge } from "./edges/FloatingEdge";
import { FloatingConnectionLine } from "./edges/FloatingConnectionLine";
import { closestSidePoint, isMeasured, SIDE_TO_POSITION } from "./lib/geometry";

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { floating: FloatingEdge };

const SIZE = { width: 120, height: 120 };

const initialNodes: Node<ShapeNodeData>[] = [
  {
    id: "rect",
    type: "shape",
    position: { x: 0, y: 20 },
    data: { label: "Rectangle", shape: "rectangle" },
    style: SIZE,
  },
  {
    id: "circle",
    type: "shape",
    position: { x: 360, y: 220 },
    data: { label: "Circle", shape: "circle" },
    style: SIZE,
  },
  {
    id: "diamond",
    type: "shape",
    position: { x: 700, y: 20 },
    data: { label: "Diamond", shape: "diamond" },
    style: SIZE,
  },
  {
    id: "triangle",
    type: "shape",
    position: { x: 60, y: 420 },
    data: { label: "Triangle", shape: "triangle" },
    style: SIZE,
  },
  {
    id: "hexagon",
    type: "shape",
    position: { x: 720, y: 380 },
    data: { label: "Hexagon", shape: "hexagon" },
    style: SIZE,
  },
  { id: "star", type: "shape", position: { x: 400, y: -80 }, data: { label: "Star", shape: "star" }, style: SIZE },
];

const baseEdge = {
  type: "floating",
  // CHALLENGE #2: edges (and their reconnect anchors) render in the SVG edge
  // layer, which sits BELOW the nodes. Where an edge meets a shape it is
  // occluded and the reconnect anchor is hard to grab. Bring the active edge
  // above the nodes (e.g. via zIndex) without breaking normal stacking.
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--edge)" },
} satisfies Partial<Edge>;

// Edges store the handle they attach to on each node. 'top' | 'right' |
// 'bottom' | 'left' are the always-present default handles; custom handles
// (created on drop) carry generated ids.
const initialEdges: Edge[] = [
  { id: "e-rect-circle", source: "rect", target: "circle", sourceHandle: "right", targetHandle: "left", ...baseEdge },
  {
    id: "e-triangle-circle",
    source: "triangle",
    target: "circle",
    sourceHandle: "right",
    targetHandle: "left",
    ...baseEdge,
  },
  {
    id: "e-circle-diamond",
    source: "circle",
    target: "diamond",
    sourceHandle: "right",
    targetHandle: "left",
    ...baseEdge,
  },
  {
    id: "e-circle-hexagon",
    source: "circle",
    target: "hexagon",
    sourceHandle: "right",
    targetHandle: "left",
    ...baseEdge,
  },
  {
    id: "e-rect-star",
    source: "rect",
    target: "star",
    sourceHandle: "right",
    targetHandle: "left",
    ...baseEdge,
  },
  {
    id: "e-star-diamond",
    source: "star",
    target: "diamond",
    sourceHandle: "right",
    targetHandle: "left",
    ...baseEdge,
  },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [showBBox, setShowBBox] = useState(false);

  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();

  // The handle a connection drag started from, captured in onConnectStart.
  const connectStart = useRef<{ nodeId: string; handleId: string } | null>(null);
  // Monotonic counter so every generated custom handle gets a unique id.
  const customHandleCount = useRef(0);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...baseEdge }, eds)),
    [setEdges],
  );

  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectStart.current =
      params.nodeId && params.handleId ? { nodeId: params.nodeId, handleId: params.handleId } : null;
  }, []);

  // When a connection is released somewhere that ISN'T an existing handle, we
  // create a real custom handle at the closest point on the target node's
  // border and connect to it. Because the handle is a fixed (side, percentage)
  // on the node, the edge stays pinned there forever — just like our app.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const start = connectStart.current;
      connectStart.current = null;
      if (!start) return;

      // If the drop landed on/near a real handle, React Flow's own onConnect
      // has already created the edge — nothing to do.
      const { connectionEndHandle, nodeInternals } = store.getState();
      if (connectionEndHandle) return;

      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const flowPos = screenToFlowPosition({ x: point.clientX, y: point.clientY });

      const target = Array.from(nodeInternals.values()).find(
        (n) =>
          isMeasured(n) &&
          flowPos.x >= n.positionAbsolute.x &&
          flowPos.x <= n.positionAbsolute.x + n.width &&
          flowPos.y >= n.positionAbsolute.y &&
          flowPos.y <= n.positionAbsolute.y + n.height,
      );
      if (!target || !isMeasured(target)) return;

      const snap = closestSidePoint(target, flowPos.x, flowPos.y);
      const isHorizontalSide = snap.side === "top" || snap.side === "bottom";
      const handleId = `custom-${target.id}-${customHandleCount.current++}`;
      const newHandle: CustomHandle = {
        id: handleId,
        position: SIDE_TO_POSITION[snap.side],
        x: isHorizontalSide ? snap.pct * 100 : 50,
        y: isHorizontalSide ? 50 : snap.pct * 100,
      };

      // Add the handle to the target node, then connect to it.
      setNodes((nds) =>
        nds.map((n) =>
          n.id === target.id ? { ...n, data: { ...n.data, handles: [...(n.data.handles ?? []), newHandle] } } : n,
        ),
      );
      onConnect({
        source: start.nodeId,
        target: target.id,
        sourceHandle: start.handleId,
        targetHandle: handleId,
      });
    },
    [screenToFlowPosition, store, setNodes, onConnect],
  );

  // --- Edge reconnection (React Flow 11.11 API) -----------------------------
  // 11.11 renamed onEdgeUpdate*/updateEdge to onReconnect*/reconnectEdge and
  // deprecated the old names.
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true;
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
    },
    [setEdges],
  );

  const onReconnectEnd = useCallback(
    (_: unknown, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
      edgeReconnectSuccessful.current = true;
    },
    [setEdges],
  );

  return (
    <div className={`flow-wrapper${showBBox ? " debug-bbox" : ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={20}
        connectionLineComponent={FloatingConnectionLine}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--grid)" />
        <Controls />
        <Panel position="top-left">
          <div className="panel">
            <h1>Shape Snapping Challenge</h1>
            <p style={{ margin: "0 0 8px" }}>Drag from one shape to another and watch where the edge attaches.</p>
            <label>
              <input type="checkbox" checked={showBBox} onChange={(e) => setShowBBox(e.target.checked)} />
              Show node bounding boxes
            </label>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
