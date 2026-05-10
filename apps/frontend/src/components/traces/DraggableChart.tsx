"use client";

import { useEffect, useRef, useState } from "react";
import { A2UIChart } from "./A2UIChart";
import type { PinnedChart } from "@/lib/traces/types";

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

type Props = {
  pinned: PinnedChart;
  initialPos: Pos;
  initialSize?: Size;
  onClose: () => void;
};

const MIN_W = 240;
const MIN_H = 160;

// Floating, draggable, resizable card. Position + size are local to this
// component — they don't round-trip to agent state, which keeps drag smooth
// and avoids spamming Command(update=) on every pointermove.
//
// Drag: pointer events on the header. We use setPointerCapture so the
// pointer doesn't get hijacked by other elements (e.g. iframes inside
// kind="html" cards).
//
// Resize: a small handle in the bottom-right. Same pointer-capture trick.

export function DraggableChart({
  pinned,
  initialPos,
  initialSize,
  onClose,
}: Props) {
  const [pos, setPos] = useState<Pos>(initialPos);
  const [size, setSize] = useState<Size>(
    initialSize ?? defaultSizeFor(pinned),
  );

  const dragOriginRef = useRef<Pos | null>(null);
  const resizeOriginRef = useRef<{ pos: Pos; size: Size } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Keep card on-screen if the viewport shrinks under it.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampPos(p, size, cardRef.current?.parentElement));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size]);

  // -------- drag handlers (header) ----------------------------------------
  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragOriginRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragPointerMove = (e: React.PointerEvent) => {
    if (!dragOriginRef.current) return;
    const next = {
      x: e.clientX - dragOriginRef.current.x,
      y: e.clientY - dragOriginRef.current.y,
    };
    setPos(clampPos(next, size, cardRef.current?.parentElement));
  };
  const onDragPointerUp = (e: React.PointerEvent) => {
    dragOriginRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // -------- resize handlers (bottom-right grip) ---------------------------
  const onResizePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeOriginRef.current = { pos: { x: e.clientX, y: e.clientY }, size };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeOriginRef.current) return;
    const dx = e.clientX - resizeOriginRef.current.pos.x;
    const dy = e.clientY - resizeOriginRef.current.pos.y;
    setSize({
      w: Math.max(MIN_W, resizeOriginRef.current.size.w + dx),
      h: Math.max(MIN_H, resizeOriginRef.current.size.h + dy),
    });
  };
  const onResizePointerUp = (e: React.PointerEvent) => {
    resizeOriginRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  return (
    <div
      ref={cardRef}
      className="pointer-events-auto absolute overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
    >
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] text-zinc-300"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        <span className="flex items-center gap-2 truncate">
          <span
            className={`h-2 w-2 rounded-full ${
              pinned.kind === "html"
                ? "bg-fuchsia-400"
                : pinned.kind === "a2ui"
                  ? "bg-emerald-400"
                  : "bg-zinc-500"
            }`}
          />
          <span className="font-mono text-zinc-400">
            {pinned.kind}
            {pinned.name ? `: ${pinned.name}` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="h-[calc(100%-29px)] overflow-auto p-3">
        <CardBody pinned={pinned} />
      </div>

      <div
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        aria-label="Resize"
      >
        {/* Visual grip — tiny diagonal lines */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className="text-zinc-600"
        >
          <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" />
          <line x1="11" y1="7" x2="7" y2="11" stroke="currentColor" />
        </svg>
      </div>
    </div>
  );
}

function CardBody({ pinned }: { pinned: PinnedChart }) {
  if (pinned.kind === "html" && pinned.html) {
    return (
      <iframe
        sandbox=""
        srcDoc={pinned.html}
        className="h-full w-full rounded border border-zinc-800 bg-white"
        title="open generative UI"
      />
    );
  }
  if (pinned.kind === "a2ui") {
    return <A2UIChart name={pinned.name} props={pinned.props} />;
  }
  return (
    <pre className="overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
      {JSON.stringify({ name: pinned.name, props: pinned.props }, null, 2)}
    </pre>
  );
}

function defaultSizeFor(pinned: PinnedChart): Size {
  if (pinned.kind === "html") return { w: 380, h: 280 };
  if (pinned.kind === "a2ui" && pinned.name === "donut")
    return { w: 320, h: 220 };
  if (pinned.kind === "a2ui" && pinned.name === "line")
    return { w: 380, h: 220 };
  // bar / fallback
  return { w: 360, h: 240 };
}

function clampPos(
  next: Pos,
  size: Size,
  parent: HTMLElement | null | undefined,
): Pos {
  if (!parent) return next;
  const rect = parent.getBoundingClientRect();
  return {
    x: Math.min(Math.max(0, next.x), Math.max(0, rect.width - size.w)),
    y: Math.min(Math.max(0, next.y), Math.max(0, rect.height - size.h)),
  };
}
