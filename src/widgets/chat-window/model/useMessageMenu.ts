import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useMessageStore } from '@/entities/message'
import {
  copyFailureText,
  copySuccessText,
  createTextCopy,
  messageCopySource,
  writeClipboard,
} from '@/features/copy-message-text'

import type { MenuAnchor } from './place-menu.ts'

const noticeDwellMs = 2400

type CloseReason = 'escape' | 'outside' | 'scroll' | 'resize' | 'success'

type MenuSession = {
  id: number
  localId: string
  phase: 'open' | 'closing'
  anchor: MenuAnchor
  trigger: HTMLElement | null
}

type Notice = {
  id: number
  kind: 'copied' | 'failed'
  phase: 'open' | 'closing'
}

export type MessageMenuController = {
  chatId: string
  session: MenuSession | null
  pending: boolean
  notice: Notice | null
  menuId: string
  scrollEpoch: { current: number }
  armSuppress: () => void
  peekSuppress: () => boolean
  clearSuppress: () => void
  openMenu: (
    localId: string,
    anchor: MenuAnchor,
    trigger: HTMLElement | null,
  ) => void
  closeMenu: (reason: CloseReason) => void
  noteScroll: () => void
  copyText: (localId: string) => void
  live: { polite: string; assertive: string }
}

export function useMessageMenu(chatId: string): MessageMenuController {
  const copy = useRef(createTextCopy())
  const menuRef = useRef<MenuSession | null>(null)
  const [session, setSession] = useState<MenuSession | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const sessionId = useRef(0)
  const noticeSerial = useRef(0)
  const closeTimer = useRef(0)
  const noticeTimer = useRef(0)
  const liveTimer = useRef(0)
  const scrollEpoch = useRef(0)
  const suppressClick = useRef(false)
  const mounted = useRef(true)
  const menuId = useId()
  const [live, setLive] = useState({ polite: '', assertive: '' })

  const commitMenu = useCallback((next: MenuSession | null) => {
    menuRef.current = next
    setSession(next)
  }, [])

  const closeMenu = useCallback(
    (reason: CloseReason) => {
      const current = menuRef.current
      if (current === null || current.phase !== 'open') {
        return
      }

      const id = current.id
      const trigger = current.trigger
      commitMenu({ ...current, phase: 'closing' })
      if (
        (reason === 'escape' || reason === 'success') &&
        trigger !== null &&
        trigger.isConnected
      ) {
        trigger.focus({ preventScroll: true })
      }

      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => {
        if (menuRef.current?.id !== id) {
          return
        }
        commitMenu(null)
      }, durationMs('--duration-fast'))
    },
    [commitMenu],
  )

  const openMenu = useCallback(
    (localId: string, anchor: MenuAnchor, trigger: HTMLElement | null) => {
      window.clearTimeout(closeTimer.current)
      sessionId.current += 1
      commitMenu({
        id: sessionId.current,
        localId,
        phase: 'open',
        anchor,
        trigger,
      })
    },
    [commitMenu],
  )

  const noteScroll = useCallback(() => {
    scrollEpoch.current += 1
    closeMenu('scroll')
  }, [closeMenu])

  const armSuppress = useCallback(() => {
    suppressClick.current = true
  }, [])

  const peekSuppress = useCallback(() => suppressClick.current, [])

  const clearSuppress = useCallback(() => {
    suppressClick.current = false
  }, [])

  const showNotice = useCallback((kind: Notice['kind']) => {
    window.clearTimeout(noticeTimer.current)
    noticeSerial.current += 1
    const id = noticeSerial.current
    setNotice({ id, kind, phase: 'open' })
    setLive({ polite: '', assertive: '' })
    window.clearTimeout(liveTimer.current)
    liveTimer.current = window.setTimeout(() => {
      if (!mounted.current) {
        return
      }
      setLive(
        kind === 'copied'
          ? { polite: copySuccessText, assertive: '' }
          : { polite: '', assertive: copyFailureText },
      )
    }, 0)
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) =>
        current?.id === id ? { ...current, phase: 'closing' } : current,
      )
      noticeTimer.current = window.setTimeout(() => {
        setNotice((current) => (current?.id === id ? null : current))
      }, durationMs('--duration-normal'))
    }, noticeDwellMs)
  }, [])

  const copyText = useCallback(
    (localId: string) => {
      const message = useMessageStore.getState().messagesById[localId]
      if (message === undefined) {
        return
      }
      const text = messageCopySource(message)
      if (text === null) {
        return
      }

      setPending(true)
      void copy.current.run(text, writeClipboard).then((result) => {
        if (!mounted.current) {
          return
        }
        setPending(false)
        if (result === 'busy') {
          return
        }
        if (result === 'copied') {
          showNotice('copied')
          closeMenu('success')
          return
        }
        showNotice('failed')
      })
    },
    [closeMenu, showNotice],
  )

  useEffect(() => {
    mounted.current = true
    const swallowClick = (event: MouseEvent) => {
      if (!suppressClick.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
    }
    const releaseForNextPress = () => {
      suppressClick.current = false
    }
    document.addEventListener('click', swallowClick, true)
    document.addEventListener('pointerdown', releaseForNextPress, true)
    return () => {
      mounted.current = false
      document.removeEventListener('click', swallowClick, true)
      document.removeEventListener('pointerdown', releaseForNextPress, true)
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(noticeTimer.current)
      window.clearTimeout(liveTimer.current)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      closeMenu('resize')
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [closeMenu])

  useEffect(() => {
    if (session === null || session.phase !== 'open') {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      if (target.closest('[data-message-menu], [data-message-trigger]')) {
        return
      }
      closeMenu('outside')
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [session, closeMenu])

  return {
    chatId,
    session,
    pending,
    notice,
    menuId,
    scrollEpoch,
    armSuppress,
    peekSuppress,
    clearSuppress,
    openMenu,
    closeMenu,
    noteScroll,
    copyText,
    live,
  }
}

function durationMs(name: '--duration-fast' | '--duration-normal'): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return raw.endsWith('ms') ? value : value * 1000
}
