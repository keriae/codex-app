import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const forwarded = []
const env = { ...process.env }
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cwd') {
    if (!args[i + 1]) throw new Error('--cwd requires a path')
    env.CODEX_WORKSPACE = args[++i]
  } else if (args[i].startsWith('--cwd=')) env.CODEX_WORKSPACE = args[i].slice(6)
  else forwarded.push(args[i])
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url)), 'dev', ...forwarded], { env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
