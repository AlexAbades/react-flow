# Custom handles — a walkthrough

Custom handles are the most subtle thing in this codebase — they're the mechanism that lets a user drop a connection anywhere on a side and have it stick. This walks one through its full lifecycle, all grounded in real code.

## What a custom handle is, structurally

`src/nodes/shapes.ts:17-22`:

```ts
export interface CustomHandle {
  id: string;
  position: Position;
  x: number;
  y: number;
}
```

Four fields:

- **`id`** — unique per node. The edges list references it via `targetHandle` (or `sourceHandle`).
- **`position`** — which side of the node it's on (`Top | Right | Bottom | Left`). React Flow uses this to know which direction edges should curve into.
- **`x`** — for top/bottom handles, the **percentage along the width** (0–100).
- **`y`** — for left/right handles, the **percentage along the height** (0–100).

Only one of `x`/`y` is "the percentage along the side" — the other is unused for that handle. The convention: for top/bottom you use `x`; for left/right you use `y`. You can see this convention applied in two places:

- When creating the handle (`src/App.tsx:185-188`):

  ```ts
  const newHandle: CustomHandle = {
    id: handleId,
    position: SIDE_TO_POSITION[snap.side],
    x: isHorizontalSide ? snap.pct * 100 : 50,
    y: isHorizontalSide ? 50 : snap.pct * 100,
  };
  ```

  The "other" axis gets a placeholder `50` — it never gets read.

- When reading it back (`src/lib/geometry.ts:180`):

  ```ts
  const pct = side === 'left' || side === 'right' ? custom.y / 100 : custom.x / 100;
  ```

  Picks `y` for left/right, `x` for top/bottom.

## Where they live

A node carries them on its `data`. `src/nodes/shapes.ts:24-29`:

```ts
export interface ShapeNodeData {
  label: string;
  shape: ShapeKind;
  /** Extra handles created where the user dropped a connection. */
  handles?: CustomHandle[];
}
```

Optional and starts undefined. The initial nodes in `src/App.tsx:34-71` don't have any — every initial edge uses the four built-in cardinal handles (`top|right|bottom|left`). Custom handles only appear once the user drops a connection.

## The lifecycle, step by step

### Step 1: User drags from somewhere

`src/App.tsx:147-150`:

```ts
const onConnectStart: OnConnectStart = useCallback((_event, params) => {
  connectStart.current =
    params.nodeId && params.handleId ? { nodeId: params.nodeId, handleId: params.handleId } : null;
}, []);
```

React Flow tells us which handle the user grabbed; we stash it in a ref. Note this is a `useRef`, not state — we don't want a re-render here, we just need to remember it until the drag ends.

### Step 2: User drops in empty space on a node's side

When the user releases, React Flow first checks if the drop landed on a real handle. If it did, **`onConnect` fires** and we just `addEdge` (`src/App.tsx:142-145`). The user never sees a custom handle get created — they reused an existing one.

If the drop is in empty space, **`onConnect` doesn't fire** — only `onConnectEnd` does. That's the trigger for inventing a new handle. `src/App.tsx:156-204`:

```ts
const onConnectEnd: OnConnectEnd = useCallback(
  (event) => {
    const start = connectStart.current;
    connectStart.current = null;
    if (!start) return;

    // If the drop landed on/near a real handle, React Flow's own onConnect
    // has already created the edge — nothing to do.
    const { connectionEndHandle, nodeInternals } = store.getState();
    if (connectionEndHandle) return;
    ...
```

Notice `connectionEndHandle` is read from the store. React Flow sets it when a drop snaps onto an existing handle (within `connectionRadius={20}` of one). If it's non-null, `onConnect` already handled it; we bail out.

### Step 3: Find which node the cursor is over

`src/App.tsx:167-178`:

```ts
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
```

Two things to notice:

- The `changedTouches` check handles touch events as well as mouse events.
- The hit-test uses the **bounding box** (`positionAbsolute` + `width`/`height`) — this is fine for "are you inside this node?" but it's the same square-vs-shape mismatch that Challenge 1 will eventually surface here too. If the user drops just outside the visible shape but inside the box, we'll happily attach to it.

### Step 4: Snap the drop point to a side

`src/App.tsx:180`:

```ts
const snap = closestSidePoint(target, flowPos.x, flowPos.y);
```

`closestSidePoint` (`src/lib/geometry.ts:189-212`) returns `{ side, pct, x, y }` — which side is closest, and how far along it. **This is the function that also has the bounding-box bug** — it computes against the square, not the shape. So a fix for Challenge 1 also lives here.

### Step 5: Build the handle and add it to the node

`src/App.tsx:181-195`:

```ts
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
```

Three details worth noting:

- The id pattern `custom-${target.id}-${n}` is just a convention for human-readable debugging — React Flow only requires it to be unique per node.
- `customHandleCount` is a `useRef` (`src/App.tsx:140`) — a monotonic counter that survives re-renders. Using component state would cause an extra render per increment.
- The state update is immutable (`{ ...n, data: { ...n.data, handles: [...] } }`). React Flow needs new object identities at each level to detect the change.

### Step 6: Connect to the brand-new handle

`src/App.tsx:196-201`:

