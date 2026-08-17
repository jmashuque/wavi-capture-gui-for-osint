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
- browse local case files and verify SHA-256 manifests

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

`deno.exe` should be beside `yt-dlp.exe`. `gallery-dl.exe` can be beside the app or selected manually in the Image Capture tab. Webpage Capture uses the selected installed Chromium-family browser executable; the browser itself is not bundled. Webpage Capture keeps its temporary isolated browser workspace under the app-owned `gui-temp` folder and removes it after use.

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
   - **Output Root** is the parent folder where case folders will be created. It must be a writable folder; WAVI creates it when possible and checks write access before a capture is staged or started.
   - **Case Name** becomes the case subfolder. WAVI rejects resolved names that Windows reserves for devices, or that end in a space or period.
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
5. Review the media under the case `media` folder, the run log under `logs`, and the SHA-256 manifest under `manifests`.

Use **Audio/Video Preview** before capture when you need to inspect a playlist, title, thumbnail, or available metadata. See [Advanced Audio/Video Capture](#audiovideo-capture) for format strategies, metadata files, embeds, filtering, pacing, and archive controls.

### Capture Images

A single gallery URL can produce many files. When the size is uncertain, start with a small item limit or range.

1. Open **Image Capture** and confirm the paths to the PowerShell script and `gallery-dl.exe`.
2. Choose an Output Root and case name, then paste the approved image or gallery URL.
3. For a large or unfamiliar gallery, open **Capture Options**, enable **Limit max items**, and begin with a small number such as 10 or 25.
4. Run **Preflight Check**, then start the capture.
5. Review the images and metadata files under `media`, the gallery-dl log under `logs`, and the manifest under `manifests`. Use **Copy Case Summary** after a successful run when you need a concise record for case notes or handoff.

See [Advanced Image Capture](#image-capture) for metadata-only runs, item ranges, archive modes, pacing, retries, timeouts, cookies, and concurrency.

### Capture a Webpage

The default Webpage workflow creates a full-page PNG using a new isolated browser profile. It does not use the normal signed-in browser profile.

1. Open **Webpage Capture** and confirm the **Deno Path** and **Browser Path**. Use **Refresh** or **Browse** if the browser path is blank.
2. Choose an Output Root and case name, then paste an approved `http://` or `https://` URL.
3. Keep the default Capture Options for the first attempt. Open **PDF Options** only when a PDF is also required.
4. Run **Preflight Check**. This confirms that Deno and the selected browser can start correctly in WAVI's isolated capture environment.
5. Start the capture and review the image, webpage capture record (`.webcapture.json`), run log, and SHA-256 manifest. Review any **Complete with warnings**, **Partial**, or **Failed** classification before treating the capture as complete. After a successful run, **Copy Case Summary** includes the classification totals along with the case paths, tools, and selected Webpage options.

Webpage Capture does not dismiss consent banners, sign in, solve MFA/CAPTCHA challenges, submit forms, or provide unrestricted browsing. The optional **Interactive Overlays** feature can open and capture a limited number of likely gallery, media, or post items that match its safety rules; it remains disabled by default. An approved cookies file can be selected when required, but cookie use remains disabled by default. See [Advanced Webpage Capture](#webpage-capture) for readiness, scrolling, browser environment, interactive capture, evidence outputs, PDFs, and long-page controls.

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

Direct captures are saved for recovery only when **Job Persistence** is enabled. Audio/Video and Webpage jobs continue from the first URL not marked complete. Image jobs safely re-check the original URL list and use the selected gallery-dl archive to skip items already completed.

### Preview Audio/Video Links

Use **Audio/Video Preview** when you want to inspect media metadata or playlist/context entries before capture.

1. Add URLs to the preview list.
2. Run Preview for all, selected, or visible rows.
3. Review metadata, thumbnails, and playlist/context items.
4. Start or queue the rows you want to capture.

Preview is best-effort. It can be incomplete or slow depending on the site, cookies, network path, and installed `yt-dlp` build.

### Review a Case

Use **Case Browser** to review local case output.

- Case Browser follows the Output Root of the most recently completed direct or queued capture. Before a capture completes in the current session, it uses the Audio/Video Output Root; changing that field also makes it the current Case Browser root.
- Filter or sort case files.
- Open case folders or individual files.
- Verify the SHA-256 manifests generated by captures.

Case Browser is for local review only. It does not determine authenticity, context, or evidentiary value.

## Advanced Usage

This section is for technical users who are comfortable with capture-tool behaviour, site behaviour, rate limits, browser state, and organizational handling requirements. It explains option tradeoffs and recovery/output behaviour rather than repeating the first-run steps above.

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

Audio/Video Capture uses `script-ytdlp.ps1`, `yt-dlp.exe`, Deno where required by supported extractors, and FFmpeg/FFprobe. The URL box takes priority over selected Input File(s). Output is written beneath `<Output Root>\<Case Name>\media` using the selected template. WAVI passes `--ignore-config` for capture runs so unrelated yt-dlp configuration files cannot silently change the capture's output, proxy, archive, or other command-line behaviour.

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

When app-level **Universal Download Archive** is enabled, WAVI also uses `universal-download-archive.txt` for cross-case skipping. WAVI serializes Audio/Video executions that actually use this shared archive so their per-case archive synchronization cannot attribute another concurrent run's new archive entries to the wrong case. Audio/Video runs that do not use the universal archive retain their configured concurrency. An archive skip confirms a previous archive record; it does not mean the current case contains a fresh copy.

**Dates, title filters, and impersonation**

- **Date after** and **Date before** restrict supported sources by upload date.
- **Only capture titles matching** and **Reject titles matching** accept comma-separated keywords and build safe case-insensitive title filters.
- **Impersonate Target** is populated from the usable targets reported by the selected `yt-dlp.exe`; WAVI no longer assumes Chrome, Edge, or Firefox are available. Use **Check Targets** before selecting impersonation because availability depends on the installed yt-dlp build and local dependencies.
- After a successful check, **Any available** lets yt-dlp choose any usable impersonation target, while entries such as **Chrome (automatic)** let yt-dlp choose among the available fingerprints for that client family. Enable **Show specific targets** and check again to expose exact client/OS fingerprints such as `chrome-136:macos-15`. The OS in a specific target is the environment being impersonated, not the operating system running WAVI.
- WAVI does not force a separate Chrome User-Agent or `en-US` language header onto yt-dlp capture/preview requests. This avoids contradicting a selected impersonation target and leaves request identity/language handling to yt-dlp, its extractor, and the active impersonation handler.
- Impersonation does not bypass authentication or authorization controls and can affect download speed or stability.

**Failure handling and concurrency**

- **Continue after failed URL** keeps WAVI's submitted-URL loop running after a failed yt-dlp invocation. The failed invocation remains a failure; WAVI does not broadly suppress yt-dlp download or post-processing errors to continue the batch.
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
- **File manifest: Full** hashes eligible case evidence outside the `.gui-cache` and `manifests` control folders; **This run** limits the same evidence scope to files attributed to the current run. New manifest records use paths relative to the case folder so a complete case can be moved without invalidating those path references.

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

Image Capture uses `script-gallerydl.ps1` and `gallery-dl.exe`. It is intended for supported image posts, galleries, albums, and collection pages where one submitted URL may resolve to many files. The URL box takes priority over Input File(s). The image template is relative to the case `media` folder; case tags resolve when the job is created, while gallery-dl fields such as category, subcategory, ID, filename, and extension resolve per item. WAVI passes `--config-ignore` so default gallery-dl configuration files cannot silently override the capture settings selected in WAVI.

**Capture mode**

- **Download images/files and selected metadata** downloads supported items and writes the enabled sidecars.
- **Metadata/artifacts only** runs gallery-dl's normal extraction and selected metadata postprocessors while disabling the media download itself. Native extractor failures therefore remain visible as failures, and enabled metadata JSON, gallery-level info JSON, and tags outputs follow the same processing path used by a normal Image capture.

**Metadata sidecars**

- **Per-file metadata JSON** records metadata associated with individual extracted items where the extractor supplies it.
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

When app-level **Universal Download Archive** is enabled, Image Capture uses `universal-gallerydl-archive.sqlite3` for cross-case duplicate avoidance instead of the case archive. Metadata/artifacts-only runs keep their archive entries in a separate `wavi_metadata` table inside the selected SQLite archive, so metadata-only collection cannot make a later full-media capture skip the same item as already downloaded. Archive records identify prior successful items; they are not substitutes for artifacts in the current case.

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

The Image manifest hashes eligible case evidence outside the `.gui-cache` and `manifests` control folders. Manifest paths are recorded relative to the case folder so verification does not depend on the case remaining under its original Output Root.

Image recovery is archive-backed: continuing an interrupted Image job resubmits the original URLs and relies on the active gallery-dl archive to skip completed items. This differs from Audio/Video and Webpage recovery, which can continue from the first URL not marked complete.

After a successful direct or queued Image capture, **Copy Case Summary** provides a plain-text summary of submitted URLs, case and archive paths, file counts, gallery-dl version, templates, capture mode, metadata outputs, item limits, pacing, retries, timeout, concurrency, cookies, proxy, and VPN state. Its **▼** menu copies or exports Image-only captured and failed URLs for the case; failed-URL actions remain available after an unsuccessful run. Completed queue-job summaries can also be copied from the Job Queue.

Cookies, proxy settings, domain presets, and gallery-dl stable/dev update checks remain available. A cookies file can provide an approved session but cannot bypass login requirements, bot challenges, unsupported extractors, or source restrictions.

### Webpage Capture

Webpage Capture uses `script-webcapture.ps1`, `script-webcapture.ts`, `deno.exe`, and a selected installed Chromium-family browser. Deno controls the browser through Chromium's DevTools interface inside a temporary app-owned profile. The URL box takes priority over selected Input File(s). Primary webpage artifacts are written beneath `<Output Root>\<Case Name>\media\web` using the selected filename template.

**Capture mode**

| Mode | What it does | Typical use |
|---|---|---|
| **Full page only** | Captures the rendered document from top to bottom after the selected readiness and scrolling steps. Very tall pages may be saved as numbered segments. | Recommended general-purpose webpage capture. |
| **Initial viewport only** | Captures only the first visible browser viewport without full-page scrolling. | Preserving the initial presentation or avoiding interaction with long/dynamic pages. |
| **Full page + initial viewport** | Saves both the initial viewport and the full-page result. | Cases where both the first-screen context and the complete rendered page are useful. |

**Image format and execution**

**PNG** is lossless and is the recommended default. **JPEG** and **WebP** can reduce file size when lossy output is acceptable; their **Quality** setting does not apply to PNG. **Captured PNG (visual match)** PDF output requires PNG.

**Capture retries** can re-open a URL after a visual-capture failure. **Concurrent captures** controls separate active Webpage Capture jobs and is intentionally limited; Job Queue same-domain collision checks still apply. Raising concurrency can increase load on the source, browser, and local system.

**Readiness and page conditions**

Webpage Capture separates navigation from the point at which the page is considered ready to preserve. This is useful for sites that finish their initial load before important content appears.

- **Readiness event** can wait for **DOM content loaded** or **Full page load**. DOM content loaded is earlier; full page load waits for the browser's normal load event.
- **Maximum navigation** limits how long WAVI waits for the selected navigation event.
- **Network quiet** defines how long network activity must remain quiet before the page is considered settled.
- **Maximum settling** limits the network-settling stage. Set it to `0` to skip that stage.
- **Additional wait** adds a final fixed delay after the load event, network settling, and any enabled page conditions.
- **Wait for CSS selector** can require a specific element to **Exist** or be **Visible** before capture.
- **Wait for text** performs literal, case-sensitive matching against either visible page text or the complete DOM text.
- The selector and text checks share the configured **Shared timeout** when both are enabled.

When a readiness check times out, WAVI can **Capture with warning**, **Stop loading and capture**, or **Fail URL**. Invalid selectors and navigation failures still fail. Use explicit selector/text conditions only when the source has a stable condition that meaningfully indicates capture readiness; brittle conditions can make otherwise usable pages fail unnecessarily.

**Scrolling, page growth, and long pages**

- **Scroll through the page before full-page capture** helps trigger lazy-loaded images and content. **Wait**, **Maximum**, and **Stable checks** control the pace and stopping conditions.
- **Detect continued document-height growth** identifies pages that keep expanding during scrolling. **Maximum cycles** bounds the work, and **At growth limit** can save a partial result, save with a warning, or fail the URL.
- **Re-measure before capture** checks the final page dimensions again immediately before the image is produced.
- **Single-image height** and **Single-image MP** place safety limits on one image. Pages beyond those limits can be written as numbered segments using the configured **Segment height**, **Overlap**, and **Maximum segments**.

Long-page segmentation is a safety mechanism, not an error by itself. Review the `.webcapture.json` record to determine whether a result was complete, complete with warnings, partial, or failed and whether segmentation or continued growth affected the capture.

**Visual stabilization**

Optional visual controls can make highly animated or sticky pages easier to preserve:

- **Disable animations** and **Disable transitions** reduce motion during image capture.
- **Hide scrollbars** removes visible scrollbars from the captured image.
- **Fixed/sticky** can **Preserve** the site layout, **Neutralize** qualifying fixed/sticky positioning, or **Hide likely navigation** overlays.

These settings intentionally change the rendered presentation and are recorded in the webpage capture record. Leave them at their defaults when an unmodified rendered view is more important than reducing repeated or obstructive page elements. Live Page PDF has its own separate layout control.

**Environment and page state**

Environment presets provide repeatable browser-emulation settings without claiming to reproduce an exact physical device. Built-in desktop, tablet, and mobile presets configure the viewport, device scale factor, mobile layout, touch emulation, and orientation; **Custom** allows those values to be set individually.

Additional browser preferences include:

- **Locale** and **Timezone**, which can affect localized or time-sensitive page content.
- **Appearance** (`default`, light, or dark) and **Reduced motion**, which expose corresponding browser preferences to supporting sites.
- **Disable browser cache**, **Bypass service workers**, and **Reload once without cache** for captures where cached or service-worker-controlled content is undesirable.
- **Site storage** handling to keep storage, clear only the requested origin, or clear visited origins before capture.

These controls affect the isolated capture environment only. They do not modify the user's normal browser profile.

**Cookies and browser isolation**

Each Webpage Capture run uses a temporary app-owned browser profile rather than the user's everyday browser profile. WAVI does not read normal browser history, stored passwords, local storage, IndexedDB, or browser databases from that profile.

When an approved cookies file is enabled:

- **Requested site only** imports cookies applicable to the submitted hostname and is the safer default.
- **Entire cookies file** imports every valid row for redirect or SSO compatibility, which can expose authenticated cookies to additional matching domains contacted during the capture.
- **Clear browser cookies before each URL** prevents one submitted URL from carrying browser cookies into the next before the selected file is re-imported.

Normal browser security remains enabled. Certificate errors are not bypassed, and cookies do not guarantee access through login, MFA, bot challenges, device-bound authentication, or unsupported site flows.

**Interactive Overlays**

**Interactive Overlays** is disabled by default. It is intended for bounded capture of likely gallery, media, post, reel, photo, story, or highlight items that require opening an overlay or same-origin detail route before the content can be captured.

When enabled:

- **Output** can save the opened overlay, the resulting viewport, or both.
- **Maximum items** bounds the number of interactive matches processed for each submitted URL.
- **Scan step** controls how far WAVI advances while looking for additional candidates on long pages.
- **Open timeout**, **Content wait**, and **Close timeout** bound each open/capture/dismiss cycle.
- The interactive filename template supports the normal Webpage tags plus `%overlayindex%` and `%contentid%`; `%urlindex%` distinguishes the submitted source URL and `%profile%` can preserve a detected profile/account name when available.

Candidate discovery is rule-based. `interactive-whitelist.txt` identifies likely capture targets and `interactive-blacklist.txt` rejects known unsafe or irrelevant terms. Advanced users can extend those files using their documented `category|term` format; changes apply on the next preflight or capture.

Interactive capture sends real clicks to the webpage. WAVI excludes form submissions, cross-origin links, disabled controls, known high-risk social/account actions, and candidates it cannot classify conservatively, but authenticated or highly dynamic interfaces can still behave unexpectedly. Use a low item limit first and review the generated interactive report before scaling up.

**Evidence outputs**

The primary Webpage evidence remains the captured image/PDF, `.webcapture.json` record, run log, and SHA-256 manifest. Optional outputs can add context or troubleshooting detail:

| Evidence group | Available outputs | Notes |
|---|---|---|
| **Page snapshots** | MHTML snapshot, final response HTML, rendered DOM HTML | Useful for preserving browser-available page structure in addition to the visual capture. |
| **Network evidence** | Sanitized network report, failed-request report | Query values are redacted by default. Including full query strings can expose tokens or identifiers. |
| **Diagnostics** | Console warnings/errors, failure screenshot and metadata | Failure evidence is attempted after the final failed capture and does not make the URL complete. |
| **Security metadata** | TLS/browser-security report | Records browser-available security details without bypassing certificate validation. |

Response bodies, sensitive request headers, and request bodies are not recorded by the network evidence options. Enable only the supplemental outputs that are useful for the case; more evidence files also mean more material to review and retain.

**PDF options**

PDF creation is optional and is configured separately from the primary image capture.

| PDF source | What it does | Tradeoff |
|---|---|---|
| **Live Page (searchable)** | Prints the rendered webpage directly through Chromium. Text can remain searchable/selectable where the page permits it. | Site print CSS, fixed/sticky elements, and very long pages can affect pagination or output size. |
| **Captured PNG (visual match)** | Builds an image-only PDF from the captured PNG result. | Better visual correspondence with the screenshot, but text is not searchable and PNG output is required. |

Common PDF controls include landscape orientation, headers/footers, scale, paper size, margins, and—where supported by the selected source—site backgrounds and CSS page sizing. **Pages** accepts Live Page ranges such as `1-5` or `1,3,5-8`; a manual page range takes precedence over the automatic large-PDF policy.

For **Live Page** PDFs, **Live Page Layout** can keep the site's print layout, remove qualifying fixed/sticky positioning, or hide likely top navigation. This is separate from the image-capture **Fixed/sticky** setting and does not alter the saved PNG.

Large Live Page PDFs can use:

- **Automatic**, which estimates page count and splits when the configured threshold is reached.
- **Single PDF**, which attempts one PDF subject to the configured safety limits.
- **Split into parts**, which writes numbered PDF parts using the selected pages-per-part value.
- **Fail above safety limit**, which stops rather than generating an oversized PDF.

**Maximum total pages** and **Maximum parts** bound large-PDF work. When a split capture reaches a safety cap after producing valid parts, completed parts are retained and the result can be classified as partial. Explicit page ranges are handled separately from this automatic splitting policy.

Custom PDF headers and footers accept HTML. WAVI placeholders include `%requested_url%`, `%final_url%`, `%page_title%`, and `%capture_utc%`; Chromium also exposes its standard `date`, `title`, `url`, `pageNumber`, and `totalPages` template classes. Keep header/footer content compact so it does not consume excessive page area.

**Filename templates and output records**

The default Webpage filename template is:

```text
%datetime%_%domain%_%title%
```

Available Webpage tags include `%date%`, `%time%`, `%datetime%`, `%engine%`, `%domain%`, `%title%`, `%index%`, `%urlindex%`, `%profile%`, `%mode%`, and `%case%`. Use the template preview to confirm the resolved naming pattern before a large run.

Typical output:

```text
<case>\
  media\
    web\
      <captured images, optional PDFs, .webcapture.json records, and enabled evidence files>
  logs\
    web-capture_<timestamp>.log
  manifests\
    sha256-manifest-web_<timestamp>.csv
```

Every successful capture artifact and the Webpage run log are hashed. New manifest records use case-relative paths. The `.gui-cache` and `manifests` control folders are outside the evidence-manifest scope, so manifest CSVs, recovery records, archives, and universal-archive skip reports are not recursively hashed by another manifest. The `.webcapture.json` record documents the requested and final URLs, page title, browser and capture settings, readiness/scrolling outcomes, generated artifacts, hashes, warnings, and final completeness classification. When Universal Download Archive is enabled, **Complete** and **Complete with warnings** requested and redirected URLs can also be recorded in `universal-webcapture-archive.sqlite3` for cross-case skipping; **Partial** results remain terminal for recovery but are not added to the universal archive, so they cannot suppress a later cross-case capture. Skip reports are written under `manifests`.

After a successful direct or queued Webpage capture, **Copy Case Summary** provides a plain-text summary of case paths, tool/browser information, capture settings, evidence options, and completeness totals. Its **▼** menu copies or exports Webpage-only captured and failed URLs for the case. Completed queue-job summaries can also be copied from the Job Queue.

Webpage recovery records completed URLs and their completeness classifications. Continuing an interrupted Webpage job resumes at the first URL not marked complete. Site design, authentication challenges, anti-automation controls, browser or endpoint policy, infinite/virtualized content, and Chromium's own image/PDF limits can still prevent a complete capture.

### Job Queue, Persistence, and Recovery

The Job Queue runs staged work, manages concurrent captures, and resumes interrupted jobs. It supports `yt-dlp`, `gallery-dl`, and Webpage Capture jobs.

**Job Persistence** controls whether queue state is saved to `gui-jobs.json`. When it is enabled, queued jobs and direct captures are saved while they run. If a running job is still present when the app reopens, it is treated as interrupted and can be continued from the Job Queue. When Job Persistence is disabled, direct captures are not recoverable through the app after a close or crash.

Recovery behaviour is engine-specific:

- **Audio/Video Capture (`yt-dlp`)** records completed URL markers. Continuing an interrupted job submits the first incomplete URL and anything after it.
- **Image Capture (`gallery-dl`)** uses archive-backed retry. Continuing an interrupted image job resubmits the original URLs and lets the case archive, or the image universal archive when enabled, skip completed items.
- **Webpage Capture** records completed URL markers and per-URL **Complete**, **Complete with warnings**, **Partial**, or **Failed** classifications in its queue/recovery state. Continuing an interrupted job starts with the first webpage URL not marked complete. When Universal Download Archive is enabled, only previously **Complete** or **Complete with warnings** submitted/final redirected URLs are skipped across cases; **Partial** results are deliberately excluded from that cross-case suppression.

Concurrent queue behaviour:

- Audio/Video, Image Capture, and Webpage Capture have separate concurrent-capture limits. Each queued job keeps the limit captured when it was added; changing the GUI later does not retroactively change that job. When same-engine jobs have different limits, WAVI honours the most restrictive limit among the active job(s) and the candidate job.
- A direct capture occupies its engine's single direct slot until it finishes. Raising that engine's concurrency setting while the direct capture is already running does not cause a same-engine queued job to start beside it.
- `yt-dlp`, `gallery-dl`, and Webpage Capture jobs may run at the same time when their domains do not collide.
- Same-domain concurrent jobs trigger a collision prompt so users can continue, wait, or cancel.
- **Pause After Active** lets all currently active queue jobs finish and then pauses pending work. **Stop Active Jobs** interrupts all currently active queue jobs and pauses the queue; direct capture Stop buttons affect only the direct capture on their own tab.

Each recoverable job can write `manifests/gui-job-recovery-<job-id>.json` under the case folder. These files explain what the app tried to resume; they are not a replacement for the normal case manifest or review notes.

### Case Manifest Verification

Case Browser recognizes Audio/Video, Image, and Webpage SHA-256 manifest CSVs. **Verify Case Files** combines all recognized manifests in the selected case instead of checking only the newest file. When more than one manifest records the same case file, the newest applicable record supplies the expected current hash. This allows run-scoped manifests from later captures to update individual files without discarding coverage recorded by earlier manifests.

New manifests use case-relative paths. Case Browser also understands the older absolute-path A/V/Webpage format and the older Image `SHA256`/`RelativePath` column format. When a legacy absolute-path case has been moved as a complete case folder, Case Browser attempts to resolve the recorded path back inside the currently selected case rather than reading files outside that case.

Verification intentionally ignores `.gui-cache` and the `manifests` control folder. Those locations contain derived display cache, manifest CSVs, mutable recovery state, case archive data, and skip/control reports rather than the primary captured evidence covered by the evidence manifests. Files elsewhere in the case that are not represented by any recognized manifest are reported as new/untracked. Hash verification confirms byte-level agreement with the recorded SHA-256 values; it does not determine authenticity, context, or evidentiary sufficiency.

### Domain Presets, Proxy, VPN, and Archives

- **Domain Presets** can apply capture settings automatically to matching Audio/Video or Image Capture URLs.
- **Proxy Options** are app-level and can be passed to the capture scripts and Webpage Capture. Webpage Capture supports only proxies that do not require credentials.
- **Check VPN** is disabled by default and warns before capture when enabled and the selected adapter does not look connected.
- Case summaries snapshot the effective app-level proxy, VPN-check, and universal-archive state used when execution begins, so changing those controls while a capture is running does not rewrite the finished summary to describe a later GUI state.
- **Universal Download Archive** uses separate app-level archive files:
  - `universal-download-archive.txt` for Audio/Video Capture
  - `universal-gallerydl-archive.sqlite3` for Image Capture
  - `universal-webcapture-archive.sqlite3` for Webpage Capture

The Webpage Capture archive uses SQLite to store requested URLs, final redirected URLs, capture timestamps, case names, job IDs, capture-record paths, and capture history for **Complete** and **Complete with warnings** results. **Partial** results are not recorded there. Matching archived submitted or final URLs are skipped before navigation, and the case receives JSON/CSV skip reports under `manifests`. Universal archives are useful for avoiding repeat captures across cases, but they are not evidence artifacts for a specific case.

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

`python gui.py --fresh` clears app settings/state files, Job Queue persistence, URL-box persistence, app-owned temp files, the app debug log, universal archives, GUI cache folders under known Output Roots. It does not delete captured case folders, media files, cookies, binaries, scripts, case logs, manifests, or case-specific capture archives. **Settings > Clear URL History** checks the currently configured Audio/Video, Image, and Webpage Output Roots and removes only their GUI captured/failed URL history files after confirmation.

## Cookies Handling

Cookies File use is disabled by default. When **Use** is enabled for a capture tab, WAVI requires a selected, existing cookies file instead of silently continuing without one.

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
- Proxy/VPN behaviour depends on local routing, policy, and source-platform handling.
- Case Browser thumbnails and media details generally require FFmpeg/FFprobe.
- Manifest verification checks file hashes only; it does not assess authenticity, context, or legal sufficiency.
- The app is not a substitute for authorization, evidence-handling policy, or analyst judgment.

## Changelog

See the [full changelog](CHANGELOG.md).
