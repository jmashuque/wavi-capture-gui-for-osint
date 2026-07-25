# WAVI Capture GUI for OSINT

A portable Windows GUI for approved audio/video/image and rendered webpage capture workflows using `yt-dlp`, `gallery-dl`, Deno, installed Chromium browsers, and companion scripts.

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Intended Users](#intended-users)
- [What the App Does](#what-the-app-does)
- [What the App Does Not Do](#what-the-app-does-not-do)
- [Warnings](#warnings)
- [Required Components](#required-components)
- [Basic Usage](#basic-usage)
  - [Setup and Staging](#setup-and-staging)
  - [Start a Capture](#start-a-capture)
  - [Capture Audio or Video](#capture-audio-or-video)
  - [Capture Images](#capture-images)
  - [Capture a Webpage](#capture-a-webpage)
  - [Use the Job Queue](#use-the-job-queue)
  - [Review Capture Output](#review-capture-output)
  - [Resume Interrupted Captures](#resume-interrupted-captures)
  - [Preview Audio/Video Links](#preview-audiovideo-links)
  - [Review a Case](#review-a-case)
- [Advanced Usage](#advanced-usage)
  - [Portable Layout](#portable-layout)
  - [Output Log](#output-log)
  - [Audio/Video Capture](#audiovideo-capture)
  - [Image Capture](#image-capture)
  - [Webpage Capture](#webpage-capture)
  - [Job Queue, Persistence, and Recovery](#job-queue-persistence-and-recovery)
  - [Domain Presets, Proxy, VPN, and Archives](#domain-presets-proxy-vpn-and-archives)
  - [Update Checks](#update-checks)
- [Profiles and Settings](#profiles-and-settings)
- [Cookies Handling](#cookies-handling)
- [Limitations](#limitations)
- [Changelog](#changelog)

## Overview

`Webpage/Audio/Video/Image Capture GUI for OSINT` (`WAVI Capture GUI for OSINT`) is a local, portable interface for repeatable capture work in managed environments.

The app has seven main tabs:

- **Audio/Video Capture** for `yt-dlp` captures.
- **Image Capture** for `gallery-dl` captures.
- **Webpage Capture** for rendered webpage images, optional PDFs, and bounded interactive-item capture.
- **Job Queue** for staged, concurrent, and recoverable jobs.
- **Output Log** for live Audio/Video, Image, Webpage, or combined capture output.
- **Audio/Video Preview** for metadata, thumbnails, playlist/context review, and queueing from preview results.
- **Case Browser** for local review, thumbnails, metadata, and hash verification.

The app does not bundle capture tools or make authorization decisions. Tools, credentials, network paths, cookies, proxy/VPN use, and capture scope should be approved separately through normal organizational processes.

## Screenshots

<p align="center">
  <img src="/screenshots/main1.png" alt="audio/video capture tab" width="31%">
  <img src="/screenshots/main2.png" alt="image capture tab" width="31%">
  <img src="/screenshots/main3.png" alt="webpage capture tab" width="31%">
</p>

<p align="center">
  <img src="/screenshots/main4.png" alt="job queue tab" width="31%">
  <img src="/screenshots/main5.png" alt="output log tab" width="31%">
  <img src="/screenshots/main6.png" alt="audio/video preview tab" width="31%">
</p>

<p align="center">
  <img src="/screenshots/main7.png" alt="case browser tab" width="31%">
</p>

## Intended Users

This app is intended for investigators, analysts, and support staff who need a consistent way to collect approved audio/video, image, gallery, rendered webpage, or metadata output without manually rebuilding command-line arguments for every case.

This app is for authorized OSINT capture workflows, not general-purpose downloading, browsing, archiving, or personal media collection.

It is designed for local Windows use. Keep the app folder and case output on local storage during active captures, then move or archive cases through approved evidence-handling processes.

## What the App Does

The app helps users:

- prepare URL lists or input files
- run preflight checks for required local tools
- capture audio/video with `yt-dlp`
- capture image/gallery content with `gallery-dl`
- capture full-page, initial-viewport, or combined webpage images as PNG, JPEG, or WebP through an isolated installed Chromium-family browser
- record webpage capture metadata, redirects, dimensions, warnings, hashes, segmented fallbacks for oversized pages, and optional interactive-overlay capture reports
- organize output into case folders
- apply case names, filename templates, cookies, proxy settings, pacing, archive, and metadata options
- queue multiple jobs and recover interrupted work when Job Persistence is enabled
- preview audio/video metadata and thumbnails before capture
- browse local case files and verify SHA256 manifests

## What the App Does Not Do

The app does not:

- include or auto-install `yt-dlp`, `gallery-dl`, FFmpeg/FFprobe, Deno, Chromium browsers, Python, or PowerShell
- bypass endpoint security, firewalls, website controls, access restrictions, login requirements, bot challenges, or rate limits
- decide whether a capture is legal, approved, proportionate, or in scope
- collect passwords, automate sign-ins, use the normal browser profile, extract browser cookies, solve interactive challenges, or perform unrestricted page interaction
- guarantee that any source platform is supported
- analyze evidence, identify people, assess authenticity, or determine evidentiary value
- upload, sync, or retain cases outside the selected local output paths

## Warnings

### Interactive Overlays

Interactive capture sends real clicks to third-party pages. WAVI blocks forms, cross-origin links, disabled controls, known social/account actions, and ambiguous candidates, and it revalidates each target immediately before clicking. These safeguards reduce risk but cannot guarantee that every authenticated or highly dynamic site is free from unintended state-changing interaction.

Use a minimally privileged, organization-approved investigative account, begin with a low item limit, review platform-specific blacklist rules, and inspect the interactive report before larger authenticated captures.

### Investigative Accounts and Cookies

For authenticated OSINT captures, use only organization-approved investigative or "sock puppet" accounts and cookies created for those accounts. Never use personal accounts, personal browser profiles, or cookies from personal sessions.

Treat cookies files as sensitive operational data and handle them according to organizational policy.

## Required Components

Place the GUI, scripts, and approved tools in a local portable folder unless your organization uses a different staged path.

Required files/tools:

- `gui.py`
- `script-ytdlp.ps1`
- `script-gallerydl.ps1`
- `script-webcapture.ps1`
- `script-webcapture.ts`
- `interactive-whitelist.txt`
- `interactive-blacklist.txt`
- `yt-dlp.exe`
- `gallery-dl.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `deno.exe`
- Python 3
- Windows PowerShell
- A compatible Chromium-family browser installed locally for Webpage Capture, such as Microsoft Edge, Google Chrome, Brave, Vivaldi, Chromium, or Opera

Keep `interactive-whitelist.txt` and `interactive-blacklist.txt` beside `gui.py`. They are read only when **Interactive Overlays** is enabled, but they should remain in every staged app folder so the feature is available and its default safety rules are not lost.

`deno.exe` should be beside `yt-dlp.exe`. `gallery-dl.exe` can be beside the app or selected manually in the Image Capture tab. Webpage Capture uses the selected installed Chromium-family browser executable; the browser itself is not bundled. The app creates temporary handoff files and isolated browser profiles under its own `gui-temp` folder and removes them after use.

Recommended source pages:

- WAVI Capture GUI releases: <https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/latest>
- Python: <https://apps.microsoft.com/detail/9PNRBTZXMB4Z>
- yt-dlp releases: <https://github.com/yt-dlp/yt-dlp/releases>
- yt-dlp nightly builds: <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases>
- gallery-dl releases: <https://codeberg.org/mikf/gallery-dl/releases>
- Deno releases: <https://github.com/denoland/deno/releases>
- FFmpeg Windows builds by Gyan.dev: <https://www.gyan.dev/ffmpeg/builds/>

Use approved releases for your environment. For FFmpeg, the Gyan.dev release essentials build is usually enough because it includes both `ffmpeg.exe` and `ffprobe.exe`.

For Deno, download `deno-x86_64-pc-windows-msvc.zip` by pressing **Show all assets** below the release.

## Basic Usage

This section covers the normal first-run workflow. Start with the defaults, run **Preflight Check**, and change advanced options only when the capture requires them.

### Setup and Staging

Do this once before the first capture, or whenever you prepare a fresh copy of WAVI.

1. Create a local folder, for example:

   ```text
   C:\WAVI-Capture-GUI
   ```

2. Download and extract the latest WAVI release. If Windows shows an **Unblock** checkbox in the ZIP file's **Properties**, select it before extracting. Do not run WAVI from inside the ZIP.

3. Install Python 3 through an organization-approved source.

4. Place the approved capture tools beside the app files unless your team provides a different staged path:

   | Tool | Required file |
   |---|---|
   | yt-dlp | `yt-dlp.exe` |
   | gallery-dl | `gallery-dl.exe` |
   | Deno | `deno.exe` |
   | FFmpeg | `ffmpeg.exe` and `ffprobe.exe` |

5. Confirm the folder looks similar to this:

   ```text
   C:\WAVI-Capture-GUI\
     gui.py
     script-ytdlp.ps1
     script-gallerydl.ps1
     script-webcapture.ps1
     script-webcapture.ts
     interactive-whitelist.txt
     interactive-blacklist.txt
     README.md
     CHANGELOG.md
     LICENSE
     yt-dlp.exe
     gallery-dl.exe
     deno.exe
     ffmpeg.exe
     ffprobe.exe
   ```

6. Keep the app and active case output on a local drive. Avoid running from an email attachment, browser preview, synced folder, or network share.

`deno.exe` should normally be beside `yt-dlp.exe`. Webpage Capture also needs a compatible installed Chromium-family browser, such as Microsoft Edge, Google Chrome, Brave, Vivaldi, Chromium, or Opera.

### Start a Capture

1. Open the WAVI folder and start `gui.py`.
   - Double-click it when `.py` files already open with Python.
   - Otherwise, click the File Explorer address bar, type `powershell`, press **Enter**, and run:

     ```powershell
     py .\gui.py
     ```

   - If `py` is unavailable, try `python .\gui.py`. If neither works, Python is not installed or is not available to your user session.

2. Select the appropriate tab:
   - **Audio/Video Capture** for video, audio, channels, playlists, and supported media posts.
   - **Image Capture** for image posts, galleries, albums, and supported collections.
   - **Webpage Capture** for a rendered screenshot and optional PDF of an approved webpage.

3. Check the main fields:
   - **Output Root** is the parent folder where case folders will be created.
   - **Case Name** becomes the case subfolder.
   - **Filename Template** controls names and subfolders inside the case.
   - The optional `%engine%` tag resolves to `audio-video`, `image`, or `webpage`, allowing shared Output Roots or templates to identify the capture source. Existing defaults do not use this tag.
   - The **URL box** accepts one URL per line.
   - **Input File(s)** accepts text files containing one URL per line.

4. Paste the approved URL or URLs. The URL box takes priority over Input File(s); clear the URL box when you intend to use selected files.

   Every capture tab has the same twelve URL-box tools:

   - **Load**, **Append**, **Save**, **Clear**, and **Copy** manage the URL text.
   - **Failed** shows failed URLs from the current Output Root that match the current URL set; the button changes to **All** so the original set can be restored.
   - **Group** organizes URLs under domain headings, and **Statistics** shows totals by domain.
   - **Normalize**, **Duplicates**, and **Validate** clean or inspect the URL source.
   - **Strip** removes parameter-like `&name=value` suffixes. Use it only when those trailing parameters are unwanted, because removing them can change which webpage or media item is requested.

5. Run **Preflight Check**. Fix any failed item before continuing.

6. Click **Start Capture** and leave WAVI open until the run finishes.

7. Review live capture output in **Output Log**. Select **Audio/Video**, **Image**, **Webpage**, or **All Engines**. **Follow output** keeps the newest messages visible; **Copy Visible**, **Save Visible**, and **Clear Display** act only on the selected view and do not delete case log files.

8. Open the case folder and confirm the expected files, logs, and manifest are present. After a successful run, the main **Copy Case Summary** button copies a plain-text record of the case paths, file counts, tool versions, and effective capture options. Use its **▼** menu to copy or export the case's captured URLs or failed URLs. URL lists are filtered to the current capture engine and case name. WAVI refuses oversized clipboard copies instead of truncating them; use **Export** for a complete large list.

### Capture Audio or Video

For a first capture, keep the defaults unless the source is a playlist or you specifically need audio-only, metadata-only, or a different format.

1. Open **Audio/Video Capture** and confirm the paths to the PowerShell script, `yt-dlp.exe`, and the FFmpeg folder.
2. Choose an Output Root and case name, then paste the approved URL.
3. For one video or media post, keep **Single item only**. For an approved playlist, channel, or multi-item page, open **Capture Options** and select **Include playlist / multi-item source**.
4. Run **Preflight Check**, then start the capture.
5. Review the media under the case `media` folder, the run log under `logs`, and the SHA256 manifest under `manifests`.

Use **Audio/Video Preview** before capture when you need to inspect a playlist, title, thumbnail, or available metadata. See [Advanced Audio/Video Capture](#audiovideo-capture) for format strategies, sidecars, embeds, filtering, pacing, and archive controls.

### Capture Images

A single gallery URL can produce many files. When the size is uncertain, start with a small item limit or range.

1. Open **Image Capture** and confirm the paths to the PowerShell script and `gallery-dl.exe`.
2. Choose an Output Root and case name, then paste the approved image or gallery URL.
3. For a large or unfamiliar gallery, open **Capture Options**, enable **Limit max items**, and begin with a small number such as 10 or 25.
4. Run **Preflight Check**, then start the capture.
5. Review the images and sidecars under `media`, the gallery-dl log under `logs`, and the manifest under `manifests`. Use **Copy Case Summary** after a successful run when you need a concise record for case notes or handoff.

See [Advanced Image Capture](#image-capture) for metadata-only runs, item ranges, archive modes, pacing, retries, timeouts, cookies, and concurrency.

### Capture a Webpage

The default Webpage workflow creates a full-page PNG using a new isolated browser profile. It does not use the normal signed-in browser profile.

1. Open **Webpage Capture** and confirm the **Deno Path** and **Browser Path**. Use **Refresh** or **Browse** if the browser path is blank.
2. Choose an Output Root and case name, then paste an approved `http://` or `https://` URL.
3. Keep the default Capture Options for the first attempt. Open **PDF Options** only when a PDF is also required.
4. Run **Preflight Check**. This tests Deno, the selected browser, the isolated temporary profile, and the loopback DevTools connection.
5. Start the capture and review the image, `.webcapture.json` sidecar, run log, and SHA256 manifest. Review any **Complete with warnings**, **Partial**, or **Failed** classification before treating the capture as complete. After a successful run, **Copy Case Summary** includes the classification totals along with the case paths, tools, and selected Webpage options.

Webpage Capture does not dismiss consent banners, sign in, solve MFA/CAPTCHA challenges, submit forms, or perform arbitrary page interaction. The optional **Interactive Overlays** feature can conservatively open likely gallery, media, or post items that match the packaged whitelist, capture the resulting overlay or a same-origin route-based detail view, dismiss it, and continue through bounded matches; it remains disabled by default. An approved Netscape-format cookies file can be selected manually when required, but cookie use remains disabled by default.

### Use the Job Queue

Use **Job Queue** when you want to prepare several captures before running them.

1. Add work from **Audio/Video Capture**, **Image Capture**, **Webpage Capture**, or **Audio/Video Preview**.
2. Review the queued jobs.
3. Start the full queue, checked jobs, or highlighted jobs from the right-click menu.
4. Leave the app open while the queue runs.
5. Review failed or interrupted jobs after the run.

The Job Queue is also where interrupted work is resumed when **Job Persistence** is enabled.

### Review Capture Output

Use **Output Log** to review live direct or queued capture output for one capture engine or **All Engines**. The durable case logs remain under each case folder regardless of what is cleared from **Output Log**.

### Resume Interrupted Captures

If the app closes, crashes, or a capture is stopped while **Job Persistence** is enabled, reopen the app and go to **Job Queue**. The interrupted capture should appear with an **Interrupted** status.

To resume it:

1. Open **Job Queue**.
2. Select the interrupted job.
3. Use **Continue Checked Interrupted** or right-click the highlighted job and choose **Continue Highlighted Interrupted**.
4. Leave the app open while the resumed queue job runs.

Direct captures are saved as running recovery jobs only when **Job Persistence** is enabled. Audio/Video and Webpage jobs continue from the first URL not marked complete. Image jobs resubmit the original URLs and rely on the selected gallery-dl archive to skip completed items.

### Preview Audio/Video Links

Use **Audio/Video Preview** when you want to inspect media metadata or playlist/context entries before capture.

1. Add URLs to the preview list.
2. Run Preview for all, selected, or visible rows.
3. Review metadata, thumbnails, and playlist/context items.
4. Start or queue the rows you want to capture.

Preview is best-effort. It can be incomplete or slow depending on the site, cookies, network path, and installed `yt-dlp` build.

### Review a Case

Use **Case Browser** to review local case output.

- Select an Output Root.
- Filter or sort case files.
- Open case folders or individual files.
- Generate or verify SHA256 manifests.

Case Browser is for local review only. It does not determine authenticity, context, or evidentiary value.

## Advanced Usage

This section is for users who understand the tools, site behavior, rate limits, and organizational handling requirements.

### Portable Layout

Keep these files together unless paths are intentionally changed in the GUI:

```text
gui.py
script-ytdlp.ps1
script-gallerydl.ps1
script-webcapture.ps1
script-webcapture.ts
yt-dlp.exe
gallery-dl.exe
deno.exe
ffmpeg.exe
ffprobe.exe
```

Recommended layout:

- keep the app folder local
- keep active Output Roots local and non-synced
- avoid running active captures from network shares
- treat cookies, URL lists, logs, archives, preview exports, and case metadata as sensitive operational data

### Output Log

The **Output Log** tab shows live direct and queued capture output. The **Engine** selector provides **Audio/Video**, **Image**, **Webpage**, and **All Engines** views. The combined view merges records in timestamp order.

- **Follow output** scrolls to new messages. Disable it while reviewing earlier output.
- **Copy Visible** uses WAVI's shared clipboard safeguards and refuses oversized content without truncating or replacing the current clipboard.
- **Save Visible** writes the complete selected view as UTF-8 text without the clipboard limit.
- **Clear Display** clears only the selected view. It does not delete timestamped case logs, captured artifacts, URL histories, archives, or queue state. Clearing **All Engines** requires confirmation.

### Audio/Video Capture

Audio/Video Capture uses `script-ytdlp.ps1`, `yt-dlp.exe`, Deno where required by supported extractors, and FFmpeg/FFprobe. The URL box takes priority over selected Input File(s). Output is written beneath `<Output Root>\<Case Name>\media` using the selected template.

**Capture mode**

| Mode | What it does | Typical use |
|---|---|---|
| **Download media and selected sidecars** | Downloads media and writes the selected separate metadata files. | Recommended general-purpose capture. |
| **Media + embedded metadata; ignore sidecars** | Downloads media and applies selected embed options without retaining the normal sidecar set. | A compact playback copy when separate records are not required. |
| **Media only; ignore metadata options** | Downloads only the media output. | Minimal output when metadata artifacts are deliberately unnecessary. |
| **Metadata/artifacts only; do not download media** | Runs extraction and writes selected metadata artifacts without downloading the media stream. | Source assessment, scoping, or metadata collection. |

Separate sidecars are usually easier to inspect, hash, compare, and preserve than metadata embedded inside a media container.

**Source scope and playlist controls**

- **Single item only** is the safe default and prevents a submitted page from expanding into an entire playlist or channel.
- **Include playlist / multi-item source** allows playlist, channel, and other multi-item extraction.
- **Items** accepts yt-dlp indexes and ranges such as `1:10,30,35:40`.
- **Order** can be normal, reverse, or random.
- **Max items** caps the number of playlist entries considered.
- **Stop when archived item is found** is useful for chronologically ordered recurring sources when an older archived item means the remaining entries were probably captured previously.
- **Skip after failed items** stops working through a problematic playlist after the selected number of item failures.

Playlist controls are passed only when multi-item scope is enabled. Use **Audio/Video Preview** to inspect and select playlist/context entries when the source structure is uncertain.

**Format strategy**

| Strategy | Behaviour |
|---|---|
| `best` | Uses yt-dlp's best available media selection, optionally limited by maximum resolution. |
| `prefer_mp4` | Prefers MP4 video with M4A audio and merges to MP4, but retains fallback choices when MP4-specific formats are unavailable. |
| `strict_mp4` | Requires MP4-compatible video/audio choices. This is more predictable for compatibility but can fail on sources without a suitable MP4 combination. |
| `audio_only` | Selects the best audio and converts/extracts it to M4A. |
| `low_bandwidth` | Selects a low-quality/low-bandwidth format, still respecting the selected maximum resolution where applicable. |

**Max resolution** limits video height to Best, 2160p, 1440p, 1080p, 720p, or 480p. It does not improve a lower-resolution source. **Generate Windows `.url` shortcuts** creates source-link shortcuts when that additional record is useful.

**Metadata Options**

Sidecar choices include:

- metadata/info JSON
- source-link files
- description text
- thumbnails
- creator-provided subtitles
- automatic subtitles
- comments when supported
- playlist metadata for multi-item captures

Embed choices include metadata, cover art, subtitles, chapters, and info JSON for compatible media containers. Embedding depends on the selected format, available source metadata, and FFmpeg or mutagen support. Some embeds can modify or remux the final media file, so retain separate sidecars when independent preservation is preferred.

**Archive modes**

- **Use case download archive** records completed yt-dlp item identifiers in the case and skips matching items on later runs.
- **Ignore archive for this run** does not use the case archive for duplicate avoidance.
- **Force re-capture** deliberately requests another copy even when the item is already archived.

When app-level **Universal Download Archive** is enabled, WAVI also uses `universal-download-archive.txt` for cross-case skipping. An archive skip confirms a previous archive record; it does not mean the current case contains a fresh copy.

**Dates, title filters, and impersonation**

- **Date after** and **Date before** restrict supported sources by upload date.
- **Only capture titles matching** and **Reject titles matching** accept comma-separated keywords and build safe case-insensitive title filters.
- **Impersonate Target** passes a supported yt-dlp impersonation target. Use **Check Targets** first because availability depends on the installed yt-dlp build and local dependencies. Impersonation does not bypass authentication or authorization controls.

**Failure handling and concurrency**

- **Continue after failed URL** processes the remaining submitted URLs.
- **Stop on first failed URL** ends the run after the first failed URL.
- **Concurrent Captures** controls separate active Audio/Video queue jobs, from 1 to 4. WAVI still checks for same-domain collisions.
- **Concurrent Fragments** controls parallel fragment downloads inside one yt-dlp job, from 1 to 8. This is different from queue concurrency and can increase load on the source and local network.

**Pacing and retry behaviour**

| Request-rate preset | Between submitted URLs | yt-dlp request sleep |
|---|---:|---:|
| **None** | 0 to 5 seconds | none |
| **Fast** | 15 to 30 seconds | 2 seconds |
| **Normal** | 30 to 60 seconds | 5 seconds |
| **Cautious** | 60 to 120 seconds | 10 seconds |

| Retry profile | Main and fragment retries | Retry sleep window |
|---|---:|---|
| **Light** | 3 | exponential, 5 to 60 seconds |
| **Normal** | 5 | exponential, 10 to 120 seconds |
| **Aggressive** | 10 | exponential, 10 to 300 seconds |

Additional controls:

- **Download Speed Limit** caps transfer speed for the job.
- **Throttle Detection** tells yt-dlp to restart a transfer when speed stays below the selected threshold.
- **HTTP Chunk Size** requests ranged/chunked HTTP transfers and should normally remain off unless a source or network path benefits from it.
- Retaining partial fragments can help troubleshooting or manual recovery but also leaves incomplete files that must not be mistaken for completed captures.

Increasing retries, concurrency, or fragments can worsen rate limiting. Start with the defaults and change one factor at a time.

**Output records**

- **Case Browser cache** controls whether WAVI prepares hidden thumbnail/media-detail cache files after each URL, after the run, or not at all. `.gui-cache` is excluded from evidence manifests.
- **File manifest: Full** hashes the current case contents; **This run** limits the manifest to artifacts attributed to the current run.

Typical output:

```text
<case>\
  media\
    <extractor or template folders>\
      <captured media and selected sidecars>
  logs\
    yt-dlp-run_<timestamp>.log
  manifests\
    sha256-manifest_<timestamp>.csv
  download-archive.txt
```

After a finished Audio/Video run, the **▼** beside **Copy Case Summary** can copy or export captured and failed URLs recorded for that Audio/Video case. The URL actions remain available after a failed run even when no successful summary can be copied.

Cookies, proxy settings, domain presets, VPN checks, and the universal archive are shared/app-level controls described later in this README. A cookies file can provide an approved session, but it does not bypass login, MFA, challenges, extractor limitations, or source restrictions.

### Image Capture

Image Capture uses `script-gallerydl.ps1` and `gallery-dl.exe`. It is intended for supported image posts, galleries, albums, and collection pages where one submitted URL may resolve to many files. The URL box takes priority over Input File(s). The image template is relative to the case `media` folder; case tags resolve when the job is created, while gallery-dl fields such as category, subcategory, ID, filename, and extension resolve per item.

**Capture mode**

- **Download images/files and selected metadata** downloads supported items and writes the enabled sidecars.
- **Metadata/artifacts only** uses gallery-dl simulation/JSON output without downloading the image files. Use it to test extractor support, inspect scope, or collect available metadata before a larger capture.

**Metadata sidecars**

- **Per-file metadata JSON** records metadata associated with individual downloaded items where the extractor supplies it.
- **Gallery-level info JSON** records broader gallery or source information where supported.
- **Tags text files** writes available tags in a simple text form.

Sidecar availability and contents depend on the site and its gallery-dl extractor. A checked option does not guarantee that every source provides that data.

**Item limits and ranges**

- **Limit max items** converts the selected number into a range beginning at item 1.
- **Use item range** accepts gallery-dl range syntax such as `1-25`.
- When both are enabled and contain values, **item range takes precedence** over maximum items.

Use a small range for unfamiliar or very large galleries. This reduces accidental over-collection and provides a manageable test of the filename template and metadata output.

**Archive modes**

- **Use case gallery-dl archive** records completed items in `manifests\gallery-dl-archive.sqlite3` and skips matching items on later case runs.
- **Ignore archive for this run** performs the run without archive-based skipping or recording for that run.
- **Force re-capture** passes gallery-dl's no-skip behaviour so matching files can be collected again deliberately.

When app-level **Universal Download Archive** is enabled, Image Capture uses `universal-gallerydl-archive.sqlite3` for cross-case duplicate avoidance instead of the case archive. Archive records identify prior successful items; they are not substitutes for artifacts in the current case.

**Pacing presets**

| Preset | General sleep | Per-request sleep | HTTP 429 sleep |
|---|---:|---:|---:|
| **Fast** | none added | none added | tool default |
| **Normal** | 1 to 3 seconds | 0.5 to 1.5 seconds | 60 seconds |
| **Cautious** | 3 to 8 seconds | 1 to 3 seconds | 120 seconds |

Use **Normal** for routine work. **Fast** is useful only when the source and policy permit rapid requests. **Cautious** is preferable for sensitive, unstable, or rate-limited sources.

**Retries, timeout, and concurrency**

- **Retries** controls gallery-dl retry attempts; the default is 4 and the accepted range is 1 to 100.
- **Timeout seconds** controls the HTTP timeout; the default is 30 seconds and the accepted range is 10 to 900 seconds.
- **Concurrent captures** controls separate active Image queue jobs, from 1 to 4. It does not split one gallery across multiple workers, and WAVI checks for same-domain collisions.

Raising retries and concurrency can prolong a failing job or increase rate limiting. A larger timeout can help slow servers but also makes unreachable URLs take longer to fail.

**Templates and output organization**

The default template is:

```text
%category%/%subcategory%/%id%_%filename%.%extension%
```

Use the preview below the template to confirm the expected relative path before capture. Keep identifiers in the template where possible so similarly named gallery items do not overwrite one another.

Typical output:

```text
<case>\
  media\
    <category or template folders>\
      <images and selected sidecars>
  logs\
    gallery-dl-run_<timestamp>.log
    gallery-dl-unsupported_<timestamp>.txt   (when applicable)
  manifests\
    gallery-dl-archive.sqlite3               (case archive mode)
    gallery-dl-sha256-manifest_<timestamp>.csv
```

Image recovery is archive-backed: continuing an interrupted Image job resubmits the original URLs and relies on the active gallery-dl archive to skip completed items. This differs from Audio/Video and Webpage recovery, which can continue from the first URL not marked complete.

After a successful direct or queued Image capture, **Copy Case Summary** provides a plain-text summary of submitted URLs, case and archive paths, file counts, gallery-dl version, templates, capture mode, metadata outputs, item limits, pacing, retries, timeout, concurrency, cookies, proxy, and VPN state. Its **▼** menu copies or exports Image-only captured and failed URLs for the case; failed-URL actions remain available after an unsuccessful run. Completed queue-job summaries can also be copied from the Job Queue.

Cookies, proxy settings, domain presets, and gallery-dl stable/dev update checks remain available. A cookies file can provide an approved session but cannot bypass login requirements, bot challenges, unsupported extractors, or source restrictions.

### Webpage Capture

Webpage Capture uses Deno-driven Chromium browser automation to load and capture approved webpages through the Chrome DevTools Protocol. Select an installed Chromium-family browser and confirm the **Deno Path** and **Browser Path** before capture; preflight checks that the selected browser can start in WAVI's isolated capture environment.

Use **Capture Options** to choose full-page, initial-viewport, or combined output; PNG, JPEG, or WebP encoding; readiness and retry limits; lazy-load scrolling; page-stability handling; browser environment settings; optional interactive-item capture; and supplemental evidence outputs. **PDF Options** can create either a searchable Live Page PDF or an image-based Captured PNG PDF intended to match the saved visual capture.

The optional **Interactive Overlays** feature is disabled by default. When enabled, WAVI can conservatively open likely gallery, media, post, reel, photo, story, or highlight items; capture the overlay, viewport, or both; dismiss the item; and continue through a bounded number of matches. Interactive filenames support `%urlindex%`, `%overlayindex%`, `%profile%`, and `%contentid%`. The packaged `interactive-whitelist.txt` and `interactive-blacklist.txt` files can be adjusted for supported sites.

Webpage Capture uses a temporary app-owned browser profile and does not read normal browser profiles, stored passwords, or browser databases. Cookies are optional, disabled by default, and must be supplied as an approved Netscape-format file. Normal browser security remains enabled, and the DevTools connection is limited to localhost.

Readiness, scrolling, and page-growth limits keep captures bounded. Depending on the selected outcome, a page that does not fully settle or continues growing may be saved as **Complete with warnings**, **Partial**, or **Failed**. Optional evidence outputs include MHTML, response HTML, rendered DOM, sanitized network and failed-request reports, console errors, browser-security details, and failure screenshots. Sensitive headers and request bodies are not recorded.

Each successful artifact is hashed. The webpage sidecar records the requested and final URLs, browser and capture settings, readiness and scrolling outcomes, generated files, hashes, warnings, and the final completeness classification. Captures may still be limited by site design, authentication challenges, anti-automation controls, browser policy, endpoint security, or Chromium's own page and PDF limits.

### Job Queue, Persistence, and Recovery

The Job Queue runs staged work, manages concurrent captures, and resumes interrupted jobs. It supports `yt-dlp`, `gallery-dl`, and Webpage Capture jobs.

**Job Persistence** controls whether queue state is saved to `gui-jobs.json`. When it is enabled, queued jobs and direct captures are saved while they run. If a running job is still present when the app reopens, it is treated as interrupted and can be continued from the Job Queue. When Job Persistence is disabled, direct captures are not recoverable through the app after a close or crash.

Recovery behavior is engine-specific:

- **Audio/Video Capture (`yt-dlp`)** records completed URL markers. Continuing an interrupted job submits the first incomplete URL and anything after it.
- **Image Capture (`gallery-dl`)** uses archive-backed retry. Continuing an interrupted image job resubmits the original URLs and lets the case archive, or the image universal archive when enabled, skip completed items.
- **Webpage Capture** records completed URL markers and per-URL **Complete**, **Complete with warnings**, **Partial**, or **Failed** classifications in its queue/recovery state. Continuing an interrupted job starts with the first webpage URL not marked complete. When Universal Download Archive is enabled, previously successful submitted or final redirected URLs are also skipped across cases.

Concurrent queue behavior:

- Audio/Video, Image Capture, and Webpage Capture have separate concurrent-capture limits.
- `yt-dlp`, `gallery-dl`, and Webpage Capture jobs may run at the same time when their domains do not collide.
- Same-domain concurrent jobs trigger a collision prompt so users can continue, wait, or cancel.

Each recoverable job can write `manifests/gui-job-recovery-<job-id>.json` under the case folder. These files explain what the app tried to resume; they are not a replacement for the normal case manifest or review notes.

### Domain Presets, Proxy, VPN, and Archives

- **Domain Presets** can apply capture settings automatically to matching Audio/Video or Image Capture URLs.
- **Proxy Options** are app-level and can be passed to the capture scripts and Webpage Capture. The first Webpage Capture version supports only proxies that do not require credentials.
- **Check VPN** is disabled by default and warns before capture when enabled and the selected adapter does not look connected.
- **Universal Download Archive** uses separate app-level archive files:
  - `universal-download-archive.txt` for Audio/Video Capture
  - `universal-gallerydl-archive.sqlite3` for Image Capture
  - `universal-webcapture-archive.sqlite3` for Webpage Capture

The Webpage Capture archive uses SQLite so requested URLs, final redirected URLs, capture timestamps, case names, job IDs, sidecar paths, and capture history can be stored atomically. Matching submitted or final URLs are skipped before navigation, and the case receives JSON/CSV skip reports under `manifests`. Universal archives are useful for avoiding repeat captures across cases, but they are not evidence artifacts for a specific case.

### Update Checks

The app has user-triggered update helpers for staged local tools:

- **Check/Update yt-dlp** on the Audio/Video Capture tab
- **Check/Update gallery-dl** on the Image Capture tab
- **Tools > Update Deno** for the detected local `deno.exe`

The app does not auto-update tools on launch. Updates should be used only when approved for the environment.

## Profiles and Settings

The app stores settings beside the app in `gui-settings.json`. **Job Persistence** should stay enabled if users need queue recovery or direct-capture recovery after a close or crash.

Common state files:

- `gui-settings.json` for settings, profiles, app settings, and domain presets
- `gui-jobs.json` for persisted queue jobs when Job Persistence is enabled
- `gui-url-box.txt`, `gui-image-url-box.txt`, and `gui-web-url-box.txt` when URL Box Persistence is enabled
- `universal-download-archive.txt`, `universal-gallerydl-archive.sqlite3`, and `universal-webcapture-archive.sqlite3` when universal archives are enabled
- case-level `manifests/gui-job-recovery-<job-id>.json` files for recovery details

The **Default** profile is used initially. Changes are saved to the active profile. Use **Profile > Save Current Settings to Profile...** to create a new profile or deliberately overwrite an existing one.

`python gui.py --fresh` clears app settings/state files, Job Queue persistence, URL-box persistence, app-owned temp files, the app debug log, universal archives, GUI cache folders under known Output Roots, and narrow app-owned atomic write temp files. It does not delete captured case folders, media files, cookies, binaries, scripts, case logs, manifests, or case-specific capture archives.

## Cookies Handling

Cookies File use is disabled by default.

Cookies can help with approved authenticated captures or previews, but they are sensitive operational data. Cookie use does not guarantee access to restricted, private, expired, challenge-protected, or unsupported content.

The app can:

- use a selected cookies file for Audio/Video Capture, Image Capture, Webpage Capture, and Audio/Video Preview when enabled
- export Mozilla Firefox cookies through yt-dlp's supported `--cookies-from-browser` flow
- optionally encrypt or decrypt local cookies files
- delete selected Audio/Video, Image Capture, and/or Webpage Capture cookies files on exit when configured

The built-in exporter targets Mozilla Firefox only. Run WAVI as the same Windows user who is signed into Firefox, and close Firefox if profile locking prevents export. Chromium-based browser cookie export is not offered because it may require additional system-specific decryption setup. Cookies files produced by compatible browser extensions can still be selected manually.

The app does not collect credentials or automate website logins. Webpage Capture accepts standard Netscape cookies files and records counts rather than cookie names or values. **Requested site only** is the default and imports cookies applicable to the submitted hostname. **Entire cookies file** loads every valid row into the isolated temporary browser for redirect and SSO compatibility, which may make authenticated cookies available to additional matching domains contacted during the capture. Cookies do not include local storage, IndexedDB, service-worker state, device-bound tokens, or every modern partitioned-cookie attribute, so some authenticated sites may still fail.

## Limitations

- Source support depends on the installed `yt-dlp` and `gallery-dl` versions, the selected Chromium browser and version, browser policy, and the source platform.
- Preview metadata and thumbnails are best-effort and may be incomplete, stale, unavailable, or slow.
- Large playlists, large galleries, very tall/dynamic webpages, and large cases may take time to capture, scan, cache, export, or verify.
- Universal archive skips can reflect captures from other cases by design. For Webpage Capture, the same URL may present changed content later; disable Universal Download Archive when a deliberate fresh capture is required.
- Browser impersonation depends on the installed `yt-dlp` build and may be blocked by endpoint policy.
- Webpage Capture may be blocked when browser remote debugging, developer tools, Deno child-process launches, loopback automation, or writes to the selected Output Root are restricted by enterprise policy.
- Infinite feeds, virtualized lists, canvas/WebGL content, animations, autoplaying video, bot challenges, login/MFA flows, and pages that detect headless automation may be incomplete or unavailable. Environment presets are controlled browser emulation settings, not proof of an exact physical device or network location.
- Webpage Capture does not automatically dismiss consent banners, sign in, submit forms, or perform unrestricted interaction. When **Interactive Overlays** is enabled, it only attempts conservative, pre-click-validated whitelist matches and may skip unsupported, ambiguous, virtualized, shadow-DOM, iframe, obscured, moving, or automation-resistant interfaces.
- Proxy/VPN behavior depends on local routing, policy, and source-platform handling.
- Case Browser thumbnails and media details generally require FFmpeg/FFprobe.
- Manifest verification checks file hashes only; it does not assess authenticity, context, or legal sufficiency.
- The app is not a substitute for authorization, evidence-handling policy, or analyst judgment.

## Changelog

See the [full changelog](CHANGELOG.md).
