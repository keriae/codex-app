import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UserMessageImages } from './UserMessageImages'

describe('UserMessageImages', () => {
  it('renders local image inputs as native-style thumbnails instead of filename chips', () => {
    const html = renderToStaticMarkup(createElement(UserMessageImages, {
      images: [
        { path: '/tmp/codex-clipboard-one.png', name: 'codex-clipboard-one.png' },
        { path: '/tmp/codex-clipboard-two.png', name: 'codex-clipboard-two.png' }
      ]
    }))

    expect(html).toContain('aria-label="2 张输入图片"')
    expect(html.match(/thread-image-item is-message-attachment/g)).toHaveLength(2)
    expect(html.match(/正在载入图像/g)).toHaveLength(2)
    expect(html).not.toContain('class="message-attachment"')
  })

  it('does not reserve message space when there are no image inputs', () => {
    expect(renderToStaticMarkup(createElement(UserMessageImages, { images: [] }))).toBe('')
  })
})
