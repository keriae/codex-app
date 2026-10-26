import {
  CheckCircle2,
  CircleAlert,
  CircleUserRound,
  Folder,
  Gauge,
  Info,
  LoaderCircle,
  LogIn,
  LogOut,
  Monitor,
  PlugZap,
  RefreshCw,
  Settings2,
  X
} from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type { AppContext, AppInfo, BackendStatus } from '../../shared/api'
import { IntegrationsSettings } from './IntegrationsSettings'
import {
  accountPresentation,
  normalizeAccountResponse,
  normalizeRateLimitsResponse,
  parseLoginCompletion,
  planLabel,
  rateLimitWindowLabel,
  shouldRefreshAccount,
  type AccountSnapshot,
  type RateLimitSnapshot,
  type RateLimitWindow
} from './settingsAccount'

type Theme = 'dark' | 'light'
type SettingsTab = 'general' | 'account' | 'integrations'
type AccountAction = 'login' | 'logout' | null

interface SettingsSheetProps {
  backend: BackendStatus
  context: AppContext | null
  theme: Theme
  onToggleTheme(): void
  onClose(): void
}

interface ChatGptLoginResponse {
  type: 'chatgpt'
  loginId: string
  authUrl: string
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isChatGptLoginResponse(value: unknown): value is ChatGptLoginResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.type === 'chatgpt' &&
    typeof candidate.loginId === 'string' &&
    typeof candidate.authUrl === 'string'
  )
}

