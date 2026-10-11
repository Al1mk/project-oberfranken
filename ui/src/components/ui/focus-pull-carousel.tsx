"use client"

import * as React from "react"

/*
 * Focus Pull Carousel — a horizontal image strip that racks focus like a
 * camera lens. The picture in the centre is sharp and full size; its
 * neighbours soften, shrink and fade by how far they sit from the middle, and
 * everything changes continuously as you scroll, swipe or drag.
 *
 * Built on native scroll snapping, so trackpads, touch momentum and the
 * keyboard all behave like the platform. Slides without an `image` get a
 * painted landscape, so it works with no assets at all.
 */

export type LandPalette = "dawn" | "alpine" | "dusk" | "mist"

export type Slide = {
  image?: string
  title?: string
  caption?: string
  alt?: string
  /** Palette and seed of the painted landscape used when `image` is empty. */
  palette?: LandPalette
  seed?: number
}

export type FocusPullCarouselProps = {
  slides?: Slide[]
  /** Any CSS length. Default 100svh. */
  height?: number | string
  /** Width of one picture, any CSS length. */
  cardWidth?: string
  /** CSS aspect-ratio of a picture. */
  aspect?: string
  /** Blur in px at one card away from the centre. 0 turns the focus pull off. */
  blur?: number
  /** ms per slide; 0 turns autoplay off. It waits while someone is interacting. */
  autoplay?: number
  /** Page colours: background and ink. Defaults follow the theme tokens. */
  background?: string
  ink?: string
  onChange?: (index: number) => void
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  /** Labels for the controls and the screen-reader announcement. */
  labels?: {
    previous: string
    next: string
    show: (title: string) => string
    status: (current: number, total: number, title: string) => string
  }
}

// #region logic
/** How out of focus a card is, from its offset to the centre in card widths. */
export function focusOf(d: number, blur: number) {
  const a = Math.min(Math.abs(d), 1)
  return {
    scale: 1 - 0.14 * a,
    blur: Math.min(Math.abs(d), 2) * blur,
    opacity: 1 - 0.5 * a,
    saturate: 1 - 0.45 * a,
  }
}

/** Index of the centre nearest to c. */
export function nearestIndex(centers: number[], c: number): number {
  let best = 0
  for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i]! - c) < Math.abs(centers[best]! - c)) best = i
  return best
}

export function wrap(i: number, n: number): number {
  return n ? ((i % n) + n) % n : 0
}

export function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n)
}
// #endregion logic

/* ------------------------------------------------------- painted images */

