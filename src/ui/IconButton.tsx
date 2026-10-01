import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * A 44x44 hit target around a drawn icon (src/art/icons.tsx). The icon is
 * aria-hidden, so `label` is required: it becomes the button's accessible name.
 * Hover changes the stroke colour only (silver-2 -> silver, 160 ms); press sinks
 * 0.5 px. No chrome, no pill, no glow.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  children: ReactNode
}

export function IconButton({ label, children, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={['icon-btn', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
