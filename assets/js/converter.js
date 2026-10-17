/*
 * MRPack to ZIP — conversion engine
 *
 * Derived from the Fabulously Optimized mrpack-to-zip project.
 * Copyright (c) 2022-2024, Jamie Mansfield, Fabulously Optimized contributors.
 * BSD 2-Clause licence — see LICENSE.
 *
 * What this engine does (unchanged from upstream):
 *   1. Reads modrinth.index.json from a local .mrpack archive.
 *   2. Copies overrides/ and client-overrides/ into a new archive.
 *   3. Downloads the files listed in the manifest (except GitHub-hosted ones,
 *      which are opened in a new tab because GitHub blocks CORS reads).
 *   4. Builds a ZIP named "<name>-<versionId>.zip" and saves it.
 *
 * The changes here are limited to integration and reporting: obsolete URL and
 * project-ID entry points are gone, unsafe paths and bad manifest entries are
 * skipped instead of crashing, failed downloads are collected rather than
 * aborting the whole archive, and progress reflects only real work.
 */

const modal = document.getElementById("loading-modal");
const progress = document.getElementById("loading-progress");

const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");

const MRZ_MANIFEST = "modrinth.index.json";

/* --- Small helpers ------------------------------------------------------- */

class MrzError extends Error {
  constructor(title, message, detail) {
    super(message);
    this.name = "MrzError";
    this.title = title;
    this.detail = detail || "";
  }
}

function mrzEmit(name, payload) {
  const ui = window.mrzUI;
  if (ui && typeof ui[name] === "function") {
    try {
      ui[name](payload);
    } catch (error) {
      console.error("Interface hook failed:", error);
    }
  }
}

function mrzShowProgress() {
  if (modal) {
    modal.classList.add("is-active");
  }
}

function mrzHideProgress() {
  if (modal) {
    modal.classList.remove("is-active");
  }
}

function mrzStage(label, detail) {
  mrzEmit("status", { label: label, detail: detail || "" });
}

function mrzReportError(error) {
  mrzHideProgress();

  const isKnown = error instanceof MrzError;
  const title = isKnown ? error.title : "Conversion failed";
  const message = isKnown
    ? error.message
    : "The conversion stopped unexpectedly. The pack may be damaged, or this browser may not have enough memory to finish it.";
  const detail = isKnown
    ? error.detail
    : (error && (error.stack || error.message)) || String(error);

  if (window.mrzUI && typeof window.mrzUI.error === "function") {
    window.mrzUI.error({ title: title, message: message, detail: detail });
  } else {
    // Fallback for the standalone vanilla.html page, which has no result UI.
    alert(title + "\n\n" + message);
  }
  console.error(title + ": " + message, error);
}

function toHttpUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.href;
    }
  } catch (error) {
    return null;
  }
  return null;
}

/* A destination path inside the produced ZIP must stay inside it. */
function isSafeArchivePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }
  if (path.charAt(0) === "/" || path.charAt(0) === "\\") {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    return false;
  }
  return path.split(/[\\/]/).every(function (segment) {
    return segment !== "..";
  });
}

/* --- Manifest reading ---------------------------------------------------- */

async function readManifest(source) {
  let zip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch (error) {
    throw new MrzError(
      "That file could not be opened",
      "The selected file is not a readable ZIP archive. An MRPack is a ZIP archive, so the file may be damaged or incomplete.",
      error && error.message
    );
  }

  const manifestFile = zip.file(MRZ_MANIFEST);
  if (!manifestFile) {
    throw new MrzError(
      "No MRPack manifest",
      "The archive does not contain modrinth.index.json at its root, so it is not a Modrinth modpack.",
      "Missing entry: " + MRZ_MANIFEST
    );
  }

  const raw = await manifestFile.async("string");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new MrzError(
      "Invalid pack manifest",
      "modrinth.index.json could not be parsed as JSON. The pack may be corrupted or not a genuine MRPack.",
      error && error.message
    );
  }

  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) {
    throw new MrzError(
      "Invalid pack manifest",
      "The manifest does not contain a valid list of files, so there is nothing to assemble.",
      "Expected an object with a \"files\" array."
    );
  }

  return { zip: zip, manifest: manifest };
}

