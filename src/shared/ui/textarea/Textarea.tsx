import { useId, type Ref, type TextareaHTMLAttributes } from 'react'

import { classNames } from '../class-names.ts'
import fieldStyles from '../field.module.css'
import styles from './Textarea.module.css'

type TextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'aria-invalid' | 'aria-describedby'
> & {
  id?: string
  label: string
  labelHidden?: boolean
  error?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({
  id,
  label,
  labelHidden = false,
  error,
  className,
  ref,
  ...props
}: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const errorId = `${textareaId}-error`

  return (
    <div className={fieldStyles.field}>
      <label
        className={
          labelHidden
            ? classNames(fieldStyles.label, fieldStyles.visuallyHidden)
            : fieldStyles.label
        }
        htmlFor={textareaId}
      >
        {label}
      </label>
      <textarea
        {...props}
        ref={ref}
        id={textareaId}
        className={classNames(
          fieldStyles.control,
          styles.textarea,
          error ? fieldStyles.invalid : undefined,
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className={fieldStyles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
