# Project walkthrough — how this app currently works

A guide for someone new to React Flow. Reads top-to-bottom: first the React Flow vocabulary, then how this project wires those primitives together, then where the bug lives.

---

## 1. React Flow vocabulary (the bits this project uses)

React Flow is a React library for building node-and-edge diagrams (think Miro, Figma's connector tool, a workflow editor). You give it a list of **nodes** and a list of **edges** and it renders the canvas, handles pan/zoom, drag-to-connect, selection, etc.

### Node
A box on the canvas. It has an `id`, a `position` (`{ x, y }` in canvas coordinates), `data` (anything you want), and a `type` that maps to a React component you provide. React Flow renders a wrapping `<div>` and lets you draw whatever you like inside.

Docs example:
```ts
const nodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Hello' } },
];
```

### Edge
A line between two nodes. It has `source` and `target` (node ids), optionally `sourceHandle` / `targetHandle` (which handle on each node), and a `type` mapping to an edge component.

Docs example:
```ts
const edges = [
  { id: 'e1-2', source: '1', target: '2' },
];
```

### Handle
The anchor point on a node where an edge attaches. You declare handles inside your node component:
```tsx
<Handle type="source" position={Position.Right} id="right" />
```
By default a handle is a small visible dot. The `id` is what `sourceHandle` / `targetHandle` reference on an edge. `position` (`Top|Right|Bottom|Left`) tells React Flow which side of the node it sits on — that affects how edges curve into it.

### ConnectionMode
- `Strict` (default): edges go `source → target` handles, types must match.
- `Loose`: any handle can be source or target. **This project uses Loose.**

### Custom node type
You pass `nodeTypes={{ shape: ShapeNode }}` to `<ReactFlow>`. Any node with `type: 'shape'` is rendered by your `ShapeNode` component. You get `id`, `data`, etc. as props.

### Custom edge type
Same idea: `edgeTypes={{ floating: FloatingEdge }}`. The edge component receives the resolved source/target positions and is responsible for drawing the SVG path between them. React Flow ships helpers like `getBezierPath()` so you don't compute curves by hand.

### `onConnect`, `onConnectStart`, `onConnectEnd`
The drag-to-connect lifecycle:
- `onConnectStart` — user pressed on a handle and started dragging.
- `onConnect` — fires only if they released on **another valid handle**. Gives you a `Connection` (source/target/handle ids) which you turn into a new edge.
- `onConnectEnd` — always fires when the drag ends, even if they released in empty space. **This project uses it to invent a new handle on the fly.**

### `useReactFlow` / `useStoreApi` / `useStore`
Hooks for talking to React Flow's internal store.
- `useReactFlow()` — high-level methods. This project uses `screenToFlowPosition` to convert mouse pixels into canvas coordinates.
- `useStoreApi()` — get the raw Zustand store; lets you read state imperatively (e.g. inside a callback).
- `useStore(selector)` — subscribe a component to a slice of state. `FloatingEdge` uses it to read `nodeInternals` (measured node sizes).

### `nodeInternals`
React Flow's measured view of each node: `width`, `height`, `positionAbsolute` (its real on-canvas position after parent transforms). These are only populated after the node renders once.

### `useUpdateNodeInternals(id)`
When you change a node's handles dynamically (which this project does), React Flow needs to re-measure them so it knows where to anchor edges. You call this hook after mutating handles.

### `ConnectionLineComponent`
The dashed preview line you see while dragging out a new connection (before you release). You can replace it with your own component to customise the preview — this project does, in `FloatingConnectionLine.tsx`.

### Edge reconnection (React Flow 11.11 API)
You can grab the end of an existing edge and drop it on a different handle. The relevant props on `<ReactFlow>`:
- `onReconnectStart` — drag began
- `onReconnect(oldEdge, newConnection)` — released on a valid handle; you call `reconnectEdge(...)` to update the edges list
- `onReconnectEnd` — drag ended; if not successful you typically delete the edge

(Older docs call these `onEdgeUpdate*` — that was the v11.10 name, renamed in v11.11.)

---

## 2. How this project is wired up

```
src/
├─ main.tsx                       Mounts <App/> inside <ReactFlowProvider/>
├─ App.tsx                        ReactFlow setup + connect/reconnect handlers
├─ nodes/
│  ├─ ShapeNode.tsx               The custom node component (SVG + handles)
│  └─ shapes.ts                   Shape geometry (SVG polygon points) + types
├─ edges/
│  ├─ FloatingEdge.tsx            The custom edge component (bezier path)
│  └─ FloatingConnectionLine.tsx  The drag-preview line
└─ lib/
   └─ geometry.ts                 Maths: handle id → (side, pct) → pixel
```

The names `FloatingEdge` / `FloatingConnectionLine` are historical — these edges are **not** floating. Each end is pinned to a fixed handle. The names stuck from an earlier version.

### The data model

**A node:**
```ts
{
  id: 'star',
  type: 'shape',                       // → ShapeNode component
  position: { x: 400, y: -80 },
  data: {
    label: 'Star',
    shape: 'star',                     // which SVG polygon to draw
    handles?: CustomHandle[]           // extra anchor points (see below)
  },
  style: { width: 120, height: 120 },
}
```

**A `CustomHandle`** (`src/nodes/shapes.ts:17`):
```ts
{
  id: 'custom-star-3',
  position: Position.Top,   // which side
  x: 25,                    // % along the side (for top/bottom uses x)
  y: 50,                    // % along the side (for left/right uses y)
}
```

So every connection point is a **fixed `{ side, percentage }`** stored on the node. Edges reference handles by id; given a handle id we can always recover `(side, pct)` and then compute a pixel.

**An edge:**
```ts
{
  id: 'e-rect-circle',
  source: 'rect',
  target: 'circle',
  sourceHandle: 'right',          // a default cardinal handle
  targetHandle: 'left',           // could also be 'custom-circle-7'
  type: 'floating',
  markerEnd: { type: MarkerType.ArrowClosed, ... }
}
```

### `ShapeNode` (`src/nodes/ShapeNode.tsx`)

Each node renders:
1. An `<svg>` with a `<polygon>` (or `<ellipse>` for the circle) drawn in a `0..100` viewBox, stretched to fill the wrapper `<div>`. The shape is **visual only** — it does not affect layout.
2. The label text.
3. Four **cardinal handles** (`top` / `right` / `bottom` / `left`) — always present, one at the middle of each side.
4. Zero-or-more **custom handles** from `data.handles`, each positioned with `left: X%` or `top: Y%` and styled to be 1×1 invisible (the edge endpoint is what the user actually sees).

Whenever `customHandles.length` changes, `useUpdateNodeInternals(id)` runs so React Flow re-measures handle positions.

### `App.tsx` — the connect-and-create-handle dance

This is the centrepiece. When a user drags from one node to another:

1. `onConnectStart` stashes which handle they started from in a ref.
2. They release somewhere. Two cases:
   - **On an existing handle** → React Flow's own `onConnect` fires; we just `addEdge(...)` and we're done.
   - **In empty space on a node's side** → `onConnect` does **not** fire. `onConnectEnd` runs instead.
3. In `onConnectEnd` (`App.tsx:156`):
   - Use `screenToFlowPosition` to convert the mouse pixel into canvas coords.
   - Find which node the mouse is inside (using each node's measured `positionAbsolute` + `width` / `height`).
   - Call `closestSidePoint(target, mouseX, mouseY)` → returns `{ side, pct, x, y }`.
   - Build a `CustomHandle` with that side + percentage, push it into `target.data.handles`.
   - Call `onConnect({ source, target, sourceHandle, targetHandle: newHandleId })` to create the edge.
   - On the next render `ShapeNode` mounts the new `<Handle>`, `useUpdateNodeInternals` makes React Flow measure it, and `FloatingEdge` resolves it to a pixel.

The net effect: **drop anywhere on a side and a permanent attachment point is born at that spot.** It will not float or re-route as the node moves.

### `FloatingEdge.tsx` — rendering one edge

For each edge:
1. Read the live `sourceNode` and `targetNode` from `nodeInternals` (measured sizes).
2. `handleToSidePct(node, handleId)` → resolves the handle id to `{ side, pct }`:
   - If `handleId` is `'top' | 'right' | 'bottom' | 'left'` → that side, `pct = 0.5`.
   - Otherwise look it up in `node.data.handles` and read `x` (top/bottom) or `y` (left/right) as the percentage.
3. `sideAndPctToPos(node, side, pct)` → converts to absolute `{ x, y }` pixels on the canvas. **This is the function that contains the bug.**
4. Feed those pixels into `getBezierPath()` and render `<BaseEdge>`.

If a handle can't be resolved, there's a fallback to `getEdgeParams()` which uses the old "intersect the line between centres with the bounding box" trick. In normal use it never runs.

### `FloatingConnectionLine.tsx` — the drag preview

While the user is dragging out a new connection (before release), this component draws the dashed preview line. It finds the node currently under the cursor and calls `closestSidePoint()` to snap the line's end to the nearest border point. This is the **second place** that uses bounding-box maths and will need updating alongside `sideAndPctToPos`.

### `geometry.ts` — the maths layer

Two functions matter:

**`sideAndPctToPos(node, side, pct)` (`geometry.ts:138`)** — given a fixed `(side, pct)`, return its absolute pixel. Used by `FloatingEdge` for every render of every edge. Currently:
```ts
case 'top':    return { x: nx + pct * w, y: ny };
case 'bottom': return { x: nx + pct * w, y: ny + h };
case 'left':   return { x: nx,           y: ny + pct * h };
case 'right':  return { x: nx + w,       y: ny + pct * h };
```
This is the **bounding-box square**. For a circle/diamond/triangle/hexagon/star the point lands on the invisible square, floating off the visible outline.

**`closestSidePoint(node, cx, cy)` (`geometry.ts:189`)** — given the mouse position, find the nearest point on the node's border. Used by both:
- `FloatingConnectionLine` (the live drag preview), and
- `App.onConnectEnd` (deciding where to create the new handle).

This too uses the square bounding box. If you only fix `sideAndPctToPos`, the user will drop a handle at one place and the edge will render at a slightly different place. So both need to agree on "the shape's outline".

---

## 3. The bug, in one sentence

Both `sideAndPctToPos` and `closestSidePoint` treat the node as its bounding-box **square**, but the visible shape (drawn as an SVG `<polygon>` or `<ellipse>` inside that square) is usually smaller and differently-shaped. The fix is to make both functions use **the actual drawn outline** — defined by `SHAPES[node.data.shape]` in `nodes/shapes.ts` — when resolving a `(side, pct)` to a pixel and when snapping a cursor to a border.

The shape definitions live in `src/nodes/shapes.ts:32`:
```ts
rectangle: { points: '3,3 97,3 97,97 3,97' },
circle:    { ellipse: true },
diamond:   { points: '50,3 97,50 50,97 3,50' },
triangle:  { points: '50,3 97,97 3,97' },
hexagon:   { points: '27,4 73,4 96,50 73,96 27,96 4,50' },
star:      { points: '50,3 61,35 97,35 68,57 79,91 50,70 21,91 32,57 3,35 39,35' },
```
All in a `0..100` viewBox. They get stretched to fill `node.width × node.height` at render time. Any solution to Challenge 1 has to do the same scaling when computing outline points in absolute canvas coords.

There's a second issue (Challenge 2) — once endpoints land **on** the shape instead of beyond it, they get drawn under the node (because edges render below nodes by default). The reconnect anchor becomes hard to grab. That's a z-ordering fix, separate from the geometry.

---

## 4. Where to read next

- `App.tsx:147-204` — the connect-end + onConnect flow (where new custom handles are born)
- `FloatingEdge.tsx:31-91` — the per-edge render path
- `geometry.ts:138-154` — `sideAndPctToPos` (Challenge 1 ground zero)
- `geometry.ts:189-212` — `closestSidePoint` (the live-preview half of Challenge 1)
- `nodes/shapes.ts:32-39` — the actual SVG geometry to snap onto
