# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A take-home engineering exercise built on React Flow 11. The canvas renders nodes with non-rectangular SVG shapes (circle, diamond, triangle, hexagon, star, rectangle). Two challenges are wired up:

1. Edge endpoints are stored as fixed `{ side, percentage }` points on a node and currently land on the **square bounding box** rather than the **drawn shape outline**. The geometry needs to use the shape's actual outline.
2. Once Challenge 1 is fixed, endpoints sit on the shape and get occluded by the node (edges render below nodes by default). Active/hovered edges need to render above nodes so the reconnect anchor stays grabbable.

A longer narrative explanation is in `docs/GETTING_STARTED.md`; the brief lives in `README.md`.

## Commands

```bash
npm run dev         # Vite dev server (http://localhost:5173)
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && vite build
npm run preview     # serve the built bundle
```

No test runner, no linter — `typecheck` is the only static gate.

## Pinned versions — do not bump

These mirror the production app the exercise is taken from. Don't migrate.

- `reactflow ^11.10.1` (resolves to the **v11.11** line — package import is `reactflow`, not `@xyflow/react`)
- `react / react-dom ^18.2.0`
- `typescript ^5.9.3`

**Reconnection API gotcha:** v11.11 renamed `onEdgeUpdate*` / `updateEdge` to `onReconnect*` / `reconnectEdge`. The codebase uses the new names. A lot of older React Flow docs and AI suggestions still show `onEdgeUpdate` — don't reintroduce it.

## Architecture

```
src/
├─ App.tsx                       ReactFlow setup, initial nodes/edges, connect + reconnect wiring
├─ nodes/
│  ├─ ShapeNode.tsx              Renders the SVG shape + 4 cardinal handles + N custom handles
│  └─ shapes.ts                  SHAPES polygon/ellipse points (0..100 viewBox), CustomHandle type
├─ edges/
│  ├─ FloatingEdge.tsx           Custom edge between two fixed handles (Bezier path)
│  └─ FloatingConnectionLine.tsx Drag-to-connect preview line
└─ lib/
   └─ geometry.ts                Handle-id → (side, pct) → pixel; closest-side snap
```

`Floating*` names are historical — these edges are **not** floating. Each endpoint is pinned to a fixed handle.

### The connection model (the thing that's easy to misread)

- Every node has 4 always-present cardinal handles (`top`/`right`/`bottom`/`left`) at the centre of each side.
- A drop **anywhere on a side** creates a real `CustomHandle` at that exact `{ side, percentage }` on the target node (see `App.onConnectEnd`, `src/App.tsx:156`). The handle is mounted in the DOM (1×1, invisible) so React Flow can measure it and anchor an edge to it.
- Endpoints are therefore **fixed** to the node. They do not float or re-route as the node moves. This is not a floating-edge problem; it's a `(side, pct) → pixel` geometry problem.
- `ConnectionMode.Loose` is on — every handle acts as both source and target. `connectionRadius={20}` controls how close a drop must be to a default handle to reuse it; further away triggers `onConnectEnd` and a new custom handle is created.

### Where the geometry bug lives

Two functions in `src/lib/geometry.ts` both treat the node as a square:

- `sideAndPctToPos(node, side, pct)` (`geometry.ts:138`) — converts a stored fixed endpoint to absolute canvas pixels. Used by `FloatingEdge` on every render.
- `closestSidePoint(node, cx, cy)` (`geometry.ts:189`) — snaps a cursor position to the nearest border point. Used by `FloatingConnectionLine` (preview) **and** `App.onConnectEnd` (when creating a new handle).

Both must agree on "the outline", otherwise the user drops a handle in one place and the edge renders in another. The shape kind is at `node.data.shape`; the SVG geometry for each kind is `SHAPES[kind]` in `src/nodes/shapes.ts:32` (polygon `points` in a `0..100` viewBox, or `{ ellipse: true }` for the circle). Any solution must scale those by the node's **live measured** `width`/`height` from `nodeInternals` — nodes are resizable, so hardcoded constants will silently break.

### Reading measured node state

A node's real on-canvas size/position lives on its internal representation (`width`, `height`, `positionAbsolute`) from React Flow's store — not on the user-facing node. Use the `isMeasured()` type guard in `geometry.ts` before accessing them; on the very first render they can be undefined.

- Inside a component: `useStore((s) => s.nodeInternals.get(id))` (see `FloatingEdge.tsx:40`).
- Imperatively in a callback: `useStoreApi().getState().nodeInternals` (see `App.onConnectEnd`).

### When custom handles change

After mutating `node.data.handles`, the node component must call `useUpdateNodeInternals(id)` so React Flow re-measures the new DOM handle. `ShapeNode` does this in an effect keyed on `customHandles.length`. Skipping this leaves edges unable to anchor to brand-new handles.

### Challenge 2 hint

Edges render in an SVG layer below nodes. The fix is z-index/layering on the active or hovered edge so its reconnect anchor surfaces above the node — without permanently drawing every edge over everything else.

## Constraints (from the exercise brief)

- Stay inside React Flow 11. No `<canvas>` renderer, no migration to v12 / `@xyflow/react`.
- Keep TypeScript and `npm run typecheck` passing.
- Keep the visual shapes intact, but the shape definitions themselves can be reshaped if it helps the approach.