const PALETTES = {
  dawn: { top: "#e7b7a5", bottom: "#f8e8d6", sun: "#fff4df", far: "#d2b2bb", near: "#3a2a3b", mist: "255,240,232" },
  alpine: { top: "#7ea5c8", bottom: "#e3ecf2", sun: "#ffffff", far: "#a9bfd0", near: "#1c3044", mist: "236,244,250" },
  dusk: { top: "#2a2450", bottom: "#ef8d60", sun: "#ffd9a6", far: "#93607c", near: "#18121f", mist: "255,196,160" },
  mist: { top: "#c4d0cb", bottom: "#eef1ec", sun: "#ffffff", far: "#aebcb5", near: "#2c3a33", mist: "246,248,245" },
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.replace("#", ""), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function mixRgb(a: string, b: string, t: number): string {
  const A = hexRgb(a)
  const B = hexRgb(b)
  return "rgb(" + A.map((v, i) => Math.round(v + (B[i]! - v) * t)).join(",") + ")"
}

// A layered-ridge landscape: sky, a low sun, five ridges fading into haze with
// mist between them, a tree line on the nearest, film grain. Painted once.
function paintLandscape(seed: number, palette: LandPalette, w = 1600, h = 1000): string {
  if (typeof document === "undefined") return ""
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const g = c.getContext("2d")
  if (!g) return ""
  const P = PALETTES[palette] ?? PALETTES.dawn
  const r = mulberry32(seed * 104729 + 7)

  const sky = g.createLinearGradient(0, 0, 0, h * 0.72)
  sky.addColorStop(0, P.top)
  sky.addColorStop(1, P.bottom)
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  const sx = w * (0.22 + r() * 0.56)
  const sy = h * (0.26 + r() * 0.16)
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.45)
  halo.addColorStop(0, "rgba(" + hexRgb(P.sun).join(",") + ",.85)")
  halo.addColorStop(0.08, "rgba(" + hexRgb(P.sun).join(",") + ",.55)")
  halo.addColorStop(1, "rgba(" + hexRgb(P.sun).join(",") + ",0)")
  g.fillStyle = halo
  g.fillRect(0, 0, w, h)
  g.fillStyle = P.sun
  g.beginPath()
  g.arc(sx, sy, h * 0.045, 0, Math.PI * 2)
  g.fill()

  const layers = 5
  for (let L = 0; L < layers; L++) {
    const k = L / (layers - 1)
    const base = h * (0.42 + k * 0.4)
    const amp = h * (0.07 + k * 0.1)
    const ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2)
    const fr = [1.3 + r(), 3.1 + r() * 2, 7 + r() * 4, 17 + r() * 8]
    const ridge = (x: number) => {
      const u = x / w
      return (
        base -
        amp *
          (0.55 * Math.sin(u * fr[0]! + ph[0]!) +
            0.28 * Math.sin(u * fr[1]! + ph[1]!) +
            0.12 * Math.abs(Math.sin(u * fr[2]! + ph[2]!)) +
            0.05 * Math.sin(u * fr[3]! + ph[3]!))
      )
    }
    const mist = g.createLinearGradient(0, base - amp * 1.4, 0, base + amp * 0.4)
    mist.addColorStop(0, "rgba(" + P.mist + ",0)")
    mist.addColorStop(1, "rgba(" + P.mist + "," + (0.55 - k * 0.35).toFixed(2) + ")")
    g.fillStyle = mist
    g.fillRect(0, base - amp * 1.4, w, amp * 1.8)
    const body = g.createLinearGradient(0, base - amp, 0, h)
    body.addColorStop(0, mixRgb(P.far, P.near, Math.pow(k, 1.3)))
    body.addColorStop(1, mixRgb(P.far, P.near, Math.min(1, Math.pow(k, 1.3) + 0.18)))
    g.fillStyle = body
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 6) g.lineTo(x, ridge(x))
    g.lineTo(w, h)
    g.closePath()
    g.fill()
    if (L >= layers - 2) {
      g.fillStyle = mixRgb(P.far, P.near, Math.min(1, Math.pow(k, 1.3) + 0.08))
      for (let x = 0; x < w; x += 7 + r() * 9) {
        if (r() < 0.35) continue
        const y = ridge(x) + 2
        const th = h * (0.025 + r() * 0.035) * (0.6 + k)
        const tw = th * 0.32
        g.beginPath()
        g.moveTo(x, y - th)
        g.lineTo(x + tw, y)
        g.lineTo(x - tw, y)
        g.closePath()
        g.fill()
      }
    }
  }

  const vig = g.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h / 2, w * 0.78)
  vig.addColorStop(0, "rgba(0,0,0,0)")
  vig.addColorStop(1, "rgba(0,0,0,.32)")
  g.fillStyle = vig
  g.fillRect(0, 0, w, h)
  const grain = g.getImageData(0, 0, w, h)
  const d = grain.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * 14
    d[i] = d[i]! + v
    d[i + 1] = d[i + 1]! + v
    d[i + 2] = d[i + 2]! + v
  }
  g.putImageData(grain, 0, 0)
  return c.toDataURL("image/jpeg", 0.88)
}

