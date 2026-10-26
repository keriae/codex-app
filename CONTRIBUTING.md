# Contributing

Thanks for helping improve this macOS `codex-app` client reconstruction. This repository is an independent interoperability and learning project; it is not affiliated with or endorsed by OpenAI.

## Development setup

Use macOS 13 or newer and Node.js 24.11 or newer.

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

## Pull requests

- Keep changes focused and explain the behavior they add or correct.
- Add tests for protocol, state-management, security, and recovery changes.
- Include reproducible steps or privacy-safe visual evidence for UI parity work.
- Call out platform assumptions and remaining gaps explicitly.

## Public-source boundary

Do not commit credentials, account data, private conversations, local profiles, proprietary application bundles, extracted vendor source, or unlicensed vendor artwork. Keep raw captures and generated reconstruction output under the ignored paths documented in `.gitignore`; commit only reviewed summaries, original implementation code, and redistributable assets.

Dependency lockfiles must use the public npm registry. Replace personal paths, hosts, email addresses, and other environment-specific identifiers with synthetic examples before committing.

## License status

The project is currently source-available for study and does not yet include an open-source license. By contributing, you confirm that you have the right to submit your work; project-wide licensing will be handled separately by the maintainers.
