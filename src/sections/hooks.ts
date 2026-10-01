import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** the text's own inline size (ResizeObserver; holds through font swaps and breakpoints) */
export function useInlineSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // the text's own extent, not the block's (headings are block-level)
      const range = document.createRange()
      range.selectNodeContents(el)
      const rw = range.getBoundingClientRect().width
      setW((prev) => (Math.abs(prev - rw) > 0.5 ? rw : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** true once the element has entered the viewport (one-shot: each line cuts once per load) */
export function useEnteredView<T extends Element>(ref: RefObject<T | null>, margin = '-40px') {
  const [seen, setSeen] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin, seen])
  return seen
}
