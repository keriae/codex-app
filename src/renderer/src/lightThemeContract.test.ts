import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const composerMenuStyles = readFileSync(new URL('./composerMenus.css', import.meta.url), 'utf8')
const discoveryStyles = readFileSync(new URL('./DiscoveryPages.css', import.meta.url), 'utf8')
const queuedMessageStyles = readFileSync(new URL('./queuedMessageList.css', import.meta.url), 'utf8')
const remoteConnectionStyles = readFileSync(new URL('./RemoteConnectionDialog.css', import.meta.url), 'utf8')
const remoteProjectStyles = readFileSync(new URL('./RemoteProjectDialog.css', import.meta.url), 'utf8')
const sshDiscoveryStyles = readFileSync(new URL('./SshConnectionDiscoveryDialog.css', import.meta.url), 'utf8')

interface CssRule {
  selectors: string[]
  declarations: Map<string, string>
}

function cssRules(source: string): CssRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const selectors = (match[1] || '')
      .split(',')
      .map((selector) => selector.replace(/\s+/g, ' ').trim())
    const declarations = new Map<string, string>()
    for (const declaration of (match[2] || '').split(';')) {
      const separator = declaration.indexOf(':')
      if (separator < 0) continue
      const property = declaration.slice(0, separator).trim()
      const value = declaration.slice(separator + 1).trim()
      if (property && value) declarations.set(property, value)
    }
    return { selectors, declarations }
  })
}

function propertyValues(declarations: Map<string, string>, property: string): string[] {
  const values: string[] = []
  for (const [candidate, value] of declarations) {
    const matches = candidate === property ||
      (property === 'background' && candidate === 'background-color') ||
      (property.startsWith('border') && /^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(candidate))
    if (matches) values.push(value)
  }
  return values
}

function declarationsFor(source: string, selector: string): Map<string, string>[] {
  return cssRules(source)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations)
}

function declaration(source: string, selector: string, property: string): string | undefined {
  return declarationsFor(source, selector)
    .flatMap((declarations) => propertyValues(declarations, property))
    .find((value): value is string => Boolean(value))
}

function isThemeBacked(value: string | undefined): boolean {
  return Boolean(value && value.includes('var(--'))
}

function expectThemeAware(
  source: string,
  selector: string,
  property: string = 'background'
): void {
  const baseValues = declarationsFor(source, selector)
    .flatMap((declarations) => propertyValues(declarations, property))
    .filter((value): value is string => Boolean(value))
  const lightValues = declarationsFor(source, `:root[data-theme='light'] ${selector}`)
    .flatMap((declarations) => propertyValues(declarations, property))
    .filter((value): value is string => Boolean(value))

  expect(
    baseValues.some(isThemeBacked) || lightValues.length > 0,
    `${selector} must use a theme token or define a light-theme ${property}`
  ).toBe(true)
}

