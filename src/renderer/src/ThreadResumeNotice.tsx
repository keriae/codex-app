import { GitFork, LoaderCircle, LockKeyhole } from 'lucide-react'
import './threadResumeNotice.css'

export function ThreadResumeNotice({
  busy,
  onRetry,
  onFork
}: {
  busy: boolean
  onRetry(): void
  onFork(): void
}): React.JSX.Element {
  return <div className="thread-resume-notice" role="status">
    <LockKeyhole className="thread-resume-notice-icon" />
    <div className="thread-resume-notice-copy">
      <strong>已在另一个应用中打开</strong>
      <span>请先在那边关闭会话，才能在这里继续。</span>
    </div>
    <div className="thread-resume-notice-actions">
      <button type="button" disabled={busy} onClick={onRetry}>
        {busy && <LoaderCircle className="spin" />}
        {busy ? '正在重试…' : '重试'}
      </button>
      <button type="button" disabled={busy} onClick={onFork}>
        <GitFork />
        创建聊天分叉
      </button>
    </div>
  </div>
}
