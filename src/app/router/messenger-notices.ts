import { bindOutgoingSendRefusal } from '@/features/receive-notifications'
import { reportOutgoingTextRefusal } from '@/features/send-message'

export function bindMessengerSendNotices(): () => void {
  bindOutgoingSendRefusal(reportOutgoingTextRefusal)
  return () => {
    bindOutgoingSendRefusal(null)
  }
}
