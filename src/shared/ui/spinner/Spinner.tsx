import type { HTMLAttributes } from 'react'

import { classNames } from '../class-names.ts'
import styles from './Spinner.module.css'

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  label?: string
  decorative?: boolean
}

export function Spinner({
  label = 'Загрузка',
  decorative = false,
  className,
  ...props
}: SpinnerProps) {
  if (decorative) {
    return (
      <span
        {...props}
        className={classNames(styles.spinner, className)}
        aria-hidden="true"
      />
    )
  }

  return (
    <span
      {...props}
      className={classNames(styles.spinner, className)}
      role="status"
    >
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  )
}
