# Cursor Mobile Open Source Launch Design

## Goal

Prepare the current Codex Mobile project for a public GitHub launch under the name `cursor-mobile`.

## Positioning

`cursor-mobile` is a mobile-first companion for running Cursor or Codex agent tasks from an iPhone while the actual work runs on a Mac. The project should be presented as a local-first tool for trusted personal networks, with Tailscale as the recommended access path.

## Scope

- Rename public-facing project references from Codex Mobile to Cursor Mobile where the repository identity or UI brand is involved.
- Keep existing implementation boundaries: Node/TypeScript server, React/Vite PWA, and SwiftUI menu bar companion.
- Publish only source, scripts, config, and documentation.
- Exclude dependencies, build output, Swift build artifacts, runtime data, logs, and local machine launchd output from the repository.
- Add an MIT license and GitHub Actions workflow for basic build and test verification.
- Create a public GitHub repository named `cursor-mobile` and push the prepared repository.

## Documentation

The README should target first-time GitHub visitors. It should explain what the project is, why it exists, the architecture, prerequisites, quick start, production-style local service setup, iPhone access over Tailscale, configuration, safety defaults, and current limitations.

## Safety And Release Readiness

The project should not ship local absolute paths, secrets, `.env`, generated bundles, dependency folders, or runtime databases. Verification should include at least `npm test` and `npm run build` before publishing.

