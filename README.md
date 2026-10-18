# MRPack to ZIP

A small, focused web utility that turns a Modrinth `.mrpack` modpack into a plain
`.zip` archive. **Interface designed by MrDefault.** The conversion engine is
based on the open-source [Fabulously Optimized MRPack-to-ZIP](https://github.com/Fabulously-Optimized/mrpack-to-zip)
project (BSD 2-Clause, see [`LICENSE`](LICENSE)), which itself is based on
<https://codeberg.org/jamie/mrpack-to-zip>.

Everything runs in the browser. There is no backend, no build step, and no
framework.

- Source code: <https://github.com/MrDefault7/mrpack-to-zip>
- Bug reports and questions: [that repository's issue tracker](https://github.com/MrDefault7/mrpack-to-zip/issues)

## What the converter actually does

1. Reads the selected `.mrpack` with JSZip and requires `modrinth.index.json` at
   the archive root.
2. Copies `overrides/` and `client-overrides/` into a new archive.
3. Downloads the files listed in `manifest.files` from the URLs in the manifest.
4. Builds a ZIP named `<pack name>-<versionId>.zip` and saves it with FileSaver.

The interface inspects the archive as soon as it is selected, so a wrong file
type, a damaged archive, a missing manifest, or invalid JSON is reported before
any download starts.

## Known limitations (unchanged from the engine, reported honestly in the UI)

- **GitHub-hosted files are not included.** GitHub release downloads do not allow
  browser scripts to read the response, so those entries are opened in a new tab,
  exactly as the upstream engine does. The result screen lists them.
- **Cross-origin hosts can refuse the read.** Any host that withholds CORS
  headers, or whose link has expired, produces a failed download. Failed files
  are listed with their URL and the reason.
- **`server-overrides/` is not copied.** The output is a client-oriented archive:
  `overrides/` plus `client-overrides/`.
- **`env` is not used to filter files.** Every manifest entry is handled
  regardless of its `client`/`server` values, which matches upstream behaviour.
- **Memory is the real limit.** The input archive, the downloaded files, and the
  output ZIP are all held in memory, and `generateAsync()` buffers the full
  result. No artificial size limit is imposed; large packs can exhaust a browser
  tab, especially on mobile.
- **Progress is byte-based.** Manifest `fileSize` values drive the download
  progress, and JSZip's own report drives the archive build. Nothing is estimated
  or invented; entries without a declared size simply do not advance the bar.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | The converter and its explanatory content |
| `privacy.html`, `terms.html` | Legal pages |
| `assets/css/site.css` | The whole design system (tokens, layout, components) |
| `assets/js/converter.js` | Conversion engine (derived from upstream) |
| `assets/js/ui.js` | Interface integration: selection, validation, progress, results |
| `assets/js/theme.js` | Light/dark theme, following the system by default |
| `assets/js/jszip.min.js`, `FileSaver.min.js`, `jszip-utils.min.js` | Vendored dependencies, unchanged |
| `assets/img/` | Favicon, touch icon, social preview image |
| `vanilla.html` | Upstream page for the Fabulously Optimized vanilla launcher flow (kept unchanged) |
| `robots.txt`, `sitemap.xml` | Crawler files |

The engine keeps its original public functions so existing markup continues to
work: `downloadLocalButton()`, `updateFileName()`, `downloadPackData(data)` and
`downloadPack(url)`. The DOM integration points `#file-input`, `#file-name`,
`#loading-modal` and `#loading-progress` are preserved.

The obsolete `?project=` and `?url=` automatic conversion entry points have been
removed, together with the project ID, direct URL, and Fabulously Optimized
promotional sections.

## Colour theme

The interface ships with a light and a dark palette built from the same token
set, plus a switch in the header. A visitor who has never chosen a theme gets
their operating system's preference, which is the default; the header button
cycles System → Light → Dark and back. The resolved theme is written to
`<html data-theme>` by `assets/js/theme.js` before the first paint, so the page
never flashes the wrong palette, and `<meta name="theme-color">` follows it.

The choice is the only thing stored in the browser, and JavaScript storage being
unavailable or blocked simply means the choice is not remembered.

## Privacy behaviour

- The selected `.mrpack` is read in the browser and is **not uploaded**. There is
  no upload endpoint in the project.
- The converter requests the download URLs found in the manifest. Those hosts
  (typically `cdn.modrinth.com`, sometimes `github.com`) see the request and the
  visitor's IP address, and apply their own policies.
- The site sets no cookies and has no analytics or advertising. The only value
  it writes to browser storage is the colour theme choice, under the single key
  `mrz-theme`; it holds just `light` or `dark`, is never transmitted, and is
  removed when the visitor selects the system option.
- Files live in browser memory only and are discarded when the page is closed,
  refreshed, or when another file is selected.

`privacy.html` and `terms.html` describe exactly this behaviour. Both were
written from an audit of the application code rather than from a template, and
neither claims anything the code does not do. Have the final wording reviewed for
your jurisdiction before any commercial use.

## Running locally

No build step is required; serve the directory over HTTP:

```
npx serve .
# or
python -m http.server 8000
```

Opening `index.html` directly over `file://` also works for the local-file
workflow, but a local HTTP server is closer to production.

## Deployment checklist

1. **Know the production origin.** `index.html`, `privacy.html`, `terms.html`,
   `robots.txt`, and `sitemap.xml` currently use
   `https://mrpack-to-zip-ten.vercel.app/` for `canonical`, `og:url`, `og:image`, and
   the sitemap. If you attach a custom domain, update that origin in those five
   files (a plain find-and-replace) so search engines see one canonical URL.
2. Serve over HTTPS. The page is static; no server configuration beyond correct
   MIME types is needed.
3. Submit `sitemap.xml` in Google Search Console once the domain is live.
4. If the hosting provider's request logging differs from what the privacy policy
   describes, update section 4 of `privacy.html`.

### Vercel

The project is plain static files, so Vercel needs no build configuration:

1. Import <https://github.com/MrDefault7/mrpack-to-zip> as a new project.
2. Framework preset: **Other**. Leave the build command and output directory
   empty; the files are served from the repository root.
3. Deploy. No rewrites or routes are needed: `index.html`, `privacy.html`,
   `terms.html`, `robots.txt`, and `sitemap.xml` are all static assets.
4. Vercel assigns a `*.vercel.app` URL. The site already assumes
   `https://mrpack-to-zip-ten.vercel.app/`; if your project gets a different
   `vercel.app` name, update the origin as described in step 1 above.

## Testing

The conversion path was verified end to end against generated `.mrpack` fixtures
in a real browser: valid packs, dropped files, replaced and removed files,
repeated conversions, archives without a manifest, invalid manifest JSON,
non-archive files, empty files, wrong extensions, failed downloads (HTTP 404),
GitHub-hosted entries, unsafe `../` paths, and packs with no downloadable files
at all. Output archives were reopened and their entries and contents compared
against the fixture manifests.

## Attribution

- Conversion engine: [Fabulously Optimized MRPack-to-ZIP](https://github.com/Fabulously-Optimized/mrpack-to-zip),
  BSD 2-Clause. Copyright notices and disclaimers are retained in `LICENSE` and in
  the header of `assets/js/converter.js`.
- Interface, layout, and content: MrDefault.
- Not affiliated with, endorsed by, or officially associated with Modrinth,
  Mojang, or Microsoft.
