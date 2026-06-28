# Challenge 1 primer — what you need to know to fix the bug

A self-contained reference for the concepts and code surface area you'll touch when solving the shape-snapping bug. Read top-to-bottom; nothing here assumes you've read the rest of the docs.

If you only remember one thing: the bug is two functions in `src/lib/geometry.ts` both treating the node as its square bounding box, when they should be treating it as the SVG outline drawn inside that box.

---

## 1. The two coordinate systems

### Flow coordinates

The "logical" canvas space. Independent of pan/zoom. A node at `position: { x: 400, y: 300 }` is at `(400, 300)` in this space, forever, regardless of what the user is looking at.

Live measured node state lives here — `src/lib/geometry.ts:17-21`:

```ts
export type MeasuredNode = Node & {
  width: number;
  height: number;
  positionAbsolute: XYPosition;
};
```

`positionAbsolute` is the node's top-left corner **in flow coordinates**. `width` and `height` are pixel sizes at zoom 1×. Together they describe the bounding box.

Use the `isMeasured()` guard before reading these — on the very first render they can be undefined.

### Screen pixels

What the browser reports in `MouseEvent.clientX/clientY`. This is what the user clicks, but it's *not* the same number as flow coordinates because the canvas can be panned and zoomed.

### The bridge: `screenToFlowPosition`

`src/App.tsx:167-168`:

```ts
const point = "changedTouches" in event ? event.changedTouches[0] : event;
const flowPos = screenToFlowPosition({ x: point.clientX, y: point.clientY });
```

After this call, `flowPos.x` / `flowPos.y` are in the same coordinate system as `positionAbsolute`, so hit-tests against the bounding box work at any zoom.

### Why this matters for the fix

Your fix lives entirely in flow coordinates. You take a measured node (flow coords) plus a `(side, pct)` and return a pixel (flow coords). You never touch `clientX/Y` directly — that conversion is already done upstream.

---

## 2. How shapes are drawn

The shape registry, `src/nodes/shapes.ts:32-39`:

```ts
export const SHAPES: Record<ShapeKind, { points: string } | { ellipse: true }> = {
  rectangle: { points: "3,3 97,3 97,97 3,97" },
  circle: { ellipse: true },
  diamond: { points: "50,3 97,50 50,97 3,50" },
  triangle: { points: "50,3 97,97 3,97" },
  hexagon: { points: "27,4 73,4 96,50 73,96 27,96 4,50" },
  star: { points: "50,3 61,35 97,35 68,57 79,91 50,70 21,91 32,57 3,35 39,35" },
};
```

Three things to internalise:

- **All shapes are authored in a `0..100 × 0..100` viewBox.** The numbers are not pixels — they're percentages of node size.
- **The SVG `<polygon>` is stretched to fit the node** (`src/nodes/ShapeNode.tsx:51`):

  ```tsx
  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
  ```

  `preserveAspectRatio="none"` means non-square nodes will squash the shape. Your geometry has to do the same — multiply the X coordinates by `width/100` and Y by `height/100`, **not** uniformly.
- **The circle is special** — `{ ellipse: true }` means "draw an ellipse filling the box". It needs different intersection maths from the polygons (parametric, not line-segment).

Two example shapes worth tracing by hand:

- `rectangle` is at 3,3 to 97,97 — a 3% margin from the bounding box. So even today's rectangle endpoints land slightly *inside* the visible square, not on it. Subtle.
- `star` has 10 points alternating between outer and inner radius. Its "left side" is jagged — there's no single clean "leftmost point at y=50".

---

## 3. The bounding box still defines "sides"

This is the most counter-intuitive part of the brief. Even when the visible shape isn't a square, the model still labels endpoints by **which side of the bounding box** they belong to.

Look at the `CustomHandle` definition, `src/nodes/shapes.ts:17-22`:

```ts
export interface CustomHandle {
  id: string;
  position: Position;   // Top | Right | Bottom | Left of the bounding box
  x: number;            // % along width (for top/bottom)
  y: number;            // % along height (for left/right)
}
```

`position` is one of four enums; there's no "diagonal side" or "this is on the third edge of the hexagon". Why? Because:

- React Flow's `<Handle>` only accepts `Position.Top | Right | Bottom | Left` — it uses that to know which direction edges should curve into.
- The handle DOM element is positioned using CSS `top: 0` / `left: 25%`, which is bounding-box terminology.

So `(side, pct)` is fundamentally a **bounding-box parameterisation** — and your fix doesn't change that. What changes is the *interpretation* of "where is the endpoint for side=top, pct=0.25?". Today: the top edge of the square. After the fix: where a vertical ray going down from the bounding-box's "top, 25% across" first hits the shape outline.

