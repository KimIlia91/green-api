export type DayMarker = {
  label: string
  separatorTop: number
  separatorBottom: number
}

export type FloatingDate = {
  label: string
  shown: boolean
}

export function nextFloatingDate(
  current: FloatingDate | null,
  markers: readonly DayMarker[],
  viewportTop: number,
): FloatingDate | null {
  const active = dayAtTopEdge(markers, viewportTop)
  if (active === null) {
    return null
  }

  const separatorHasLeft = active.separatorBottom <= viewportTop
  if (!separatorHasLeft) {
    return {
      label: current?.label ?? active.label,
      shown: false,
    }
  }

  return { label: active.label, shown: true }
}

function dayAtTopEdge(
  markers: readonly DayMarker[],
  viewportTop: number,
): DayMarker | null {
  const first = markers[0]
  if (first === undefined) {
    return null
  }

  let active = first
  for (const marker of markers) {
    if (marker.separatorTop <= viewportTop) {
      active = marker
      continue
    }
    break
  }
  return active
}