/* Categorise manifest entries once, so inspection and conversion agree. */
function collectEntries(manifest) {
  const result = {
    fetchable: [],
    github: [],
    invalid: [],
    unsafe: []
  };

  for (let index = 0; index < manifest.files.length; index++) {
    const file = manifest.files[index];
    const label = file && typeof file.path === "string" ? file.path : "entry " + (index + 1);

    if (!file || typeof file.path !== "string" || !isSafeArchivePath(file.path)) {
      result.unsafe.push(label);
      continue;
    }

    let url = null;
    if (Array.isArray(file.downloads)) {
      for (let d = 0; d < file.downloads.length && !url; d++) {
        url = toHttpUrl(file.downloads[d]);
      }
    }

    if (!url) {
      result.invalid.push(label);
      continue;
    }

    // Preserved upstream behaviour: GitHub release downloads cannot be read in
    // the browser, so they are opened in a new tab instead of being fetched.
    if (url.includes("github.com")) {
      result.github.push({ path: file.path, url: url });
      continue;
    }

    result.fetchable.push({
      path: file.path,
      url: url,
      size: typeof file.fileSize === "number" && file.fileSize > 0 ? file.fileSize : 0
    });
  }

  return result;
}

function inspectOverrides(zip) {
  let overrides = 0;
  let clientOverrides = 0;

  for (const entryName in zip.files) {
    const file = zip.files[entryName];
    if (file.dir) {
      continue;
    }
    if (file.name.indexOf("overrides/") === 0) {
      overrides++;
    } else if (file.name.indexOf("client-overrides/") === 0) {
      clientOverrides++;
    }
  }

  return { overrides: overrides, clientOverrides: clientOverrides };
}

async function inspectMrpack(source) {
  const loaded = await readManifest(source);
  const entries = collectEntries(loaded.manifest);
  const overrides = inspectOverrides(loaded.zip);
  let downloadBytes = 0;

  entries.fetchable.forEach(function (entry) {
    downloadBytes += entry.size;
  });

  return {
    manifest: loaded.manifest,
    fileCount: loaded.manifest.files.length,
    fetchableCount: entries.fetchable.length,
    githubCount: entries.github.length,
    invalidCount: entries.invalid.length,
    unsafeCount: entries.unsafe.length,
    downloadBytes: downloadBytes,
    overrides: overrides
  };
}

/* --- Public entry points (kept for the existing markup) ------------------ */

function updateFileName() {
  if (fileInput && fileInput.files && fileInput.files.length > 0 && fileName) {
    fileName.textContent = fileInput.files[0].name;
  }
}

function downloadLocalButton() {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    mrzReportError(new MrzError(
      "No file selected",
      "Choose a .mrpack file first, then start the conversion."
    ));
    return;
  }
  downloadPackData(fileInput.files[0]);
}

/* Used by vanilla.html, which converts a remote pack URL. */
function downloadPack(url) {
  const validUrl = toHttpUrl(url);
  if (!validUrl) {
    mrzReportError(new MrzError(
      "That is not a valid link",
      "The address provided is not a readable http or https URL."
    ));
    return;
  }

  mrzShowProgress();
  mrzEmit("start", {});
  mrzStage("Downloading pack", "Fetching the .mrpack archive");

  JSZipUtils.getBinaryContent(validUrl, function (error, data) {
    if (error) {
      mrzReportError(new MrzError(
        "Could not download that pack",
        "The pack archive could not be downloaded. The link may have expired, or the host may not allow browser access.",
        error && (error.message || String(error))
      ));
      return;
    }
    downloadPackData(data);
  });
}

/* --- Conversion ---------------------------------------------------------- */

function buildZipName(manifest) {
  const name = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : "modpack";
  const version = typeof manifest.versionId === "string" && manifest.versionId.trim() ? "-" + manifest.versionId.trim() : "";
  const base = (name + version).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  return (base.slice(0, 120) || "modpack") + ".zip";
}

