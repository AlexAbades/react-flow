# `useStore` vs `useStoreApi`

React Flow exposes two ways to talk to its internal state, and the difference between them matters more than it looks.

Under the hood React Flow uses **Zustand** (a state-management library) for everything: the list of nodes/edges, their measured sizes, the current zoom/pan, what's being dragged, etc. These two hooks give you two different ways to talk to that store.

## `useStore(selector)` — reactive subscription

You pass a function that picks a slice of state. Your component **re-renders whenever that slice changes**.

```ts
const sourceNode = useStore(
  useCallback((s: ReactFlowState) => s.nodeInternals.get(source), [source])
);
```

That's from `src/edges/FloatingEdge.tsx:40`. Every time the source node's measured size or position changes (e.g. the user drags it), this hook re-fires and the edge re-renders with the new endpoint. That's exactly what you want for rendering — the edge must follow the node live.

**Key properties:**

- Triggers re-renders.
- Should return a small slice, not the whole state, or every state change re-renders you for no reason.
- Wrap the selector in `useCallback` so it's referentially stable (Zustand uses reference identity to decide if the selector changed).
- Subject to a shallow-equality check by default — return a primitive or a stable reference if you can.

Other examples you'd see in the wild:

```ts
const zoom = useStore((s) => s.transform[2]);              // current zoom factor
const nodeCount = useStore((s) => s.nodeInternals.size);   // re-render when count changes
const isInteractive = useStore((s) => s.nodesDraggable);
```

## `useStoreApi()` — imperative handle

Returns the **store object itself**, not the state. To read state, you call `.getState()`. It is **not reactive** — it does not subscribe you to anything.

```ts
const store = useStoreApi();
// ...later, inside a callback:
const { connectionEndHandle, nodeInternals } = store.getState();
```

That's from `src/App.tsx:135` + `:164`. The callback runs once per user gesture (when a drag ends), reads the current state, and is done. Subscribing to the whole `nodeInternals` map for that would be wasteful — we don't need re-renders, we need a one-shot read at the moment the callback fires.

**Key properties:**

- No re-renders, ever.
- You get a **stable** reference (same object every render), so it's safe to list in dependency arrays.
- You can also call `.setState(...)` and `.subscribe(...)` on it, though you rarely need to from inside React.

## The decision rule

| Situation                                                              | Use                              |
| ---------------------------------------------------------------------- | -------------------------------- |
| You need to **render** something based on store state                  | `useStore(selector)`             |
| You need to **read state inside a callback/effect** on a user action   | `useStoreApi()` + `.getState()`  |
| You want to react to a **specific** changing value                     | `useStore` with a narrow selector |
| You want the **whole** state once, with no subscription cost           | `useStoreApi()`                  |

A useful gut check: **if the answer is "it changes but I don't need to react to it", use `useStoreApi`.** If the answer is "it changes and the UI must follow", use `useStore`.

## Why both exist in this project

- `FloatingEdge` **must** re-render when nodes move → `useStore` selecting that node's internals.
- `App.onConnectEnd` runs once per drop, then exits. It just needs to know the current state at that instant → `useStoreApi().getState()`.

If you flipped them, two bad things happen:

- Using `useStoreApi` in `FloatingEdge` would mean edges never update when nodes move (no subscription).
- Using `useStore(s => s.nodeInternals)` in `App` would re-render the entire app on every node measurement, just to keep one callback's closure fresh — wasteful, and React Flow measures nodes a lot.

## A common helper pattern

For state you read in callbacks but **also** want to subscribe to selectively, people sometimes use both:

```ts
function MyEdge() {
  const someNode = useStore((s) => s.nodeInternals.get(id));  // for rendering
  const store = useStoreApi();                                 // for reading other slices on click
  const onClick = () => {
    const everythingElse = store.getState();
    // ...
  };
}
```

That's the canonical "render with `useStore`, react to events with `useStoreApi`" split.

## The full store, briefly

`ReactFlowState` exposes a lot — the ones you'll most commonly touch:

| Field                                       | What it is                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `nodeInternals`                             | `Map<nodeId, internalNode>` — measured nodes with `width`, `height`, `positionAbsolute` |
| `edges`                                     | The edges list                                                                          |
| `transform`                                 | `[x, y, zoom]` — current pan + zoom                                                     |
| `connectionEndHandle`                       | The handle a connection drag ended on (or `null` if it ended in empty space)            |
| `connectionNodeId` / `connectionHandleId`   | What a connection drag started from                                                     |
| `domNode`                                   | The wrapping DOM element of the flow                                                    |

You'll see the project read `nodeInternals` and `connectionEndHandle` already. The rest are there when you need them.
