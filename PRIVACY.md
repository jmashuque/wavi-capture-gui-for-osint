# WAVI Capture GUI for OSINT Privacy Policy

Effective date: 2026-09-17

WAVI Capture GUI for OSINT ("WAVI") is an open-source, local Windows application for user-directed webpage, audio, video, image, and gallery/profile capture workflows. The WAVI Capture Helper Firefox extension is an optional companion component of the same project.

This policy describes privacy-related behaviour of both the WAVI desktop application and WAVI Capture Helper.

## Local-first design

WAVI is designed to run locally on the user's computer. It does not operate a WAVI-hosted cloud service for capture processing, case storage, analytics, advertising, or telemetry.

Captured files, Job Queue records, case metadata, logs, hashes, URL history, settings, and other WAVI-generated records are written to the user's selected local paths or WAVI's local application files according to the user's configuration and workflow.

WAVI does not automatically upload captured cases or local WAVI records to the project developer.

## Network activity initiated by WAVI

WAVI and its approved companion tools make network requests when the user performs capture, preview, update, or related operations. These requests may include connections to:

- URLs the user submits for capture or preview;
- websites, media hosts, CDNs, redirects, and other endpoints required by the selected source or capture tool;
- proxy or VPN paths configured by the user; and
- GitHub or other official tool-release sources when the user explicitly runs an update check or update helper.

Those external services may receive normal network information associated with the user's request, such as IP address, request headers, URLs, or cookies supplied by the user or selected capture configuration. Their handling of that information is governed by their own policies and the user's network environment.

## Cookies and authentication data

WAVI does not collect account passwords or automate website sign-ins.

When the user explicitly enables a cookies file for a supported capture workflow, WAVI or the selected capture tool may use those cookies to make authenticated requests to matching websites. Cookies are sensitive operational data and remain under the user's control. WAVI records cookie counts or configuration state where applicable rather than intentionally logging cookie values.

WAVI also provides an explicit Firefox cookie-export workflow through supported capture-tool functionality. The WAVI Capture Helper extension does not currently collect or transfer Firefox session cookies.

## WAVI Capture Helper Firefox extension

WAVI Capture Helper is an optional Firefox WebExtension that allows the user to send the active HTTP/HTTPS tab URL to a locally running WAVI instance and select one of WAVI's capture engines.

### Data transmitted by the extension

When the user explicitly selects **Audio / Video**, **Gallery / Profile**, or **Webpage Capture**, the extension sends:

- the active tab URL; and
- the selected WAVI capture engine.

The submitted URL may include the scheme, hostname, path, query string, and fragment exposed by Firefox.

The extension sends this information only to the loopback address `127.0.0.1` on the WAVI listener port configured by the user. It does not send browsing activity to the WAVI developer, Mozilla, analytics providers, advertising services, or any other remote service.

The extension also uses a locally stored WAVI pairing token to authenticate token verification and capture requests to that same loopback listener.

### Data stored by the extension

WAVI Capture Helper uses Firefox local extension storage for:

- the WAVI pairing token;
- the configured WAVI listener port; and
- limited latest-request state used to show status, such as capture engine, result state, and WAVI Job ID.

The extension does not persist submitted tab URLs as extension history.

### Data not currently collected or transmitted by the extension

WAVI Capture Helper does not currently collect or transmit:

- Firefox cookies or browser-session cookies;
- page text, images, video, form data, or other webpage content;
- general browsing history beyond the active-tab URL the user explicitly submits for capture;
- telemetry, analytics, advertising identifiers, or crash-reporting data; or
- data to a remote WAVI service, because no remote WAVI service is used.

### Private browsing

WAVI Capture Helper is not available in Firefox Private Browsing windows.

### Local WAVI records created from extension requests

After WAVI accepts a URL submitted by the extension, the WAVI desktop application may retain that URL and related capture information in its local Job Queue, case records, logs, URL history, or capture metadata according to the user's WAVI configuration and workflow.

## Browser integration controls

WAVI's Browser Integration API is disabled by default. When enabled, it listens only on `127.0.0.1` using the user-configured listener port.

The user must explicitly enable the local API and pair the Firefox extension with WAVI. The extension provides a **Forget token** control, and WAVI can regenerate its pairing token to invalidate the previously saved token.

## Update checks

WAVI's application update check is user-initiated. When used, WAVI contacts the project's GitHub release infrastructure to determine whether a newer release exists and, when requested, can download the latest release source archive for local staging and review.

WAVI does not automatically replace or execute downloaded application files.

## Telemetry and analytics

The WAVI project does not include project-operated telemetry, analytics, advertising, or behavioural tracking in the desktop application or WAVI Capture Helper extension.

## Future features

If a future release materially changes what information WAVI or WAVI Capture Helper collects, stores, or transmits, this policy and any applicable Firefox data-collection declaration will be updated before that feature is released.

In particular, any future optional Firefox session-cookie transfer feature will require an updated privacy review and Firefox extension declaration before release.

## Source code

WAVI Capture GUI for OSINT and WAVI Capture Helper are developed in the same open-source repository:

https://github.com/jmashuque/wavi-capture-gui-for-osint
