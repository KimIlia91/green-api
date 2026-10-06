export const selfAuthorName = 'Вы'

export function nextOriginName(input: {
  current: string | null | undefined
  forwarded: boolean
  knownAuthor: string | null
}): string | null {
  const current = input.current?.trim() ?? ''
  if (current !== '') {
    return current
  }

  if (input.forwarded) {
    return null
  }

  const author = input.knownAuthor?.trim() ?? ''
  return author === '' ? null : author
}
