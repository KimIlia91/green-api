import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { classNames } from '../class-names.ts'
import { Button } from '../button/Button.tsx'
import styles from './IconButton.module.css'

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> & {
  label: string
  children: ReactNode
  loading?: boolean
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      aria-label={label}
      className={classNames(styles.iconButton, className)}
    >
      {children}
    </Button>
  )
}
