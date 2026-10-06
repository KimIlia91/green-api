export type MenuAnchor = {
  top: number
  right: number
  bottom: number
  left: number
}

export type MenuPlacement = {
  top: number
  left: number
  placement: 'above' | 'below'
}

export function placeMessageMenu(
  anchor: MenuAnchor,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number,
  gap: number,
): MenuPlacement {
  let placement: MenuPlacement['placement'] = 'below'
  let top = anchor.bottom + gap
  if (top + menuHeight > viewportHeight - margin) {
    placement = 'above'
    top = anchor.top - gap - menuHeight
  }
  if (top < margin) {
    top = margin
  }
  if (top + menuHeight > viewportHeight - margin) {
    top = Math.max(margin, viewportHeight - margin - menuHeight)
  }

  let left = anchor.left
  if (left + menuWidth > viewportWidth - margin) {
    left = viewportWidth - margin - menuWidth
  }
  if (left < margin) {
    left = margin
  }

  return { top, left, placement }
}
