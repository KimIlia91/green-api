export const instanceStates = [
  'notAuthorized',
  'authorized',
  'blocked',
  'starting',
  'suspended',
  'pendingPassword',
] as const

export type InstanceState = (typeof instanceStates)[number]

export type GreenApiConnection = {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type GetStateInstanceResult = {
  stateInstance: InstanceState
}

export type CheckAccountFound = {
  exist: boolean
  chatId: string
  fromCache: boolean
}

export type CheckAccountRejected = {
  status: false
  reason: string
}

export type CheckAccountResult = CheckAccountFound | CheckAccountRejected

export type CheckAccountParams = {
  phoneNumber: number
  force?: boolean
}

export type GetContactInfoParams = {
  chatId: string
}

export type GetContactInfoResult = {
  chatId: string
  name: string
  contactName: string
  phoneNumber: number
}

export type SendMessageParams = {
  chatId: string
  message: string
  typingTime?: number
  quotedMessageId?: string
}

export type SendMessageResult = {
  idMessage: string
}

export type EditMessageParams = {
  chatId: string
  idMessage: string
  message: string
}

export type EditMessageResult = {
  idMessage: string
}

export type ForwardMessagesParams = {
  chatId: string
  chatIdFrom: string
  messages: string[]
}

export type ForwardMessagesResult = {
  messages: string[]
}

export type DeleteMessageParams = {
  chatId: string
  idMessage: string
  onlySenderDelete?: boolean
}

export type ReadChatParams = {
  chatId: string
  idMessage: string
}

export type ReadChatResult = {
  setRead: true
}

export type ChatDirectoryEntry = {
  chatId: string
  name: string
  type: string
  phoneNumber: number
}

export type ChatHistoryParams = {
  chatId: string
  count: number
}

export type ProviderQuote = {
  sourceId: string
  participant: string | null
  typeMessage: string | null
  excerpt: string | null
}

export type HistoryEditEvent = {
  originalId: string | null
  text: string | null
}

export type HistoryReaction = {
  targetId: string | null
  emoji: string | null
}

export type HistoryDeletion = {
  targetId: string | null
}

export type ChatHistoryEntry = {
  type: 'incoming' | 'outgoing'
  idMessage: string
  timestamp: number
  chatId: string
  typeMessage: string
  text: string | null
  statusMessage: string | null
  stickerUrl: string | null
  stickerMimeType: string | null
  quote: ProviderQuote | null
  isEdited: boolean
  editedMessageId: string | null
  editEvent: HistoryEditEvent | null
  reaction: HistoryReaction | null
  deletion: HistoryDeletion | null
  deleted: boolean
  deletedMessageId: string | null
  forwarded: boolean
  forwardingScore: number | null
}

export type DeleteNotificationResult = {
  result: boolean
  reason: string
}

export type IncomingTextNotification = {
  typeWebhook: 'incomingMessageReceived'
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'textMessage'
    textMessageData: {
      textMessage: string
      isForwarded?: boolean
      forwardingScore?: number
    }
    quote?: ProviderQuote
  }
}

export type IncomingStickerNotification = {
  typeWebhook: 'incomingMessageReceived'
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'stickerMessage'
    fileMessageData: {
      downloadUrl: string
      mimeType: string | null
      caption: string
      isForwarded?: boolean
      forwardingScore?: number
    }
  }
}

export type IncomingExtendedTextNotification = {
  typeWebhook: 'incomingMessageReceived'
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'extendedTextMessage'
    extendedTextMessageData: {
      text: string
      description?: string
      title?: string
      jpegThumbnail?: string
      isForwarded?: boolean
      forwardingScore?: number
    }
    quote?: ProviderQuote
  }
}

export type IncomingQuotedNotification = {
  typeWebhook: 'incomingMessageReceived'
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'quotedMessage'
    extendedTextMessageData: {
      text: string
      stanzaId: string
      participant: string
      isForwarded?: boolean
      forwardingScore?: number
    }
    quote: ProviderQuote
  }
}

export type OutgoingTextWebhook =
  'outgoingMessageReceived' | 'outgoingAPIMessageReceived'

export type OutgoingTextNotification = {
  typeWebhook: OutgoingTextWebhook
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
    chatName: string | null
    chatType: string | null
    senderPhoneNumber: number | null
  }
  messageData:
    | IncomingTextNotification['messageData']
    | IncomingExtendedTextNotification['messageData']
    | IncomingQuotedNotification['messageData']
}

export type EditedMessageWebhook =
  | 'incomingMessageReceived'
  | 'outgoingMessageReceived'
  | 'outgoingAPIMessageReceived'

export type DeletedMessageNotification = {
  typeWebhook: EditedMessageWebhook
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'deletedMessage'
    deletedMessageData: {
      stanzaId: string | null
    }
  }
}

export type ReactionMessageNotification = {
  typeWebhook: EditedMessageWebhook
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'reactionMessage'
    extendedTextMessageData: {
      text: string | null
    }
    targetId: string | null
  }
}

export type OutgoingStickerNotification = {
  typeWebhook: OutgoingTextWebhook
  timestamp: number
  idMessage: string
  senderData: OutgoingTextNotification['senderData']
  messageData: IncomingStickerNotification['messageData']
}

export type EditedMessageNotification = {
  typeWebhook: EditedMessageWebhook
  timestamp: number
  idMessage: string
  senderData: {
    chatId: string
  }
  messageData: {
    typeMessage: 'editedMessage'
    editedMessageData: {
      textMessage: string
      stanzaId: string | null
    }
  }
}

export type OutgoingMessageStatusNotification = {
  typeWebhook: 'outgoingMessageStatus'
  timestamp: number
  idMessage: string
  chatId: string
  status: string
  description?: string
}

export type UnknownNotification = {
  recognized: false
  typeWebhook: string
}

export type MaxNotification =
  | IncomingTextNotification
  | IncomingExtendedTextNotification
  | IncomingQuotedNotification
  | IncomingStickerNotification
  | OutgoingTextNotification
  | OutgoingStickerNotification
  | EditedMessageNotification
  | DeletedMessageNotification
  | ReactionMessageNotification
  | OutgoingMessageStatusNotification
  | UnknownNotification

export type ReceivedNotification = {
  receiptId: number
  body: MaxNotification
}
