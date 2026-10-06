export function classNames(
  ...tokens: Array<string | false | undefined>
): string {
  return tokens
    .filter(
      (token): token is string => typeof token === 'string' && token.length > 0,
    )
    .join(' ')
}
