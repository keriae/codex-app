# Independent Codex startup routing

The installed 26.1016.62342 / 21477 package is a unified ChatGPT/Codex desktop
runtime. A fresh independent desktop profile displayed its ChatGPT welcome
page even though the original renderer and the backend handshake loaded
correctly. This was reproduced in the native `Codex Study Verified.app`
window after the user unlocked macOS on 2026-10-24.

The reconstruction bootstrap now initializes **missing local preferences**
inside its independent `codex-home/.codex-global-state.json`, under
`electron-persisted-atom-state`. It preserves every existing value, including
`false`, `null`, an explicit Chat preference, and unrelated global state. It
does not call the hosted onboarding completion function or install suggested
plugins. The setting is recorded as `startupMode: "work"` in the package's
isolation configuration and reconstruction report.

| Local atom | Initial value | Shipped source evidence |
| --- | --- | --- |
| `electron:onboarding-projectless-completed` | `true` | `app-initial` defines `Ryi` at character 5,061,755; `Yyi` treats completion as sufficient even without workspace roots. |
| `electron:onboarding-welcome-pending` | `false` | `TL` initializes `Zyi` with `Lg(..., false)`. |
| `electron:onboarding-override` | `"auto"` | `TL` initializes `Xyi` with `Lg(..., "auto")`. `onboarding-page` function `tl` shows welcome only when override is `welcome`, pending is true, or completion is false. |
| `electron:onboarding-welcome-v2-role-state` | `{roles:["default"],personalizedSuggestionsEnabled:false,workMode:"coding"}` | `TL` defines the role record; `fbi` maps generic `default`, `engineering`, and `data_science` to `coding`. Generic `default` does not assert a profession. |
| `home-composer-mode-v1` | `"work"` | `app-initial` defines `YJt` at character 2,100,239; `eYt` otherwise falls back to `chat`. `JJt` routes an available Work surface using this preference. |

Character offsets refer to decoded UTF-8 JavaScript strings, not ASAR byte
offsets. The exact extracted source files are:

| File under the source ASAR | SHA-256 |
| --- | --- |
| `webview/assets/app-initial-dddef47d6ef6.js` | `1fc7b685efab4be2d9656e02086180dd9e43dcac0fae1e2b1ec233447ed03843` |
| `webview/assets/onboarding-page-54446705e6a5.js` | `333013d8adee3713ad3a840762f455a241e93b457c94a0a0df79776a78bf304a` |
| `.vite/build/main-JI9qDiXp.js` | `b8c5d07cc3c30fbf0abe729b05434e7d1ffa19ee6c4daa818ae8f855be66d1e1` |
| `.vite/build/startup-requirements-noLGSvyx.js` | `37317264da9aec7c843e0a57512be930d2e581f10b6c042d4e33ea8adc5325a8` |

The main bundle's `sendPersistedAtomState` sends the global state's
`electron-persisted-atom-state` to the renderer. `startup-requirements` defines
that supported state key. The welcome page's `Pc` separately submits hosted
role/onboarding data when authentication is ChatGPT; the bootstrap does not
invoke that function.

Writes use an exclusive private temporary file followed by rename. A state
symlink, non-file, malformed JSON, invalid record, or stale temporary file
fails before overwriting the existing file. The delivered-bootstrap verifier
checks both these cases and preserving existing choices. This patch remains
confined to the already reviewed isolation infrastructure; no renderer file
is edited.
