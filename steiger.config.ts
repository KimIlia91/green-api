import fsd from '@feature-sliced/steiger-plugin'
import { defineConfig } from 'steiger'

// Эти слайсы намеренно нужны одному экрану. insignificant-slice
// слил бы их в этот экран. Выключение правила убирает файлы из его
// дерева, поэтому их импорты больше не считаются. entities/chat и
// entities/message указаны здесь, чтобы недостающий счёт не считался
// единственной ссылкой со страницы.
// Границы импортов и публичные API остаются включены.
const singleUseSlices = [
  './src/features/connect-instance/**',
  './src/features/disconnect-instance/**',
  './src/features/create-chat/**',
  './src/features/send-message/**',
  './src/features/receive-notifications/**',
  './src/features/load-chats/**',
  './src/features/load-chat-history/**',
  './src/features/load-chat-previews/**',
  './src/features/acknowledge-incoming/**',
  './src/features/copy-message-text/**',
  './src/features/reply-to-message/**',
  './src/features/edit-message/**',
  './src/features/select-messages/**',
  './src/features/forward-messages/**',
  './src/features/delete-messages/**',
  './src/widgets/chat-sidebar/**',
  './src/widgets/chat-window/**',
  './src/entities/chat/**',
  './src/entities/message/**',
]

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      'fsd/import-locality': 'error',
    },
  },
  {
    files: singleUseSlices,
    rules: {
      'fsd/insignificant-slice': 'off',
    },
  },
])
