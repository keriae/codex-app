import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RpcServerRequest } from '../../shared/api'
import { ServerRequestDialog } from './ServerRequestDialog'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const diff = readFileSync(new URL('./WorkspaceDiffViewer.tsx', import.meta.url), 'utf8')
const diffControls = readFileSync(new URL('./WorkspaceDiffControls.tsx', import.meta.url), 'utf8')

describe('zh-CN visible interface copy', () => {
  it('keeps conversation status and recovery actions localized', () => {
    for (const copy of [
      '正在打开聊天…',
      '正在加载较早内容…',
      '加载较早内容',
      '聊天已归档',
      '聊天已恢复',
      '恢复草稿',
      '撤销'
    ]) expect(app).toContain(copy)

    for (const copy of [
      'Opening chat…',
      'Loading earlier…',
      'Load earlier',
      'Chat archived',
      'Chat restored',
      'Restore draft'
    ]) expect(app).not.toContain(copy)
  })

  it('localizes the review options, full-file recovery, empty state and comment controls', () => {
    for (const copy of [
      '正在加载完整文件…',
      '完整文件与当前差异不匹配，保留部分差异',
      '没有可显示的文本差异',
      '添加评论；按住 Shift 可选择多行',
      '无法重新计算空白差异，保留当前差异',
      '二进制文件已更改'
    ]) expect(diff).toContain(copy)
    for (const copy of ['加载完整文件', '渲染预览', '词级差异', '隐藏空白字符', '隐藏导入内容', '复制 git apply 命令']) expect(diffControls).toContain(copy)

    for (const copy of [
      'Type to search files',
      'No results',
      'No textual diff available',
      'Add a comment; Shift-click to select multiple lines',
      'Unable to copy path',
      'Binary file changed'
    ]) expect(diff).not.toContain(copy)
  })

  it('renders approval requests with localized actions and context', () => {
    const request = {
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: ['echo', 'hello'],
        cwd: '/project',
        availableDecisions: ['decline', 'acceptForSession', 'accept']
      }
    } as RpcServerRequest
    const html = renderToStaticMarkup(createElement(ServerRequestDialog, {
      request,
      busy: false,
      error: null,
      onRespond: vi.fn()
    }))

    expect(html).toContain('运行此命令吗？')
    expect(html).toContain('Codex 需要你的批准才能继续。')
    expect(html).toContain('工作目录：/project')
    expect(html).toContain('拒绝')
    expect(html).toContain('本次会话中允许')
    expect(html).toContain('允许一次')
    expect(html).not.toContain('Run this command?')
    expect(html).not.toContain('Working directory:')
  })
})
