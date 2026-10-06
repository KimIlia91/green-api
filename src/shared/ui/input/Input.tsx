import { useId, type InputHTMLAttributes } from 'react'

import { classNames } from '../class-names.ts'
import fieldStyles from '../field.module.css'
import styles from './Input.module.css'

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'aria-invalid' | 'aria-describedby'
> & {
  id?: string
  label: string
  hint?: string
  error?: string
}

export function Input({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined]
    .filter((value) => value !== undefined)
    .join(' ')

  return (
    <div className={fieldStyles.field}>
      <label className={fieldStyles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={classNames(
          fieldStyles.control,
          styles.input,
          error ? fieldStyles.invalid : undefined,
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {hint ? (
        <p id={hintId} className={fieldStyles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={fieldStyles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