const DEFAULT_SLIDES: Slide[] = [
  { title: "First Light", caption: "Haze lifting off the eastern ridges.", palette: "dawn", seed: 3 },
  { title: "High Pass", caption: "Cold air, clear to the far range.", palette: "alpine", seed: 8 },
  { title: "Ember Hour", caption: "The last of the sun on the valley floor.", palette: "dusk", seed: 14 },
  { title: "Still Valley", caption: "Morning mist that never quite lifts.", palette: "mist", seed: 21 },
  { title: "Rose Ridge", caption: "Five ridges, one long exhale.", palette: "dawn", seed: 34 },
  { title: "Blue Hour", caption: "Pines going dark against the snow.", palette: "alpine", seed: 55 },
]

// Every slide as an image URL; slides without one are painted after mount.
function useSlideImages(slides: Slide[]): string[] {
  const key = slides.map((s) => s.image || (s.palette || "dawn") + ":" + (s.seed ?? 1)).join("|")
  const [painted, setPainted] = React.useState(() => slides.map(() => ""))
  React.useEffect(() => {
    // Painting needs the DOM (canvas), so it can only run after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPainted(slides.map((s, i) => (s.image ? "" : paintLandscape(s.seed ?? i + 1, s.palette || "dawn"))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return slides.map((s, i) => s.image || painted[i] || "")
}

const FP_CSS = [
  ".fp-root{position:relative;width:100%;display:flex;flex-direction:column;justify-content:center;gap:clamp(18px,3.5vh,36px);overflow:hidden;background:var(--fp-bg);color:var(--fp-ink);outline:none}",
  ".fp-root:focus-visible{box-shadow:inset 0 0 0 2px var(--fp-ink)}",
  ".fp-track{display:flex;align-items:center;gap:clamp(12px,2vw,28px);overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;padding-inline:calc(50% - var(--fp-w) / 2);scrollbar-width:none;cursor:grab;touch-action:pan-x pan-y}",
  ".fp-track::-webkit-scrollbar{display:none}",
  ".fp-track[data-drag='1']{scroll-snap-type:none;cursor:grabbing}",
  ".fp-card{flex:0 0 var(--fp-w);aspect-ratio:var(--fp-aspect);max-height:calc(var(--fp-h) * .68);scroll-snap-align:center;position:relative;border:0;padding:0;margin:0;background:transparent;cursor:inherit;will-change:transform,filter;transform-origin:center}",
  ".fp-card img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;border-radius:var(--fp-radius);pointer-events:none}",
  ".fp-meta{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:16px;padding-inline:clamp(20px,4vw,56px)}",
  ".fp-cap{min-height:2.6em;overflow:hidden;padding-bottom:.2em}",
  ".fp-cap>*{display:block;animation:fp-in .7s cubic-bezier(.2,.8,.2,1) both}",
  ".fp-title{font:500 clamp(20px,2.6vw,30px)/1.1 'Newsreader Variable',ui-serif,Georgia,'Times New Roman',serif;letter-spacing:-.01em}",
  ".fp-sub{margin-top:6px;font:400 13px/1.4 'Public Sans Variable',ui-sans-serif,system-ui,sans-serif;color:var(--fp-muted)}",
  ".fp-count{font:500 12px/1 'Public Sans Variable',ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.08em;text-align:center;color:var(--fp-muted)}",
  ".fp-count b{color:var(--fp-ink);font-weight:500}",
  ".fp-nav{display:flex;justify-content:flex-end;gap:6px}",
  ".fp-btn{appearance:none;border:1px solid var(--fp-line);background:transparent;color:inherit;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;cursor:pointer;transition:background .2s ease,color .2s ease}",
  ".fp-btn:hover{background:var(--fp-ink);color:var(--fp-bg)}",
  ".fp-btn:focus-visible{outline:2px solid var(--fp-ink);outline-offset:2px}",
  ".fp-bar{height:1px;margin-inline:clamp(20px,4vw,56px);background:var(--fp-line);position:relative}",
  ".fp-bar>i{position:absolute;inset:0 auto 0 0;width:100%;background:var(--fp-ink);transform-origin:left;transform:scaleX(var(--fp-p,0))}",
  ".fp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
  "@keyframes fp-in{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}",
  "@media (max-width:640px){.fp-meta{grid-template-columns:1fr auto}.fp-count{display:none}}",
  "@media (prefers-reduced-motion:reduce){.fp-cap>*{animation:none}.fp-track{scroll-behavior:auto}}",
].join("\n")

const DEFAULT_LABELS: NonNullable<FocusPullCarouselProps["labels"]> = {
  previous: "Previous",
  next: "Next",
  show: (title) => "Show " + title,
  status: (current, total, title) => "Slide " + current + " of " + total + (title ? ": " + title : ""),
}

export default function FocusPullCarousel({
  slides = DEFAULT_SLIDES,
  height = "100svh",
  cardWidth = "min(max(64vw, 290px), 920px)",
  aspect = "3 / 2",
  blur = 7,
  autoplay = 5000,
  background = "var(--color-background, #f4f1ea)",
  ink = "var(--color-foreground, #161513)",
  onChange,
  className,
  style,
  ariaLabel = "Image carousel",
  labels = DEFAULT_LABELS,
}: FocusPullCarouselProps) {
  const n = slides.length
  const srcs = useSlideImages(slides)
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef(null as HTMLDivElement | null)
  const trackRef = React.useRef(null as HTMLDivElement | null)
  const barRef = React.useRef(null as HTMLDivElement | null)
  const activeRef = React.useRef(0)
  const lastTouch = React.useRef(0)
  const blurRef = React.useRef(blur)
  const [dragging, setDragging] = React.useState(false)
  const justDragged = React.useRef(false)

  React.useEffect(() => {
    blurRef.current = blur
  }, [blur])

  // Rack focus on every scroll frame.
  const paint = React.useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const cards = Array.from(track.children) as HTMLElement[]
    if (!cards.length) return
    const mid = track.scrollLeft + track.clientWidth / 2
    const centers = cards.map((c) => c.offsetLeft + c.offsetWidth / 2)
    const w = cards[0]!.offsetWidth || 1
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    cards.forEach((c, i) => {
      const f = focusOf((centers[i]! - mid) / w, reduce ? 0 : blurRef.current)
      c.style.transform = "scale(" + f.scale.toFixed(4) + ")"
      c.style.filter = f.blur > 0.05 ? "blur(" + f.blur.toFixed(2) + "px) saturate(" + f.saturate.toFixed(3) + ")" : "none"
      c.style.opacity = f.opacity.toFixed(3)
    })
    const max = track.scrollWidth - track.clientWidth
    barRef.current?.style.setProperty("--fp-p", max > 0 ? (track.scrollLeft / max).toFixed(4) : "0")
    const near = nearestIndex(centers, mid)
    if (near !== activeRef.current) {
      activeRef.current = near
      setActive(near)
    }
  }, [])

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let raf = 0
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          paint()
        })
    }
    track.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(track)
    paint()
    return () => {
      cancelAnimationFrame(raf)
      track.removeEventListener("scroll", onScroll)
      ro.disconnect()
    }
  }, [paint, n])

  React.useEffect(() => {
    onChange?.(active)
  }, [active, onChange])

  const scrollToIndex = React.useCallback((i: number, smooth = true) => {
    const track = trackRef.current
    const card = track?.children[i] as HTMLElement | undefined
    if (!track || !card) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    track.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2, behavior: smooth && !reduce ? "smooth" : "auto" })
  }, [])

  const step = (dir: number) => {
    lastTouch.current = performance.now()
    scrollToIndex(wrap(activeRef.current + dir, n))
  }

  // Autoplay: waits for a quiet moment, and only while on screen.
  React.useEffect(() => {
    if (!autoplay || n < 2) return
    const root = rootRef.current
    let seen = true
    const io = new IntersectionObserver(([e]) => (seen = e?.isIntersecting ?? true))
    if (root) io.observe(root)
    const t = window.setInterval(() => {
      if (!seen || document.hidden || performance.now() - lastTouch.current < autoplay) return
      scrollToIndex(wrap(activeRef.current + 1, n))
    }, autoplay)
    return () => {
      window.clearInterval(t)
      io.disconnect()
    }
  }, [autoplay, n, scrollToIndex])

  // Mouse drag; touch and trackpads scroll natively.
  const drag = React.useRef(null as null | { x: number; left: number; moved: boolean })
  const onDown = (e: React.PointerEvent) => {
    lastTouch.current = performance.now()
    if (e.pointerType !== "mouse" || e.button !== 0) return
    drag.current = { x: e.clientX, left: trackRef.current!.scrollLeft, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true
      setDragging(true)
      trackRef.current!.setPointerCapture(e.pointerId)
    }
    if (d.moved) trackRef.current!.scrollLeft = d.left - dx
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    lastTouch.current = performance.now()
    if (d?.moved) {
      justDragged.current = true
      window.setTimeout(() => (justDragged.current = false), 0)
      setDragging(false)
      scrollToIndex(activeRef.current)
    }
  }
  const onClickCard = (i: number) => (e: React.MouseEvent) => {
    if (justDragged.current) return e.preventDefault()
    lastTouch.current = performance.now()
    scrollToIndex(i)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") step(1)
    else if (e.key === "ArrowLeft") step(-1)
    else return
    e.preventDefault()
  }

  const s = slides[active] || {}

  return (
    <div
      ref={rootRef}
      className={["fp-root", className].filter(Boolean).join(" ")}
      style={{
        height,
        ["--fp-h" as string]: typeof height === "number" ? height + "px" : height,
        ["--fp-w" as string]: cardWidth,
        ["--fp-aspect" as string]: aspect,
        ["--fp-bg" as string]: background,
        ["--fp-ink" as string]: ink,
        ["--fp-muted" as string]: "color-mix(in srgb, var(--fp-ink) 55%, transparent)",
        ["--fp-line" as string]: "color-mix(in srgb, var(--fp-ink) 18%, transparent)",
        ["--fp-radius" as string]: "2px",
        ...style,
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <style>{FP_CSS}</style>
      <div
        ref={trackRef}
        className="fp-track"
        data-drag={dragging ? "1" : "0"}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={() => (lastTouch.current = performance.now())}
      >
        {slides.map((sl, i) => (
          <button
            key={i}
            type="button"
            className="fp-card"
            tabIndex={-1}
            aria-label={labels.show(sl.title || "slide " + (i + 1))}
            aria-current={i === active ? "true" : undefined}
            onClick={onClickCard(i)}
          >
            {srcs[i] ? <img src={srcs[i]} alt={sl.alt || sl.title || ""} draggable={false} /> : null}
          </button>
        ))}
      </div>
      <div className="fp-meta">
        <div className="fp-cap" key={active} aria-hidden="true">
          {s.title ? <span className="fp-title">{s.title}</span> : null}
          {s.caption ? <span className="fp-sub">{s.caption}</span> : null}
        </div>
        <div className="fp-count" aria-hidden="true">
          <b>{pad2(active + 1)}</b> / {pad2(n)}
        </div>
        <div className="fp-nav">
          <button type="button" className="fp-btn" aria-label={labels.previous} onClick={() => step(-1)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <button type="button" className="fp-btn" aria-label={labels.next} onClick={() => step(1)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={barRef} className="fp-bar" aria-hidden="true">
        <i />
      </div>
      <div className="fp-sr" aria-live="polite">
        {labels.status(active + 1, n, s.title ?? "")}
      </div>
    </div>
  )
}
