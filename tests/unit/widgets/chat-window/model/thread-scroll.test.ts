import { describe, expect, it } from 'vitest'

import {
  bottomScrollTop,
  nextThreadFollow,
  nextThreadScroll,
  quoteScrollTop,
  threadScrollportReady,
  type ThreadScrollSnapshot,
} from '@/widgets/chat-window/model/thread-scroll.ts'

const visible: ThreadScrollSnapshot = {
  clientHeight: 400,
  scrollHeight: 1200,
  scrollTop: 0,
}

describe('thread scroll', () => {
  it('does not treat a hidden or zero-height scrollport as positioned', () => {
    expect(threadScrollportReady({ clientHeight: 0, visible: false })).toBe(
      false,
    )
    expect(threadScrollportReady({ clientHeight: 0, visible: true })).toBe(
      false,
    )
    expect(threadScrollportReady({ clientHeight: 400, visible: false })).toBe(
      false,
    )

    const hidden = nextThreadScroll({
      port: { clientHeight: 0, scrollHeight: 900, scrollTop: 0 },
      visible: false,
      follow: 'bottom',
      anchor: null,
      historyPrepended: false,
    })

    expect(hidden.applied).toBe(false)
    expect(hidden.scrollTop).toBe(0)
  })

  it('pins a newly visible thread to the bottom after the hidden measurement', () => {
    const placed = nextThreadScroll({
      port: visible,
      visible: true,
      follow: 'bottom',
      anchor: null,
      historyPrepended: false,
    })

    expect(placed.applied).toBe(true)
    expect(placed.scrollTop).toBe(bottomScrollTop(visible))
    expect(visible.scrollHeight - placed.scrollTop - visible.clientHeight).toBe(
      0,
    )
  })

  it('keeps the bottom when content or the scrollport grows while following', () => {
    const grown = nextThreadScroll({
      port: { clientHeight: 320, scrollHeight: 1600, scrollTop: 800 },
      visible: true,
      follow: 'bottom',
      anchor: { height: 1200, top: 800 },
      historyPrepended: false,
    })

    expect(grown.scrollTop).toBe(1280)
    expect(1600 - grown.scrollTop - 320).toBe(0)
  })

  it('does not pull a reader back down when later content grows', () => {
    const stayed = nextThreadScroll({
      port: { clientHeight: 400, scrollHeight: 1800, scrollTop: 200 },
      visible: true,
      follow: 'preserve',
      anchor: { height: 1200, top: 200 },
      historyPrepended: false,
    })

    expect(stayed.scrollTop).toBe(200)
  })

  it('keeps the viewport stable when older history arrives above a preserved position', () => {
    const compensated = nextThreadScroll({
      port: { clientHeight: 400, scrollHeight: 2000, scrollTop: 200 },
      visible: true,
      follow: 'preserve',
      anchor: { height: 1200, top: 200 },
      historyPrepended: true,
    })

    expect(compensated.scrollTop).toBe(1000)
  })

  it('opens the end of a history merge while the reader is still following the bottom', () => {
    const opened = nextThreadScroll({
      port: { clientHeight: 400, scrollHeight: 2000, scrollTop: 0 },
      visible: true,
      follow: 'bottom',
      anchor: { height: 80, top: 0 },
      historyPrepended: true,
    })

    expect(opened.scrollTop).toBe(1600)
  })

  it('ignores a programmatic scroll when deciding whether to keep following', () => {
    expect(nextThreadFollow(400, true, 'bottom')).toBe('bottom')
    expect(nextThreadFollow(400, false, 'bottom')).toBe('preserve')
    expect(nextThreadFollow(10, false, 'preserve')).toBe('bottom')
  })

  it('keeps following the bottom when a late scroll notification sees a taller thread', () => {
    expect(nextThreadFollow(72, false, 'bottom', false)).toBe('bottom')

    const placed = nextThreadScroll({
      port: { clientHeight: 716, scrollHeight: 1944, scrollTop: 1156 },
      visible: true,
      follow: 'bottom',
      anchor: { height: 1872, top: 1156 },
      historyPrepended: false,
    })

    expect(placed.scrollTop).toBe(1228)
    expect(1944 - placed.scrollTop - 716).toBe(0)
  })

  it('keeps the bottom when the visible scrollport becomes shorter', () => {
    const shrunk = nextThreadScroll({
      port: { clientHeight: 716, scrollHeight: 1980, scrollTop: 1156 },
      visible: true,
      follow: 'bottom',
      anchor: { height: 1980, top: 1156 },
      historyPrepended: false,
    })

    expect(shrunk.scrollTop).toBe(1264)
    expect(1980 - shrunk.scrollTop - 716).toBe(0)
  })

  it('keeps a preserved position when the scrollport becomes shorter', () => {
    const stayed = nextThreadScroll({
      port: { clientHeight: 300, scrollHeight: 1800, scrollTop: 200 },
      visible: true,
      follow: 'preserve',
      anchor: null,
      historyPrepended: false,
    })

    expect(stayed.scrollTop).toBe(200)
  })

  it('scrolls the thread toward a quoted message without jumping to the end', () => {
    expect(
      quoteScrollTop({
        scrollTop: 0,
        portTop: 0,
        portHeight: 400,
        targetTop: 900,
        targetHeight: 40,
        maxScrollTop: 2000,
      }),
    ).toBe(720)
    expect(
      quoteScrollTop({
        scrollTop: 100,
        portTop: 0,
        portHeight: 400,
        targetTop: 4000,
        targetHeight: 40,
        maxScrollTop: 1600,
      }),
    ).toBe(1600)
  })

  it('leaves the bottom only after the reader moves away from it', () => {
    expect(nextThreadFollow(72, false, 'bottom', true)).toBe('preserve')
    expect(nextThreadFollow(108, true, 'bottom', true)).toBe('bottom')
  })
})