function resetDescription(resetsAt: number | null): string | null {
  if (!resetsAt) return null
  const reset = new Date(resetsAt * 1000)
  if (Number.isNaN(reset.getTime())) return null
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(reset)}`
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

export function SettingsSheet({
  backend,
  context,
  theme,
  onToggleTheme,
  onClose
}: SettingsSheetProps): ReactNode {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [account, setAccount] = useState<AccountSnapshot | null>(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [rateLimits, setRateLimits] = useState<RateLimitSnapshot[]>([])
  const [rateLimitsLoading, setRateLimitsLoading] = useState(false)
  const [rateLimitsError, setRateLimitsError] = useState<string | null>(null)
  const [accountAction, setAccountAction] = useState<AccountAction>(null)
  const requestSequence = useRef(0)
  const pendingLoginId = useRef<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const loadRateLimits = useCallback(async (sequence?: number): Promise<void> => {
    setRateLimitsLoading(true)
    setRateLimitsError(null)
    try {
      const response = await window.codex.invoke<unknown>('account/rateLimits/read')
      if (sequence !== undefined && sequence !== requestSequence.current) return
      setRateLimits(normalizeRateLimitsResponse(response))
    } catch (error) {
      if (sequence !== undefined && sequence !== requestSequence.current) return
      setRateLimits([])
      setRateLimitsError(displayError(error))
    } finally {
      if (sequence === undefined || sequence === requestSequence.current) {
        setRateLimitsLoading(false)
      }
    }
  }, [])

  const loadAccount = useCallback(async (showLoading = true): Promise<void> => {
    const sequence = ++requestSequence.current
    if (showLoading) setAccountLoading(true)
    setAccountError(null)
    try {
      const response = await window.codex.invoke<unknown>('account/read', {
        refreshToken: false
      })
      if (sequence !== requestSequence.current) return
      const normalized = normalizeAccountResponse(response)
      setAccount(normalized)
      if (normalized.account?.type === 'chatgpt') {
        await loadRateLimits(sequence)
      } else {
        setRateLimits([])
        setRateLimitsError(null)
        setRateLimitsLoading(false)
      }
    } catch (error) {
      if (sequence !== requestSequence.current) return
      setAccountError(displayError(error))
    } finally {
      if (sequence === requestSequence.current) setAccountLoading(false)
    }
  }, [loadRateLimits])

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [])

  useEffect(() => {
    void window.codex.getAppInfo().then(setInfo).catch(() => undefined)
    void loadAccount()
  }, [loadAccount])

  useEffect(() => {
    return window.codex.onNotification((notification) => {
      if (!shouldRefreshAccount(notification)) return

      const completion = parseLoginCompletion(notification)
      if (completion) {
        if (
          pendingLoginId.current &&
          completion.loginId &&
          completion.loginId !== pendingLoginId.current
        ) {
          return
        }
        pendingLoginId.current = null
        setAccountAction(null)
        if (!completion.success) {
          const message = completion.error || 'ChatGPT sign-in did not complete'
          void loadAccount(false).finally(() => setAccountError(message))
          return
        }
      }

      if (notification.method === 'account/updated') {
        pendingLoginId.current = null
        setAccountAction(null)
      }
      void loadAccount(false)
    })
  }, [loadAccount])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = focusableElements(dialogRef.current)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  const login = async (): Promise<void> => {
    setAccountAction('login')
    setAccountError(null)
    try {
      const response = await window.codex.invoke<unknown>('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'codex'
      })
      if (!isChatGptLoginResponse(response)) {
        throw new Error('The app-server did not return a ChatGPT sign-in URL')
      }
      pendingLoginId.current = response.loginId
      await window.codex.openAuthenticationUrl(response.authUrl)
    } catch (error) {
      pendingLoginId.current = null
      setAccountAction(null)
      setAccountError(displayError(error))
    }
  }

  const logout = async (): Promise<void> => {
    setAccountAction('logout')
    setAccountError(null)
    try {
      await window.codex.invoke('account/logout')
      setAccountAction(null)
      await loadAccount(false)
    } catch (error) {
      setAccountAction(null)
      setAccountError(displayError(error))
    }
  }

  const accountView = account ? accountPresentation(account) : null

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={closeFromBackdrop}>
      <section
        ref={dialogRef}
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onDialogKeyDown}
      >
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button ref={closeRef} type="button" className="settings-close" onClick={onClose} aria-label="Close settings">
            <X />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            <button
              id="settings-general-tab"
              type="button"
              role="tab"
              aria-selected={tab === 'general'}
              aria-controls="settings-general-panel"
              className={tab === 'general' ? 'active' : undefined}
              onClick={() => setTab('general')}
            >
              <Settings2 />
              General
            </button>
            <button
              id="settings-account-tab"
              type="button"
              role="tab"
              aria-selected={tab === 'account'}
              aria-controls="settings-account-panel"
              className={tab === 'account' ? 'active' : undefined}
              onClick={() => setTab('account')}
            >
              <CircleUserRound />
              Account
              {accountView?.status === 'required' && <span className="settings-nav-alert" />}
            </button>
            <button
              id="settings-integrations-tab"
              type="button"
              role="tab"
              aria-selected={tab === 'integrations'}
              aria-controls="settings-integrations-panel"
              className={tab === 'integrations' ? 'active' : undefined}
              onClick={() => setTab('integrations')}
            >
              <PlugZap />
              Integrations
            </button>
            <div className="settings-nav-spacer" />
            <small>Codex for macOS</small>
          </nav>

          <div className="settings-content">
            {tab === 'general' ? (
              <section id="settings-general-panel" role="tabpanel" aria-labelledby="settings-general-tab" className="settings-panel" tabIndex={0}>
                <div className="settings-panel-heading">
                  <h3>General</h3>
                  <p>Appearance and local app-server details.</p>
                </div>

                <SettingsGroup title="Appearance">
                  <div className="settings-row">
                    <span className="settings-row-icon"><Monitor /></span>
                    <div className="settings-row-copy">
                      <strong>Theme</strong>
                      <small>Choose how Codex looks on this Mac.</small>
                    </div>
                    <div className="theme-switcher" aria-label="Theme">
                      <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'active' : undefined} onClick={theme === 'dark' ? undefined : onToggleTheme}>Dark</button>
                      <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'active' : undefined} onClick={theme === 'light' ? undefined : onToggleTheme}>Light</button>
                    </div>
                  </div>
                </SettingsGroup>

                <SettingsGroup title="Workspace">
                  <div className="settings-row align-start">
                    <span className="settings-row-icon"><Folder /></span>
                    <div className="settings-row-copy">
                      <strong>Working directory</strong>
                      <code className="settings-path">{context?.cwd || 'Not available'}</code>
                      {context?.branch && <small>Git branch: {context.branch}</small>}
                    </div>
                  </div>
                </SettingsGroup>

                <SettingsGroup title="About">
                  <DefinitionRow label="Backend">
                    <span className="settings-status-value">
                      <span className={`connection-dot is-${backend.state}`} />
                      {backend.state === 'ready' ? 'Connected · local stdio' : backend.message || backend.state}
                    </span>
                  </DefinitionRow>
                  <DefinitionRow label="Codex version">{info ? `v${info.implementationVersion}` : 'Loading…'}</DefinitionRow>
                  <DefinitionRow label="Target app">{info ? `${info.targetVersion} (${info.targetBuild})` : '26.1016.62342 (21477)'}</DefinitionRow>
                  <DefinitionRow label="Target app-server">{info?.targetAppServerVersion || '0.163.0'}</DefinitionRow>
                </SettingsGroup>
              </section>
            ) : tab === 'account' ? (
              <section id="settings-account-panel" role="tabpanel" aria-labelledby="settings-account-tab" className="settings-panel" tabIndex={0}>
                <div className="settings-panel-heading account-heading">
                  <div>
                    <h3>Account</h3>
                    <p>Manage the ChatGPT account used by Codex.</p>
                  </div>
                  <button type="button" className="settings-icon-button" aria-label="Refresh account" title="Refresh account" disabled={accountLoading || accountAction !== null} onClick={() => void loadAccount()}>
                    <RefreshCw className={accountLoading ? 'spin' : undefined} />
                  </button>
                </div>

                {accountLoading && !account ? (
                  <div className="account-loading" role="status">
                    <LoaderCircle className="spin" />
                    <span>Checking account…</span>
                  </div>
                ) : accountView ? (
                  <div className={`account-card is-${accountView.status}`}>
                    <div className="account-avatar" aria-hidden="true">
                      {accountView.status === 'connected' ? <CheckCircle2 /> : accountView.status === 'required' ? <CircleAlert /> : <Info />}
                    </div>
                    <div className="account-card-copy">
                      <small>{accountView.eyebrow}</small>
                      <strong>{accountView.title}</strong>
                      <p>{accountView.description}</p>
                      {accountView.plan && <span className="plan-badge">{planLabel(accountView.plan)} plan</span>}
                    </div>
                    <div className="account-card-action">
                      {accountView.canLogin && (
                        <button type="button" className="settings-primary-button" disabled={accountAction !== null || backend.state !== 'ready'} onClick={() => void login()}>
                          {accountAction === 'login' ? <LoaderCircle className="spin" /> : <LogIn />}
                          {accountAction === 'login' ? 'Waiting for sign-in…' : 'Sign in with ChatGPT'}
                        </button>
                      )}
                      {accountView.canLogout && (
                        <button type="button" className="settings-secondary-button danger" disabled={accountAction !== null || backend.state !== 'ready'} onClick={() => void logout()}>
                          {accountAction === 'logout' ? <LoaderCircle className="spin" /> : <LogOut />}
                          {accountAction === 'logout' ? 'Signing out…' : 'Sign out'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                {accountError && (
                  <div className="settings-error" role="alert">
                    <CircleAlert />
                    <span>{accountError}</span>
                  </div>
                )}

                {account?.account?.type === 'chatgpt' && (
                  <SettingsGroup title="Usage limits" className="usage-settings-group">
                    {rateLimitsLoading ? (
                      <div className="rate-limits-message"><LoaderCircle className="spin" /> Loading usage…</div>
                    ) : rateLimits.length ? (
                      <div className="rate-limit-list">
                        {rateLimits.map((limit, limitIndex) => (
                          <RateLimitCard key={limit.limitId || `limit-${limitIndex}`} limit={limit} />
                        ))}
                      </div>
                    ) : (
                      <div className="rate-limits-message muted">
                        <Gauge />
                        {rateLimitsError ? 'Usage information is unavailable right now.' : 'No usage limits were returned for this account.'}
                      </div>
                    )}
                  </SettingsGroup>
                )}

                <p className="account-security-note">
                  Sign-in is completed in your browser. This app never asks for or displays an API key.
                </p>
              </section>
            ) : (
              <IntegrationsSettings backend={backend} cwd={context?.cwd ?? null} />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function SettingsGroup({
  title,
  className,
  children
}: {
  title: string
  className?: string
  children: ReactNode
}): ReactNode {
  return (
    <section className={`settings-group${className ? ` ${className}` : ''}`}>
      <h4>{title}</h4>
      <div className="settings-group-card">{children}</div>
    </section>
  )
}

function DefinitionRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="settings-definition-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

function RateLimitCard({ limit }: { limit: RateLimitSnapshot }): ReactNode {
  const windows = [limit.primary, limit.secondary].filter(
    (window): window is RateLimitWindow => Boolean(window)
  )
  return (
    <article className="rate-limit-card">
      <div className="rate-limit-title">
        <strong>{limit.limitName || limit.limitId || 'Codex usage'}</strong>
        {limit.planType && <small>{planLabel(limit.planType)}</small>}
      </div>
      {windows.map((window, index) => (
        <div className="rate-window" key={`${window.windowDurationMins || 'window'}-${index}`}>
          <div className="rate-window-label">
            <span>{rateLimitWindowLabel(window, index === 0 ? 'Primary limit' : 'Secondary limit')}</span>
            <strong>{Math.round(window.usedPercent)}% used</strong>
          </div>
          <div className="rate-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(window.usedPercent)}>
            <span style={{ width: `${window.usedPercent}%` }} />
          </div>
          {resetDescription(window.resetsAt) && <small>{resetDescription(window.resetsAt)}</small>}
        </div>
      ))}
      {limit.credits && (
        <div className="credits-row">
          <span>Credits</span>
          <strong>{limit.credits.unlimited ? 'Unlimited' : limit.credits.balance || (limit.credits.hasCredits ? 'Available' : 'Unavailable')}</strong>
        </div>
      )}
    </article>
  )
}
