export function shouldSubmitOnEnter(event: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
}): boolean {
  if (event.key !== 'Enter' || event.shiftKey) {
    return false
  }

  if (event.isComposing || event.keyCode === 229) {
    return false
  }

  return true
}
