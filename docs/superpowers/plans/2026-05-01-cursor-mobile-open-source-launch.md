# Cursor Mobile Open Source Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and publish the project as a public GitHub repository named `cursor-mobile`.

**Architecture:** This is a repository launch task, not a runtime architecture change. The implementation updates project metadata, public documentation, release hygiene, CI, and GitHub repository state while preserving the existing Node/TypeScript server, React/Vite PWA, and SwiftUI menu bar app.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript, Vitest, React/Vite, Swift Package Manager, GitHub Actions, GitHub CLI.

---

## File Structure

- Modify `package.json` and workspace package manifests to use `cursor-mobile` naming.
- Modify `README.md` to describe the project for GitHub visitors.
- Modify `.gitignore` to exclude generated, dependency, local, and runtime artifacts.
- Modify web app metadata and visible title strings in `apps/web`.
- Modify server defaults and scripts that expose project naming.
- Create `LICENSE` using MIT.
- Create `.github/workflows/ci.yml` to run install, tests, and build.
- Remove generated artifacts from Git tracking candidates.
- Initialize, commit, create public GitHub repository, and push.

### Task 1: Repository Naming And Metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/menubar/Package.swift`

- [ ] Replace public package names from `codex-mobile` to `cursor-mobile`.
- [ ] Keep versions at `0.1.0`.
- [ ] Preserve `private: true` for npm package safety.
- [ ] Run `npm install --package-lock-only` so lockfile package names match.

### Task 2: Public Documentation And License

**Files:**
- Modify: `README.md`
- Create: `LICENSE`

- [ ] Rewrite README with project description, features, architecture, prerequisites, quick start, configuration, safety model, development commands, and limitations.
- [ ] Add MIT license for open-source publication.

### Task 3: Release Hygiene And CI

**Files:**
- Modify: `.gitignore`
- Create: `.github/workflows/ci.yml`

- [ ] Exclude `node_modules`, `dist`, `.build`, `.npm-cache`, `.qa`, generated launchd plist files, logs, runtime databases, and local environment files.
- [ ] Add GitHub Actions workflow using Node 22 with `npm ci`, `npm test`, and `npm run build`.

### Task 4: Source Branding Updates

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/public/manifest.webmanifest`
- Modify: `apps/web/src/main.jsx`
- Modify: server scripts/config files where naming appears.

- [ ] Update user-visible project naming to Cursor Mobile.
- [ ] Keep internal environment variable prefix `CODEX_MOBILE_` for compatibility in this first launch unless a rename is necessary for user-facing clarity.

### Task 5: Verify, Commit, And Publish

**Files:**
- All source, config, docs, and scripts intended for release.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Inspect `git status --short` and exclude generated artifacts.
- [ ] Commit launch-ready project files.
- [ ] Create public GitHub repository `cursor-mobile` with `gh repo create`.
- [ ] Push `main` to GitHub.