async function downloadPackData(data) {
  if (!data || (typeof data.length === "number" && data.length <= 0)) {
    mrzReportError(new MrzError(
      "No file selected",
      "Choose a .mrpack file first, then start the conversion."
    ));
    return;
  }

  mrzShowProgress();
  mrzEmit("start", {});
  mrzStage("Reading archive", "Opening the local .mrpack file");

  try {
    const loaded = await readManifest(data);
    const zip = loaded.zip;
    const manifest = loaded.manifest;
    const entries = collectEntries(manifest);
    const overrides = inspectOverrides(zip);

    /* 1. Copy overrides into the new archive. */
    mrzStage("Copying overrides", "Including pack overrides and client overrides");

    const newZip = new JSZip();
    const skippedOverridePaths = [];

    for (const entryName in zip.files) {
      const file = zip.files[entryName];
      if (file.dir) {
        continue;
      }

      let properFileName = null;
      if (file.name.indexOf("overrides/") === 0) {
        properFileName = file.name.substring("overrides/".length);
      } else if (file.name.indexOf("client-overrides/") === 0) {
        properFileName = file.name.substring("client-overrides/".length);
      }
      if (!properFileName) {
        continue;
      }

      if (!isSafeArchivePath(properFileName)) {
        skippedOverridePaths.push(file.name);
        continue;
      }

      // JSZip accepts the promise directly, as in the original implementation.
      newZip.file(properFileName, file.async("blob"));
    }

    /* 2. GitHub-hosted entries cannot be read by the browser. Open them, as
       upstream does, and report them as not included. */
    entries.github.forEach(function (entry) {
      window.open(entry.url, "_blank");
    });

    /* 3. Download the readable manifest files. */
    let totalFileSize = 0;
    entries.fetchable.forEach(function (entry) {
      totalFileSize += entry.size;
    });

    if (progress) {
      progress.max = totalFileSize > 0 ? totalFileSize : 1;
      progress.value = 0;
    }

    mrzStage(
      "Downloading files",
      entries.fetchable.length + " file" + (entries.fetchable.length === 1 ? "" : "s") +
      " to retrieve" + (entries.github.length ? ", " + entries.github.length + " opened externally" : "")
    );

    let downloaded = 0;
    const failures = [];

    const filePromises = entries.fetchable.map(function (entry) {
      return fetch(entry.url)
        .then(function (response) {
          if (!response.ok) {
            throw new Error("HTTP " + response.status + " " + response.statusText);
          }
          return response.blob();
        })
        .then(function (blob) {
          newZip.file(entry.path, blob);
          downloaded += entry.size || blob.size;
          if (progress) {
            progress.value = Math.min(downloaded, progress.max);
          }
        })
        .catch(function (error) {
          failures.push({
            path: entry.path,
            url: entry.url,
            reason: (error && error.message) || "Request failed"
          });
        });
    });

    await Promise.all(filePromises);

    /* 4. Build the archive. */
    mrzStage("Building ZIP archive", "Packing " + (entries.fetchable.length - failures.length) + " downloaded files with overrides");

    if (progress) {
      progress.max = 100;
      progress.value = 0;
    }

    const content = await newZip.generateAsync({ type: "blob" }, function (metadata) {
      if (progress && metadata && typeof metadata.percent === "number" && isFinite(metadata.percent)) {
        progress.value = Math.min(metadata.percent, 100);
      }
    });

    const zipName = buildZipName(manifest);

    let autoSaveFailed = false;
    try {
      saveAs(content, zipName);
    } catch (error) {
      autoSaveFailed = true;
      console.error("Could not start the automatic download:", error);
    }

    mrzHideProgress();
    mrzEmit("success", {
      filename: zipName,
      blob: content,
      autoSaveFailed: autoSaveFailed,
      included: entries.fetchable.length - failures.length,
      overrides: overrides,
      requested: manifest.files.length,
      warnings: {
        failed: failures,
        github: entries.github,
        invalid: entries.invalid,
        unsafe: entries.unsafe,
        overrides: skippedOverridePaths
      }
    });
  } catch (error) {
    mrzReportError(error);
  }
}

/* Exposed so the redesigned interface can validate a file before converting. */
window.MRZ = {
  inspect: inspectMrpack
};
