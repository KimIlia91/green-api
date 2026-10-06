import type { ButtonHTMLAttributes } from 'react'

import { classNames } from '../class-names.ts'
import { Spinner } from '../spinner/Spinner.tsx'
import styles from './Button.module.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
}

export function Button({
  type = 'button',
  loading = false,
  disabled = false,
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const isInactive = disabled || loading

  return (
    <button
      {...props}
      type={type}
      className={classNames(styles.button, className)}
      disabled={isInactive}
      aria-busy={loading ? true : undefined}
      onClick={(event) => {
        if (isInactive) {
          event.preventDefault()
          return
        }

        onClick?.(event)
      }}
    >
      {loading ? <Spinner decorative /> : null}
      {children}
    </button>
  )
}
