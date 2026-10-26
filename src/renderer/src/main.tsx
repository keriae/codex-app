import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './composerMenus.css'
import './composerAddMenu.css'
import './composerTemplates.css'
import './titlebarMenus.css'

let storedTheme: string | null = null
try {
  storedTheme = window.localStorage.getItem('codex-theme')
} catch {
  // A restricted storage context should still render with the native system appearance.
}
const initialTheme = storedTheme === 'light' || storedTheme === 'dark'
  ? storedTheme
  : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = initialTheme
document.documentElement.style.colorScheme = initialTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
