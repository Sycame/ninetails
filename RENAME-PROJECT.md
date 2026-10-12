# Renaming the project

Two ways: run a script that does all of it ([Section 0](#0-the-quick-way-run-a-script)), or follow the checklist
below by hand. The checklist is also the specification of what the scripts do, and it covers the parts a script cannot
reach (Section 7: server, GitLab, DNS).

Every place the current name, **Ninetails**, appears, listed so the whole project can be renamed by hand. Written for the name
`ninetails`; replace it with your new name. Searched on 2026-10-10, excluding generated folders (`node_modules`,
`dist`, `.angular`). About 400 occurrences in 40 files; most are in the four documentation files.

Line numbers are for orientation only and drift as files change. Search for the quoted text instead.

---

## 0. The quick way: run a script

Two scripts in this folder do everything in Sections 3 and 6 for you (text in all files, the Go module and imports,
the Angular project, folder and file names, the generated folders), then check for leftovers and build the API:

| Where you run it | Script | Needs |
|---|---|---|
| Windows | `rename-project.ps1` | PowerShell 5.1 or newer (built in) |
| RHEL 8 / 9 (or any Linux, Git Bash) | `rename-project.sh` | bash 4+, GNU `sed`, `find`, `grep`, `tar` (all standard on RHEL) |

Both take the same decisions as Section 1 and give the same result. Pick one; do not run both.

**Windows (PowerShell), from this folder:**

```powershell
.\rename-project.ps1 foo-bar -DryRun                    # 1. look first: lists every change, changes nothing
.\rename-project.ps1 foo-bar                            # 2. do it (asks you to type "yes"; makes a backup copy first)
```

If PowerShell refuses to run scripts: `powershell -ExecutionPolicy Bypass -File .\rename-project.ps1 foo-bar -DryRun`

**RHEL (bash), from this folder:**

```
bash rename-project.sh foo-bar --dry-run                # 1. look first
bash rename-project.sh foo-bar                          # 2. do it
```

**Options** (PowerShell form / bash form):

| Option | Meaning |
|---|---|
| `foo-bar` (first argument) | The new lowercase name: letters, digits, single hyphens, starts with a letter. |
| `-DisplayName "Foo Bar"` / `--display "Foo Bar"` | The name shown to people. Default: the new name in Title Case. |
| `-EnvName FOO_BAR` / `--env-name FOO_BAR` | Environment variable prefix without the final `_`. Default: upper case, `-` becomes `_`. |
| `-DryRun` / `--dry-run` | Only list what would change. |
| `-Yes` / `--yes` | Do not ask for confirmation. |
| `-NoBackup` / `--no-backup` | Skip the backup. Otherwise a copy is made next to the project folder (`<folder>-backup-<time>`, a folder on Windows, a `.tar.gz` on RHEL), without `node_modules`. |
| `-RenameRoot` / `--rename-root` | Also rename the project's root folder. **On Windows run the script from the parent folder** (`cd ..` then `.\ninetails\rename-project.ps1 foo-bar -RenameRoot`) and close editors that have the project open, because a folder cannot be renamed while a terminal is inside it. |
| `-OldName` `-OldDisplayName` `-OldEnvName` / `--old-name` `--old-display` `--old-env-name` | Only if the project has been renamed before and you are renaming it again. Defaults describe `ninetails`. |

**What the scripts do, in order**

1. Print the replacement table and the full plan (files, folders, counts). With the dry-run option, stop here.
2. Ask you to type `yes`.
3. Back up the project.
4. Replace the name inside every text file, in four case-sensitive forms: `NinetailsApp` -> `FooBarApp`,
   `NINETAILS` -> `FOO_BAR`, `ninetails` -> `foo-bar`, `Ninetails` -> `Foo Bar`. Binary files (icons, fonts) and
   `node_modules`, `dist`, `.angular`, `.git` are skipped. Line endings and byte-order marks are preserved.
5. Delete the generated folders `ninetails-app/dist` and `ninetails-app/.angular` (they hold the old name and are rebuilt).
6. Rename folders and files whose name contains the old name, deepest first (the list is in Section 6).
7. Search again, case-insensitively, for anything left. The expected result is "none found".
8. If Go is installed: `go build ./...`, `go vet ./...` and `gofmt -l .` in the API folder; all must be clean.
9. With the root-folder option: rename the root folder.

**What the scripts do not touch:** this file, `rename-project.ps1` and `rename-project.sh` (they describe the old name, so
they keep it), and everything outside this folder (Section 7: server paths, service names, `/etc/...env` variable names,
GitLab Application, DNS). They also do not run `npm`: after the rename run `npm install` and `npm run build` in the app
folder.

**After the script**

1. [ ] `cd <slug>-app`, `npm install`, `npm run build`: should succeed with output in `dist/<slug>-app/browser`.
2. [ ] Start the API (`go run ./cmd/<slug>-api` in the API folder) and the app; check the tab title, header, login card and footer.
3. [ ] Do the outside-the-repo items in Section 7. In particular the settings file on a deployed server: every variable
       needs the new prefix or the service starts on **defaults, including no login**.
4. [ ] Delete the backup when you are happy.

The new name must not contain the old one (for example renaming `foo` to `foobar`): the script refuses, because the new
text would be rewritten again. Rename in two steps (`foo` -> `tmpname` -> `foobar`) if you really need that.

---

## 1. Decide the name first

The name appears in six forms. Decide each one before you start. Write the new values here:

| # | Form | Used for | Today | New |
|---|---|---|---|---|
| A | Display name | What people read: page titles, header, login card, footer, API docs title | `Ninetails` | |
| B | Lowercase slug | Folder names, Go module, binary, service, paths, localStorage keys | `ninetails` | |
| C | API name | `<slug>-api`: folder, Go module, executable, service | `ninetails-api` | |
| D | App name | `<slug>-app`: folder, Angular project, npm package | `ninetails-app` | |
| E | Env var prefix | Every API setting, upper case | `NINETAILS_` | |
| F | Angular title form | Page `<title>` generated from the project name (CamelCase + App) | `NinetailsApp` | |

Rules of thumb:

- Form B, C, D should stay consistent (`foo`, `foo-api`, `foo-app`). Use lowercase letters, digits and hyphens only: the
  Go module path, npm package name and Angular project name do not allow spaces or capitals.
- Form E must be a valid environment variable name: upper case letters, digits and underscore (`FOO_`).
- **Replace the longest forms first** (`ninetails-api` and `ninetails-app` before plain `ninetails`), otherwise you
  produce half-renamed names such as `foo-api` in one place and `foo` in another by accident of order.
- Plain "search and replace all" is risky for form B (it also appears inside words and paths). Use the file lists below.
- The display name is independent of everything else: you can change only form A (Section 4) and leave all technical names alone.

Which parts depend on each other, so they must change together:

| Group | Must be changed together |
|---|---|
| Go | folder `cmd/ninetails-api`, `go.mod` module, every `import "ninetails-api/..."`, build command `-o ninetails-api`, `.gitignore` |
| Angular | `angular.json` project key + 2 `buildTarget`s, `package.json`, `package-lock.json`, docs that mention `dist/ninetails-app/...` |
| Env vars | `settings.go`, `openapi.json`, the server's `/etc/<slug>-api.env`, every doc |
| Server | folders, service account, systemd unit, nginx file, certificate names (Section 7); these only matter if you rename them on the VM |
| Browser | `localStorage` keys in 4 files (Section 3, App) |

## 2. Before you start

- [ ] (Manual rename only; the scripts do the backup for you.) Stop the API and `npm start` if they are running.
- [ ] Make a backup copy of the whole folder (this workspace is not a git repository, so there is no undo).
- [ ] Optional: delete generated folders, which contain the old name and are rebuilt: `ninetails-app/dist`,
      `ninetails-app/.angular`. Keep `node_modules` (it contains no project names; do not touch it).
- [ ] **Rename the folders last** (Section 6), after the contents are edited, or the paths in this list will not match.

---

## 3. Files to edit

Tick each file when done. "Replace" means the old text with the new equivalent form from Section 1.

### API (`ninetails-api/`)

**Module and imports (form C)**

- [ ] `go.mod` line 1: `module ninetails-api` -> `module <slug>-api`
- [ ] Every Go file that imports the module. In each, replace the prefix `ninetails-api/` in the import lines
      (`"ninetails-api/internal/model"` -> `"<slug>-api/internal/model"`):

| File | Imports to change (approx. lines) |
|---|---|
| `cmd/ninetails-api/main.go` | 15-22 (8 imports: `data`, `internal/api`, `auth`, `events`, `model`, `settings`, `sim`, `store`) |
| `internal/api/dev.go` | 10-12 (`events`, `model`, `store`) |
| `internal/api/middleware.go` | 11 (`auth`) |
| `internal/api/server.go` | 16-20 (`auth`, `docs`, `events`, `model`, `store`) |
| `internal/sim/sim.go` | 13-14 (`model`, `store`) |
| `internal/store/config.go` | 18-19 (`events`, `model`) |
| `internal/store/deployments.go` | 10-11 (`events`, `model`) |
| `internal/store/status.go` | 7-8 (`events`, `model`) |
| `internal/store/validate.go` | 6 (`model`) |

  Tip: the compiler finds any you miss: `go build ./...` reports `package <old>/... is not in std`.

**Other code in the API**

- [ ] `cmd/ninetails-api/main.go` line 1, comment: `// Command ninetails-api is the REST backend for the Ninetails dashboard.` (forms C and A)
- [ ] `internal/api/server.go` line ~225: `Bearer realm="ninetails"` (form B; this string is sent to clients in the `WWW-Authenticate` header)
- [ ] `internal/docs/docs.go` line 2, comment: `works offline like the rest of Ninetails` (form A)
- [ ] `internal/docs/swaggerui/index.html` line 6: `<title>Ninetails API</title>` (form A, shown in the browser tab of `/docs`)
- [ ] `data/data.go` line 2, comment: mentions `NINETAILS_CONFIG_FILE` (form E)

**Environment variable prefix (form E)**: the names are defined in one place and described in a few comments:

- [ ] `internal/settings/settings.go`: line 31 (comment `NINETAILS_*`) and these 12 variable names, each appearing as a
      string in the code and in some error messages (lines ~34-64):
      `ADDR`, `AUTH`, `GITLAB_URL`, `ALLOWED_GROUPS`, `PIPELINE_URL`, `CONFIG_FILE`, `LOCKED_ENVS`, `CORS_ORIGIN`,
      `LOG_LEVEL`, `SIMULATE`, `SIMULATE_EVERY`, `DEV_TOOLS`. Check the three error messages mentioning `NINETAILS_AUTH`,
      `NINETAILS_SIMULATE`, `NINETAILS_SIMULATE_EVERY`, `NINETAILS_DEV_TOOLS` (each appears twice).
- [ ] `internal/api/dev.go` line 24 (comment: `NINETAILS_DEV_TOOLS`) and line 71 (message: `NINETAILS_SIMULATE=false`)

**API documentation served at `/docs`**

- [ ] `internal/docs/openapi.json` (is embedded in the binary, so rebuild after editing):
  - line 4: `"title": "Ninetails API"` (forms A)
  - line 6: `REST backend for the Ninetails rack dashboard` (A)
  - line 15: Dev tools tag description: `NINETAILS_DEV_TOOLS`, `NINETAILS_AUTH=dev` (E)
  - line 157: `/dev/simulation` description: `NINETAILS_SIMULATE=false` (E)
  - line 303: bearer scheme description: `NINETAILS_AUTH=dev` (E)

**Build files**

- [ ] `.gitignore` lines 2-3: `/ninetails-api` and `/ninetails-api.exe` (the built binary's name, form C); line 6: comment mentioning `NINETAILS_CONFIG_FILE` (E)
- [ ] `README.md` (API): see Section 5

### App (`ninetails-app/`)

**Angular project (form D)**

- [ ] `angular.json`: line 9, the project key `"ninetails-app": {` and lines 67 and 70, `"buildTarget": "ninetails-app:build:production"` and
      `...:development`. All three must match each other. The build output folder `dist/ninetails-app/` follows the
      project key automatically.
- [ ] `package.json` line 2: `"name": "ninetails-app"`
- [ ] `package-lock.json` lines 2 and 8: both `"name": "ninetails-app"` (edit by hand, or delete the file and run `npm install`
      to regenerate it; if you delete it, versions are re-resolved, so prefer editing the two lines)
- [ ] `.gitlab-ci.yml` (hidden file, easy to miss): 9 occurrences of `ninetails-app` (the `cd`, cache key path, artifact
      path and name, `rm`, and the comments). Form C only; they must match the renamed app folder (Section 6). In GitLab,
      the project's "CI/CD configuration file" setting (`ninetails-app/.gitlab-ci.yml`) must be updated to the new path (Section 7)

**Page title and display text (form A / F)**

- [ ] `src/index.html` line 5: `<title>NinetailsApp</title>` (form F; shown in the browser tab)
- [ ] `src/app/layout/header.component.html` line 6: `Ninetails` (form A)
- [ ] `src/app/features/login/login.component.html` line 5: `Ninetails` (A)
- [ ] `src/app/layout/footer.component.html` line 11: `© {{ year }} Ninetails` (A)

**Browser storage keys (form B)**: one-time effect: everyone is signed out once and the cached baseline is refetched. Harmless.

- [ ] `src/index.html` line 13: `localStorage.getItem('ninetails.theme')` (inline script that avoids a flash on load)
- [ ] `src/app/core/theme.service.ts` line 6: `const KEY = 'ninetails.theme';` (must equal the line in `index.html`, or the theme flickers on load)
- [ ] `src/app/core/config.service.ts` line 10: `const CACHE_KEY = 'ninetails.config';`
- [ ] `src/app/core/auth.service.ts` lines 8-11: `ninetails.session`, `ninetails.pkce.verifier`, `ninetails.pkce.state`, `ninetails.pkce.return`

**Docs**

- [ ] `docs/api.md` line 1 (`# Ninetails backend API (v1)`, form A) and line 3 (`../../ninetails-api`, form C)
- [ ] `README.md` (App): see Section 5

### Files with no occurrences (checked, nothing to change)

`proxy.conf.json`, `tsconfig*.json`, `.editorconfig`, `.prettierrc`, `.vscode/*`, `public/mock/*` (mock JSON),
`src/environments/environment.ts`, `src/main.ts`, `data/*.json` (sample inventory), the `swaggerui` vendored files other
than `index.html`, and the other Go files. The remaining app source (styles, components, services) has no name in it.

### Root folder (`ninetails/`)

- [ ] `DEPLOY-PRODUCTION.md`, `DEV-TESTING.md`: see Section 5
- [ ] `RENAME-PROJECT.md` (this file), `rename-project.ps1`, `rename-project.sh`: describe the old name on purpose; see Section 9

---

## 4. Only the display name (smallest change)

If you only want a different name on screen and in the API docs, change just form A in these places and nothing else:

- [ ] `ninetails-app/src/index.html` line 5 (tab title; form F)
- [ ] `ninetails-app/src/app/layout/header.component.html` line 6
- [ ] `ninetails-app/src/app/features/login/login.component.html` line 3
- [ ] `ninetails-app/src/app/layout/footer.component.html` line 11
- [ ] `ninetails-api/internal/docs/openapi.json` lines 4 and 6
- [ ] `ninetails-api/internal/docs/swaggerui/index.html` line 6

Nothing breaks and no one is signed out.

---

## 5. Documentation files (what to look for)

These four files mention the name many times. Use find-and-replace on them after the code is done, but check the kinds of
occurrence below, because several are server paths, not just words.

| File | Occurrences | Kinds |
|---|---|---|
| `DEPLOY-PRODUCTION.md` | ~150 | all of the below |
| `ninetails-api/README.md` | ~95 | forms A, C, E; server paths; folder links |
| `ninetails-app/README.md` | ~25 | forms A, C, D; nginx and server paths |
| `DEV-TESTING.md` | ~30 | forms C, D, E; folder paths |

Occurrence types and what each one means:

| Text in the docs | What it is | Rename it if you rename... |
|---|---|---|
| `Ninetails` (heading, "the Ninetails dashboard") | display name | form A |
| `ninetails-api`, `ninetails-app` (folder links, `cd ninetails-api`, `../ninetails-app/...`) | repo folders | the folders (Section 6) |
| `./cmd/ninetails-api` | Go build path | the `cmd/` folder |
| `go build -o ninetails-api` | executable name | the binary |
| `dist/ninetails-app/browser` | Angular build output | the Angular project key |
| `NINETAILS_*` | API settings | form E |
| `/opt/ninetails-api/ninetails-api`, `/opt/ninetails-api` | install folder and binary on the VM | VM names (Section 7) |
| `/etc/ninetails-api.env` | API settings file on the VM | VM names |
| `/etc/systemd/system/ninetails-api.service`, `systemctl ... ninetails-api`, `journalctl -u ninetails-api` | systemd service | VM names |
| `/var/lib/ninetails`, `/var/lib/ninetails/config.json` | baseline folder and file on the VM; also the service account's home | VM names |
| `useradd ... ninetails`, `User=ninetails`, `Group=ninetails`, `-o ninetails -g ninetails`, `chown root:ninetails` | service account and group | VM names |
| `/var/www/ninetails`, `/var/www/ninetails/releases`, `/var/www/ninetails/current` | web root on the VM | VM names |
| `/var/ninetails-staging`, `/var/ninetails-staging/release-<version>` | upload folder on the VM | VM names |
| `/etc/nginx/conf.d/ninetails.conf` | nginx config file | VM names |
| `/etc/pki/tls/certs/ninetails.crt`, `/etc/pki/tls/private/ninetails.key`, `ninetails.crt/.key` | certificate and key file names | VM names |
| `ninetails.yourcompany.com` | example public host name | your real host name; not a project name |
| `/etc/sudoers.d/ninetails-deploy` | future CI deploy user rights | VM names |
| `/tmp/ninetails-api`, `/tmp/ninetails-browser/` | temporary upload names in the README examples | the example names |
| `ninetails-api.prev` | rollback copy of the binary | the binary |
| `release-<version>` folders | generic, no project name | nothing |

`DEPLOY-PRODUCTION.md` and the two READMEs use the **same** server paths. Rename them identically in all three or the
instructions will disagree with each other. Easiest: pick the new server names (Section 7) first, then replace each
type consistently.

---

## 6. Rename the folders and files (last)

The only folders and files in the repository whose **names** contain the old name are these (checked; the scripts
rename exactly these). Do them after the contents are edited, **inner before outer**, so the paths stay valid:

| # | Order | Before | After | Notes |
|---|---|---|---|---|
| 1 | first | `ninetails-api/cmd/ninetails-api/` | `<slug>-api/cmd/<slug>-api/` | The folder holding `main.go`. Its name becomes the default name of the built executable (`go build ./cmd/<slug>-api`), and the path is in the build commands in the docs. |
| 2 | second | `ninetails-api/` | `<slug>-api/` | The Go service. Every doc link such as `../ninetails-api` refers to it. |
| 3 | second | `ninetails-app/` | `<slug>-app/` | The Angular app. |
| 4 | last, optional | `ninetails/` (this workspace folder) | `<slug>/` | Nothing inside refers to it. |

No individual *file* has the name in its file name; only the folders above do.

Generated folders that contain the old name. Delete them, do not rename them; the next build recreates them:

| Folder | Created by |
|---|---|
| `ninetails-app/dist/ninetails-app/` | `npm run build` (the whole `dist` can go) |
| `ninetails-app/.angular/cache/<version>/ninetails-app/` | Angular's build cache (the whole `.angular` can go) |

Outputs created *later* will use the new names automatically: the API executable you build (`go build -o <slug>-api ...`,
a name you choose in the build command; `.gitignore` already lists it), and `dist/<slug>-app/` (Angular names it after the
project key in `angular.json`).

Also check what points at the old folders from outside the repository: desktop shortcuts, IDE workspace files, terminal
bookmarks, CI or deploy scripts, and `.vscode` tasks if you open a different root.

Renaming a folder that an editor, a terminal or `npm start` has open fails on Windows ("file in use" / "being used by
another process"). Close them first, and run the root rename from the parent folder.

---
## 7. Outside the repository

Not files in this folder, but the name usually appears here too. Decide for each whether to rename it.

| Where | Item |
|---|---|
| **Source control** | Repository name, local clone folder and remote URL (this workspace is not under version control yet). |
| **GitLab** | The GitLab *Application* name (Admin area > Applications) shown on the consent screen at sign-in. The Application ID and redirect URI do not change unless the host name does. |
| **GitLab CI/CD** | Project Settings > CI/CD > General pipelines > "CI/CD configuration file" is `ninetails-app/.gitlab-ci.yml`; change it to `<slug>-app/.gitlab-ci.yml` after the folder rename, or the pipeline stops running. |
| **DNS / certificates** | Public host name (`ninetails.yourcompany.com` in the examples) and the certificate issued for it; the redirect URI in the GitLab Application must match the new host: `https://<host>/auth/callback` |
| **Production VM** | Everything in the server-path rows of Section 5. If the system is already deployed, renaming on the server means: new folders, new service account (or keep the old one), new systemd unit and nginx file, then stop and remove the old ones. It is cleaner to keep the server-side names unchanged and only rename them at the next fresh install. |
| **API settings file** | `/etc/ninetails-api.env` and its contents. If form E changes, **every variable name in this file must change too**, or the service silently starts with the **defaults**, including `dev` auth (everyone accepted without login). After the rename, check the log shows `auth: validating GitLab tokens` and not `DEV MODE`. |
| **CI/CD (later)** | Pipeline variable names, job names and artifact names that use the old name, and any deploy script paths. None exist yet. |
| **Monitoring** | Health check URL host name; log search filters for `ninetails-api` (the journald unit name). |
| **Browsers** | `localStorage` keys of the old name stay in users' browsers, unused. Harmless; clear site data if tidy. |

---

## 8. Rebuild and verify

After renaming everything, in this order:

1. [ ] API: `cd <slug>-api`, then
   - `go build ./...` (any miss in an import shows up here)
   - `go vet ./...`
   - `gofmt -l .` (must print nothing)
   - `go run ./cmd/<slug>-api` and open `http://localhost:8080/healthz` and `http://localhost:8080/docs`
     (the tab title and the page title show the new display name)
2. [ ] If you changed form E: start with one new-prefix variable, for example `<PREFIX>SIMULATE=false`, and confirm the
       log no longer says `simulation on`. Confirm an *old*-prefix variable (`NINETAILS_SIMULATE=false`) now does nothing.
3. [ ] App: `cd <slug>-app`, then `npm install` (refreshes the lock file; check it did not change anything beyond the name),
       `npm run build` (output at `dist/<slug>-app/browser`), `npm start`, open `http://localhost:4200`.
       Check: browser tab title, header, login card (open it in a private window with `auth.mode: 'gitlab'`, or log out),
       footer text.
4. [ ] Production build paths in the docs: `dist/<slug>-app/browser` exists.
5. [ ] Search for leftovers (below). The expected result is **no matches** except the sample hosts you chose to keep.

### Search for anything missed

PowerShell, from the root folder:

```powershell
Get-ChildItem -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\\.angular\\|\\\.git\\' } |
  Select-String -Pattern 'ninetail' | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
```

bash (RHEL / Git Bash):

```
grep -rIni 'ninetail' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.angular --exclude-dir=.git
```

Both are case-insensitive, so they also find `Ninetails`, `NINETAILS_` and `NinetailsApp`. Also look for file and folder
names that still contain the old name:

```powershell
Get-ChildItem -Recurse -Force | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' -and $_.Name -match 'ninetail' } | ForEach-Object FullName
```

(`dist` and `.angular` will list old-named folders until you delete them: remove both and rebuild.)

## 9. Notes on the scripts and this file

- Markdown was chosen for the checklist because it is read by a person, ticks off in any editor and sits next to the
  other guides. The automatic version is the pair of scripts in Section 0, built from the same tables: any new place the
  name appears (a new file, a new setting) is found by them automatically, because they search every text file instead of
  working from a fixed list. That includes hidden files such as `.gitlab-ci.yml` (a dry run lists it). Keep this checklist current anyway; it is the only place that describes the parts outside
  the repository.
- After a rename, this file and the two scripts still say `ninetails`. That is intentional: they describe the starting
  point, and the scripts take `-OldName` / `--old-name` for a later rename. Update this file's tables if you want it to
  describe the new name.
- Tested: both scripts were run on a copy of this project (dry run, full run, root-folder rename on Windows) and
  produced identical results; the renamed API built, vetted and formatted clean. The RHEL script was exercised under
  Git Bash on Windows, not on a real RHEL host, so run it with the dry-run option first there.