import { create } from 'zustand'

import {
  canEditMessage,
  editExpiredMessage,
  useMessageStore,
  type Message,
} from '@/entities/message'

import { invalidateEditFlights } from './edit-flight.ts'

export type EditSession = {
  localId: string
  chatId: string
  text: string
  preview: string
  notice: string
}

type EditState = {
  session: EditSession | null
}

export const useEditStore = create<EditState>()(() => ({
  session: null,
}))

export function selectEditSession(state: EditState): EditSession | null {
  return state.session
}

export function beginEdit(message: Message, now: number): boolean {
  if (!canEditMessage(message, now)) {
    return false
  }

  useEditStore.setState({
    session: {
      localId: message.localId,
      chatId: message.chatId,
      text: message.text,
      preview: message.text,
      notice: '',
    },
  })
  return true
}

export function setEditText(text: string): void {
  const session = useEditStore.getState().session
  if (session === null) {
    return
  }

  useEditStore.setState({
    session: {
      ...session,
      text,
      notice: session.notice === editExpiredMessage ? session.notice : '',
    },
  })
}

export function cancelEdit(): void {
  invalidateEditFlights()
  useEditStore.setState({ session: null })
}

export function markEditExpiry(now: number): void {
  const session = useEditStore.getState().session
  if (session === null || session.notice === editExpiredMessage) {
    return
  }

  const message = useMessageStore.getState().messagesById[session.localId]
  if (message !== undefined && canEditMessage(message, now)) {
    return
  }

  useEditStore.setState({
    session: { ...session, notice: editExpiredMessage },
  })
}

export function setEditNotice(notice: string): void {
  const session = useEditStore.getState().session
  if (session === null) {
    return
  }

  useEditStore.setState({ session: { ...session, notice } })
}