describe('light appearance CSS contract', () => {
  it('defines a complete semantic palette for both dark and light appearances', () => {
    const dark = declarationsFor(styles, ':root')[0]
    const light = declarationsFor(styles, ":root[data-theme='light']")[0]
    expect(dark).toBeDefined()
    expect(light).toBeDefined()

    const tokens = [
      '--window',
      '--rail',
      '--sidebar',
      '--main',
      '--main-raised',
      '--composer',
      '--composer-hover',
      '--surface',
      '--surface-hover',
      '--surface-active',
      '--surface-strong',
      '--surface-card',
      '--surface-control',
      '--surface-control-hover',
      '--surface-menu',
      '--surface-output',
      '--surface-code',
      '--surface-user-message',
      '--hover',
      '--hover-subtle',
      '--hover-strong',
      '--bg',
      '--text',
      '--text-secondary',
      '--text-muted',
      '--text-faint',
      '--border',
      '--border-strong',
      '--shadow-color',
      '--shadow-soft',
      '--scrim',
      '--accent',
      '--accent-text',
      '--danger',
      '--success'
    ]

    for (const token of tokens) {
      expect(dark?.has(token), `${token} is missing from the default palette`).toBe(true)
      expect(light?.has(token), `${token} is missing from the light palette`).toBe(true)
    }

    expect(dark?.get('color-scheme')).toBe('dark')
    expect(light?.get('color-scheme')).toBe('light')
    for (const token of ['--main', '--text', '--surface-menu', '--surface-user-message']) {
      expect(light?.get(token), `${token} must visibly change in light mode`).not.toBe(dark?.get(token))
    }
  })

  it('keeps the primary shell, settings, composer and chat surfaces theme-aware', () => {
    for (const [selector, property] of [
      ['body', 'background'],
      ['.app-shell', 'background'],
      ['.main-panel', 'background'],
      ['.sidebar', 'background'],
      ['.settings-page', 'background'],
      ['.settings-page-sidebar', 'background'],
      ['.settings-page-card', 'background'],
      ['.settings-page-search', 'background'],
      ['.composer', 'background'],
      ['.user-message', 'background'],
      ['.output-panel', 'background']
    ] as const) {
      expectThemeAware(styles, selector, property)
    }

    expect(isThemeBacked(declaration(styles, '.main-panel', 'border-left'))).toBe(true)
    expect(isThemeBacked(declaration(styles, '.settings-page-sidebar', 'border-right'))).toBe(true)
  })

  it('covers menus and dialogs without relying on dark-only surfaces', () => {
    for (const [source, selector] of [
      [styles, '.sidebar-section-menu'],
      [styles, '.thread-row-menu'],
      [styles, '.agent-message-menu'],
      [composerMenuStyles, '.composer-menu-popover'],
      [styles, '.approval-dialog'],
      [styles, '.thread-dialog'],
      [remoteConnectionStyles, '.remote-connection-dialog'],
      [remoteProjectStyles, '.remote-project-dialog'],
      [sshDiscoveryStyles, '.ssh-discovery-dialog']
    ] as const) {
      expectThemeAware(source, selector)
    }
  })

  it('keeps close controls visible on light remote dialogs', () => {
    for (const [source, selector] of [
      [remoteConnectionStyles, '.remote-dialog-close'],
      [remoteProjectStyles, '.remote-project-dialog-close'],
      [sshDiscoveryStyles, '.ssh-discovery-close']
    ] as const) {
      expect(declaration(source, `:root[data-theme='light'] ${selector}`, 'color'))
        .toMatch(/rgb\(13 13 13 \/ 72%\)/)
    }
  })

  it('keeps manual SSH field hints visible in light mode', () => {
    expect(declaration(
      remoteConnectionStyles,
      ":root[data-theme='light'] .remote-dialog-field input::placeholder",
      'color'
    )).toMatch(/rgb\(13 13 13 \/ 50%\)/)
    expect(declaration(
      remoteConnectionStyles,
      ":root[data-theme='light'] .remote-dialog-identity-field svg",
      'color'
    )).toMatch(/rgb\(13 13 13 \/ 50%\)/)
  })

  it('provides light treatment for project and marketplace discovery surfaces', () => {
    for (const [selector, property] of [
      ['.discovery-search', 'border'],
      ['.rail-explore-menu', 'background'],
      ['.projects-page', 'background'],
      ['.projects-page-row', 'border-bottom'],
      ['.marketplace-page', 'background'],
      ['.marketplace-sidebar', 'background'],
      ['.marketplace-row:hover', 'background'],
      ['.marketplace-modal', 'background']
    ] as const) {
      expectThemeAware(discoveryStyles, selector, property)
    }
  })

  it('provides light treatment for queued messages and their transient UI', () => {
    for (const [selector, property] of [
      ['.queued-message-list', 'background'],
      ['.queued-message-row', 'color'],
      ['.queued-message-copy', 'color'],
      ['.queued-message-preview-popover', 'background'],
      ['.queued-message-menu', 'background']
    ] as const) {
      expectThemeAware(queuedMessageStyles, selector, property)
    }
  })
})