That framing — "drop a ray from the bounding-box parameterisation and find where it meets the outline" — is one valid solving strategy. There are others; see the next section.

---

## 4. The `(side, pct) → pixel` contract you have to satisfy

Two functions both implement this contract, and they must agree.

### `sideAndPctToPos(node, side, pct)` — `src/lib/geometry.ts:138-154`

Inputs: a measured node + a stored `(side, pct)`. Output: an absolute flow-coordinate pixel.

Used by `FloatingEdge.tsx:59-60` to render every edge. Runs on every edge render — performance matters a little.

### `closestSidePoint(node, cx, cy)` — `src/lib/geometry.ts:189-212`

Inputs: a measured node + a cursor position (flow coords). Output: `{ side, pct, x, y }` — which side is nearest, how far along it, and the absolute pixel of that snap point.

Used by:

- `src/edges/FloatingConnectionLine.tsx:55` — to draw the live drag-preview line.
- `src/App.tsx:180` — to decide where to create the new custom handle when the user releases.

### Why they must agree

If `closestSidePoint` snaps the cursor to (side=top, pct=0.25, x=X1, y=Y1) but `sideAndPctToPos` then computes (side=top, pct=0.25) → (X2, Y2) with X2 ≠ X1, the user drops a handle in one place and the edge renders in another. The two functions have to share their notion of "the outline".

The cleanest pattern is usually: have **one** helper that computes "the point on the outline for (side, pct)", and call it from both. The current code doesn't do this — `sideAndPctToPos` reads `nx + pct * w` directly; `closestSidePoint` clamps the cursor and picks the nearest of four candidate border points. After the fix they should converge on a common helper or, at minimum, share the same outline model.

---

## 5. The maths you'll likely write

You have two viable strategies; either works.

### Strategy A: ray-cast from the bounding-box parameterisation

