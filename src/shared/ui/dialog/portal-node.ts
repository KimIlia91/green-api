import { createContext, useContext } from 'react'

export const PortalNodeContext = createContext<HTMLElement | null>(null)

export function usePortalNode(): HTMLElement | null {
  return useContext(PortalNodeContext)
}
