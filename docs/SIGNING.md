# Code signing (removing the SmartScreen warning)

Perch's installer is currently unsigned, so Windows SmartScreen shows "Windows
protected your PC" the first time someone runs it. Signing the installer with a
code-signing certificate fixes that over time (SmartScreen also builds
reputation per certificate, so the warning fades as more people install it).

Certificates normally cost money, but open-source projects can get one for free
through the **SignPath Foundation**.

## 1. Apply (the repository owner does this)

1. Go to <https://signpath.org> and choose **Apply** for open-source projects.
2. Fill in the form:
   - **Project:** Perch, <https://github.com/MohammedAnasAsif/perch>
   - **Licence:** MIT (OSI-approved, which is required)
   - **Build system:** GitHub Actions (`.github/workflows/build.yml`)
   - **What gets signed:** the Windows installer `Perch-Setup-<version>.exe`
     built by electron-builder, and the app executable inside it.
3. SignPath reviews the project. They typically ask that releases are built
   only by CI from the public repository (Perch already does this) and that the
   project has a privacy/code-of-conduct statement in the README.

## 2. Once approved

SignPath gives you:

- an **organisation ID**
- a **project slug** and **signing policy slug** (e.g. `perch` / `release-signing`)
- an **API token** for CI

Add them in GitHub under **Settings → Secrets and variables → Actions**:

| Name | Type | Value |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | Secret | the API token |
| `SIGNPATH_ORGANIZATION_ID` | Variable | the organisation ID |
| `SIGNPATH_PROJECT_SLUG` | Variable | the project slug |
| `SIGNPATH_POLICY_SLUG` | Variable | the signing policy slug |

## 3. Wiring it into the build

Auto-updates check the installer's SHA-512 hash, which electron-builder writes
into `latest.yml`. So signing must happen **before** that hash is recorded,
otherwise installed copies would refuse the update. The plan:

1. Build with `electron-builder --win --publish never` as today, but upload the
   unsigned `release/*.exe` as a workflow artifact.
2. Send that artifact to SignPath with
   [`signpath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request)
   and wait for the signed file.
3. Recompute the hash and size of the **signed** installer and rewrite
   `latest.yml` (a small script, `scripts/update-latest-yml.mjs`), then attach
   the signed `.exe`, the new `.blockmap` and `latest.yml` to the release.

This is a one-time change to `build.yml`; once the secrets above exist, ask for
it to be added and it can be tested on a pre-release before the next version.
