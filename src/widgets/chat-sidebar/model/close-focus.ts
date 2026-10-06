export function closeFocusTarget(rowAvailable: boolean): 'row' | 'title' {
  return rowAvailable ? 'row' : 'title'
}