```ts
onConnect({
  source: start.nodeId,
  target: target.id,
  sourceHandle: start.handleId,
  targetHandle: handleId,
});
```

We call our own `onConnect` (defined at `src/App.tsx:142-145`), which just `addEdge`s. The edge now references a handle id that **doesn't exist in the DOM yet** — `setNodes` only just queued the update.

This is fine because React batches the two state updates, the next render mounts the handle in the DOM, then React Flow re-measures and the edge resolves.

### Step 7: The handle gets mounted

`src/nodes/ShapeNode.tsx:70-79`:

```tsx
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
```

A real React Flow `<Handle>` — same primitive as the four cardinals, just declared dynamically. The style (`src/nodes/ShapeNode.tsx:11-26`) makes it 1×1 and invisible, positioned by percentage:

```ts
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
```

Three properties matter:

- `position: 'absolute'` and `[position]: 0` (the dynamic property, e.g. `top: 0`) — pin the handle flush with that side of the box.
- The CSS percentage (`left: 25%`) — places it along the side.
- Visually invisible — the edge endpoint is what the user actually sees. The handle is just a DOM anchor for React Flow's measurement.

### Step 8: Tell React Flow to re-measure

`src/nodes/ShapeNode.tsx:41-47`:

```ts
const updateNodeInternals = useUpdateNodeInternals();

// React Flow caches handle positions; tell it to re-measure whenever the set
// of custom handles changes, otherwise edges to new handles won't render.
useEffect(() => {
  updateNodeInternals(id);
}, [id, customHandles.length, updateNodeInternals]);
```

React Flow measures handles when a node first mounts and caches the results. If you add a handle later, you must call `useUpdateNodeInternals` or it'll never know the new one exists — edges referencing it will silently fail to render. The effect keys on `customHandles.length` so it fires once per addition.

### Step 9: The edge resolves and draws

Once the handle is in the DOM and re-measured, `src/edges/FloatingEdge.tsx:51-64` finally renders the line:

```ts
const sourceSide = handleToSidePct(sourceNode, sourceHandleId);
const targetSide = handleToSidePct(targetNode, targetHandleId);

if (sourceSide && targetSide) {
  const sp = sideAndPctToPos(sourceNode, sourceSide.side, sourceSide.pct);
  const tp = sideAndPctToPos(targetNode, targetSide.side, targetSide.pct);
  ...
}
```

`handleToSidePct` (`src/lib/geometry.ts:166-182`) is the inverse of step 5 — given a handle id, recover the `{ side, pct }`:

```ts
if (isDefaultHandleId(handleId)) {
  return { side: handleId, pct: 0.5 };
}

const custom = (node.data as ShapeNodeData).handles?.find((h) => h.id === handleId);
if (!custom) return null;

const side = custom.position as Side;
const pct = side === 'left' || side === 'right' ? custom.y / 100 : custom.x / 100;
return { side, pct };
```

Then `sideAndPctToPos` (`src/lib/geometry.ts:138-154`) maps `{ side, pct }` to a pixel — the same function whether the handle is a custom one or a cardinal. **This is the core insight**: from the geometry layer's perspective, **custom handles are not special**. A cardinal handle is just `(side, 0.5)`; a custom handle is `(side, anything)`. Same maths, same code path.

## Why this design is interesting

Three subtle wins worth pointing out:

1. **The geometry doesn't know about custom handles.** `sideAndPctToPos` takes `(side, pct)`, full stop. Cardinal handles are just the special case `pct = 0.5`. That's why fixing Challenge 1 fixes both default and custom endpoints at once — one function to repair, not two.

2. **The handle is a real DOM node, not a virtual one.** The custom handle is mounted as a `<Handle>` element (`src/nodes/ShapeNode.tsx:70-79`), measured by React Flow, and behaves identically to a cardinal handle for downstream code. That's why the edge can anchor to it without any custom-edge logic — React Flow doesn't even know it was created at runtime.

3. **The data is immutable and survives serialisation.** `node.data.handles` is just plain JSON-able data. If you wanted to persist a diagram to a backend, the custom handles serialise with the rest of the node — no extra side channel.

## Common confusion: "is the custom handle position the source of truth?"

Yes. After step 5, the edge in `edges` references `targetHandle: 'custom-circle-7'`. The pixel on screen is **derived** from `node.data.handles[i].x` (or `y`) every render via `handleToSidePct` → `sideAndPctToPos`. Move the node, drag it, zoom in: the stored percentage doesn't change, but the computed pixel does. That's why the bug only requires fixing `sideAndPctToPos` — there is no second place that stores absolute pixels for the handle.

## The bug's footprint, summarised

When Challenge 1 is fixed, the custom-handle flow will keep working — only two functions need to change:

- `sideAndPctToPos` (`src/lib/geometry.ts:138`) — used to render edges (so every existing custom handle "moves" onto the shape outline).
- `closestSidePoint` (`src/lib/geometry.ts:189`) — used both in `FloatingConnectionLine` for the live preview and in `App.onConnectEnd` (step 4 above) for deciding where to place a new handle.

Everything else — the data shape, the DOM mounting, the re-measure, the edge rendering — stays exactly as it is.