Given `(side, pct)`, figure out where on the bounding box that point sits (today's behaviour), then cast a ray inward and find the first intersection with the outline.

- For side=`top`, pct=p: start at `(nx + p*w, ny)`, ray goes straight down.
- For side=`left`, pct=p: start at `(nx, ny + p*h)`, ray goes straight right.
- …and so on for right/bottom.

This preserves the existing `(side, pct)` semantics exactly — every stored handle keeps its meaning. The endpoint just moves inward to where the shape actually is.

You need a **ray–segment intersection** for each edge of the polygon, and a **ray–ellipse intersection** for the circle.

### Strategy B: parameterise along the outline directly

Drop the bounding-box framing. Treat each "side" as a chunk of the polygon's perimeter, and `pct` as a fraction along that chunk.

This is conceptually cleaner but changes the meaning of stored handles, so existing edges will move. Probably more refactoring than is needed.

**Recommendation:** start with Strategy A unless you find a clean reason not to. The brief explicitly says endpoints are "fixed `(side, percentage)`" — keeping that contract is the safer interpretation.

### The ray–segment intersection, briefly

Given a ray from point `P` in direction `D`, and a segment from `A` to `B`:

1. Parameterise the segment as `A + t*(B - A)`, `t ∈ [0, 1]`.
2. Parameterise the ray as `P + u*D`, `u ≥ 0`.
3. Solve the 2×2 linear system. If `t` is in `[0,1]` and `u ≥ 0`, you have an intersection.

For axis-aligned rays (which is what Strategy A gives you — ray goes straight down/up/left/right), this collapses to a one-dimensional clamp. For a downward ray from `(x0, y0)`:

- The segment is hit if `min(A.x, B.x) ≤ x0 ≤ max(A.x, B.x)`.
- The y of the intersection is a linear interpolation between `A.y` and `B.y` at parameter `t = (x0 - A.x) / (B.x - A.x)`.

For a polygon you compute this for every segment, keep only intersections that are *in front of* the ray's start, and pick the closest one.

### The ray–ellipse intersection

For the circle's ellipse `(x/a)² + (y/b)² = 1` (centred at origin, semi-axes `a`, `b`):

- Translate the ray into the ellipse's local space (subtract the centre).
- Substitute the ray's parametric form into the ellipse equation.
- You get a quadratic in `u`. Solve, pick the smallest non-negative root.

For an axis-aligned ray from the bounding-box "top, 50%" (which is `(centre.x, ny)` going down), there's a closed form — the intersection is just `centre.y - b * sqrt(1 - ((x-centre.x)/a)²)`. But the general ray formula is the safer thing to write so it works for non-vertical rays too if you ever generalise.

---

## 6. Scaling the polygon points

`SHAPES.points` strings are in `0..100` viewBox space. To get flow-coordinate points for a specific node, you scale each `(px, py)`:

```ts
const ax = nx + (px / 100) * w;   // nx = positionAbsolute.x, w = width
const ay = ny + (py / 100) * h;   // ny = positionAbsolute.y, h = height
```

Notes:

- The X and Y scales are **independent** (because `preserveAspectRatio="none"`). A 200×100 hexagon will look squashed; your maths must follow.
- A small helper that parses `"50,3 97,97 3,97"` into `[[50,3],[97,97],[3,97]]` and then scales it is worth writing once and reusing.
- The polygon closes implicitly — the last point connects back to the first. Iterate over `points.length` segments, with `segment i = (points[i], points[(i+1) % points.length])`.

---

## 7. Reading live node state

Three patterns you'll use:

### In a component that renders edges (reactive)

`src/edges/FloatingEdge.tsx:40`:

```ts
const sourceNode = useStore(
  useCallback((s: ReactFlowState) => s.nodeInternals.get(source), [source])
);
```

This re-renders whenever the node's measured size or position changes — exactly what we want for live drag tracking.

### In a callback (one-shot read)

`src/App.tsx:135` + `:164`:

```ts
const store = useStoreApi();
// ...
const { connectionEndHandle, nodeInternals } = store.getState();
```

No subscription, no re-renders. Used in `onConnectEnd` because the callback fires once on drop, reads state, and exits.

### The guard

`src/lib/geometry.ts:23-30` — always check before using:

```ts
export function isMeasured(node: Node | undefined): node is MeasuredNode {
  return (
    !!node &&
    typeof node.width === 'number' &&
    typeof node.height === 'number' &&
    !!node.positionAbsolute
  );
}
```

Skipping this means you'll occasionally get `NaN` on the first render of a new node, which propagates into edge paths and makes them disappear.

---

## 8. The fall-back code path you can ignore

`src/edges/FloatingEdge.tsx:65-72` has a fallback that uses `getEdgeParams` → `getNodeIntersection` → centre-to-centre bounding box maths:

```ts
} else {
  // Fallback for edges without resolvable handles.
  const params = getEdgeParams(sourceNode, targetNode);
  ...
}
```

That runs **only** when a handle id can't be resolved (e.g. an edge references a custom handle that was deleted). In normal use it never fires, and the brief calls it a fallback. You don't need to touch it for Challenge 1; only the `if (sourceSide && targetSide)` branch above it is on the hot path.

---

## 9. Common pitfalls

1. **Hardcoding the 120×120 size.** `SIZE = { width: 120, height: 120 }` in `App.tsx:32` is only the initial node style. The brief states nodes are resizable. Read `width`/`height` from the measured node, every time.

2. **Forgetting `preserveAspectRatio="none"`.** Don't scale polygon points uniformly. X and Y can stretch differently.

3. **Forgetting to fix `closestSidePoint`.** Half-fixing the bug (only `sideAndPctToPos`) means drops still snap to the bounding box, then the edge renders on the outline. The visual will be: handle gets dropped one place, edge appears somewhere else. Both functions need the new geometry.

4. **Stale measurements during resize.** If you ever add a `useResizeObserver`-style listener, remember `useUpdateNodeInternals` is also the trigger for re-measuring after a size change. The default cardinal handles' positions don't change with size (they're CSS-positioned), so the symptom is subtle: pixels are correct on first measure but stale after a resize until the next measurement.

5. **Float comparisons.** SVG points are integers like `3,3 97,3 97,97`. After scaling by `width/100` you'll get floats. Don't compare with `===` — use `Math.abs(a - b) < 1` or a tolerance epsilon for "is this point on this segment".

6. **The triangle bottom edge.** The triangle in the registry is `50,3 97,97 3,97` — apex at top, base at bottom. A drop on its "top" side has *no* outline directly below most of the time (only the apex at 50%). Decide what your maths should do: return the apex? Return the centre? The cleanest answer is usually "return the closest point on the outline to the bounding-box drop point" — which never has the "no intersection" failure mode.

---

## 10. Quick reference — the surface area

| Where | What |
|---|---|
| `src/lib/geometry.ts:138` | `sideAndPctToPos` — the function to rewrite |
| `src/lib/geometry.ts:189` | `closestSidePoint` — the other function to rewrite |
| `src/nodes/shapes.ts:32-39` | `SHAPES` registry — your source of truth for outline geometry |
| `src/lib/geometry.ts:17-30` | `MeasuredNode` + `isMeasured` — typed live node state |
| `src/edges/FloatingEdge.tsx:51-64` | Where `sideAndPctToPos` is called from |
| `src/edges/FloatingConnectionLine.tsx:54-58` | Where `closestSidePoint` is called from (preview) |
| `src/App.tsx:180-188` | Where `closestSidePoint` is called from (handle creation) |

Everything you write should keep `npm run typecheck` green. There's no test runner — the acceptance check is visual, with the "Show node bounding boxes" toggle on.
