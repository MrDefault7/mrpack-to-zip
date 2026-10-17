/*
 * MRPack to ZIP — interface integration
 * Interface by MrDefault.
 *
 * Handles file selection and validation, conversion state, progress detail,
 * result warnings and error presentation. The conversion itself lives in
 * converter.js; this file only talks to it through downloadLocalButton()
 * and the window.mrzUI hooks.
 */

(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var browseButton = document.getElementById("browse-button");
  var filebox = document.getElementById("filebox");
  var fileNameEl = document.getElementById("file-name");
  var fileSizeEl = document.getElementById("file-size");
  var fileTypeEl = document.getElementById("file-type");
  var fileSummary = document.getElementById("file-summary");
  var fileWarning = document.getElementById("file-warning");
  var validationDot = document.getElementById("validation-dot");
  var validationText = document.getElementById("validation-text");
  var replaceButton = document.getElementById("replace-file");
  var removeButton = document.getElementById("remove-file");

  var convertButton = document.getElementById("convert-button");
  var convertLabel = document.getElementById("convert-label");
  var convertSpinner = document.getElementById("convert-spinner");
  var convertIcon = document.getElementById("convert-icon");
  var statusTitle = document.getElementById("status-title");
  var statusStage = document.getElementById("status-stage");
  var progressEl = document.getElementById("loading-progress");
  var progressCount = document.getElementById("progress-count");
  var progressPercent = document.getElementById("progress-percent");

  var successPanel = document.getElementById("success-panel");
  var successTitle = document.getElementById("success-title");
  var successText = document.getElementById("success-text");
  var successFile = document.getElementById("success-file");
  var successWarnings = document.getElementById("success-warnings");
  var downloadButton = document.getElementById("download-zip");
  var convertAnotherButton = document.getElementById("convert-another");

  var errorPanel = document.getElementById("error-panel");
  var errorTitle = document.getElementById("error-title");
  var errorText = document.getElementById("error-text");
  var errorDetails = document.getElementById("error-details");
  var errorDetail = document.getElementById("error-detail");

  var WARNING_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<path d="M12 3.5 21 20H3z" stroke-linejoin="round"/>' +
    '<path d="M12 9.5v4.5m0 2.8v.2" stroke-linecap="round"/></svg>';

  var selectedFile = null;
  var selectedInfo = null;
  var converting = false;
  var inspectToken = 0;
  var lastResult = null;
  var progressMode = "download";
  var rafId = 0;

  successTitle.setAttribute("tabindex", "-1");
  errorTitle.setAttribute("tabindex", "-1");

  /* --- Formatting ------------------------------------------------------- */

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || !isFinite(bytes) || bytes <= 0) {
      return "0 KB";
    }
    var units = ["B", "KB", "MB", "GB"];
    var index = 0;
    var value = bytes;
    while (value >= 1024 && index < units.length - 1) {
      value = value / 1024;
      index++;
    }
    var decimals = index === 0 || value >= 100 ? 0 : 1;
    return value.toFixed(decimals) + " " + units[index];
  }

  function truncate(value, limit) {
    if (typeof value !== "string") {
      return "";
    }
    return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
  }

  /* --- Panel state ------------------------------------------------------ */

  function hideError() {
    errorPanel.classList.remove("is-visible");
    errorDetail.textContent = "";
    errorDetails.hidden = true;
  }

  function showError(data) {
    errorTitle.textContent = data.title || "Something went wrong";
    errorText.textContent = data.message || "";
    var detail = data.detail || "";
    errorDetail.textContent = detail;
    errorDetails.hidden = !detail;
    errorDetails.open = false;
    errorPanel.classList.add("is-visible");

    window.setTimeout(function () {
      errorTitle.focus({ preventScroll: true });
    }, 30);
  }

  function hideSuccess() {
    successPanel.classList.remove("is-visible");
    successWarnings.textContent = "";
    var extra = successPanel.querySelector(".result-details");
    if (extra) {
      extra.remove();
    }
  }

  /* Resets the visible state without touching the file input, so a browser
     supplied FileList stays valid for downloadLocalButton(). */
  function resetUiState() {
    inspectToken++;
    selectedFile = null;
    selectedInfo = null;
    lastResult = null;
    converting = false;

    if (fileNameEl) {
      fileNameEl.textContent = "No file selected";
    }
    filebox.classList.remove("is-visible");
    dropzone.hidden = false;
    fileSummary.textContent = "";
    fileWarning.textContent = "";
    fileWarning.hidden = true;
    fileTypeEl.textContent = "MRPack archive";
    validationText.textContent = "Awaiting a file";
    validationDot.className = "status-dot";

    convertButton.disabled = true;
    convertButton.classList.remove("is-busy", "is-quiet");
    convertButton.removeAttribute("aria-busy");
    convertLabel.textContent = "Convert to ZIP";
    convertSpinner.hidden = true;
    convertIcon.hidden = false;
    replaceButton.disabled = false;
    removeButton.disabled = false;

    stopProgressLoop();
    hideError();
    hideSuccess();
    if (statusStage) {
      statusStage.textContent = "Preparing…";
    }
  }

  /* Full reset, used when the user removes a file or starts over. */
  function clearSelection() {
    resetUiState();
    if (fileInput) {
      fileInput.value = "";
    }
  }

  /* --- Selection and validation ---------------------------------------- */

  function setChecking() {
    fileTypeEl.textContent = "MRPack archive";
    validationText.textContent = "Checking archive…";
    validationDot.className = "status-dot is-checking";
    fileWarning.hidden = true;
    fileWarning.textContent = "";
    fileSummary.textContent = "";
    convertButton.disabled = true;
  }

  /* A file handed over by a drop event is not in the file input yet. The
     conversion button calls downloadLocalButton(), which reads the input, so
     the dropped file is placed there as well. */
  function putFileInInput(file) {
    try {
      if (fileInput.files && fileInput.files.length === 1 && fileInput.files[0] === file) {
        return true;
      }
      var transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      return fileInput.files.length === 1;
    } catch (error) {
      return false;
    }
  }

  function selectFile(file) {
    if (!file) {
      return;
    }
    if (converting) {
      return;
    }

    resetUiState();

    // Extension check only rejects obvious mistakes; the archive itself is
    // still opened and its manifest validated below.
    if (!/\.mrpack$/i.test(file.name)) {
      clearSelection();
      showError({
        title: "That file type is not supported",
        message: "Choose a Modrinth modpack with the .mrpack extension. Renaming a different archive will not make it a valid MRPack.",
        detail: "Selected file: " + file.name
      });
      dropzone.hidden = false;
      return;
    }

    if (file.size === 0) {
      clearSelection();
      showError({
        title: "That file is empty",
        message: "The selected file has no contents, so there is no archive to convert.",
        detail: "Selected file: " + file.name
      });
      return;
    }

    if (!putFileInInput(file)) {
      clearSelection();
      showError({
        title: "This browser could not accept the dropped file",
        message: "Use the browse files button to select the pack instead. Keyboard and dialog selection work in every supported browser."
      });
      return;
    }

    selectedFile = file;
    dropzone.hidden = true;
    filebox.classList.add("is-visible");
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    setChecking();

    var token = ++inspectToken;
    var inspection;
    try {
      inspection = window.MRZ.inspect(file);
    } catch (error) {
      inspection = Promise.reject(error);
    }

    Promise.resolve(inspection).then(function (info) {
      if (token !== inspectToken || selectedFile !== file) {
        return;
      }

      selectedInfo = info;
      validationText.textContent = "Ready to convert";
      validationDot.className = "status-dot";

      var manifest = info.manifest;
      var packName = truncate(typeof manifest.name === "string" ? manifest.name : "", 70);
      var version = truncate(typeof manifest.versionId === "string" ? manifest.versionId : "", 28);
      var parts = [];

      if (packName) {
        parts.push(packName + (version ? " " + version : ""));
      }
      parts.push(info.fileCount + " referenced file" + (info.fileCount === 1 ? "" : "s"));
      if (info.overrides.overrides + info.overrides.clientOverrides > 0) {
        parts.push(
          (info.overrides.overrides + info.overrides.clientOverrides) +
          " override file" + (info.overrides.overrides + info.overrides.clientOverrides === 1 ? "" : "s")
        );
      }
      if (info.downloadBytes > 0) {
        parts.push(formatBytes(info.downloadBytes) + " to download");
      }

      fileSummary.textContent = parts.join(" · ");

      var notes = [];
      if (info.githubCount > 0) {
        notes.push(
          info.githubCount + " GitHub-hosted file" + (info.githubCount === 1 ? " will" : "s will") +
          " open in a new tab instead of being added to the ZIP"
        );
      }
      if (info.invalidCount + info.unsafeCount > 0) {
        notes.push(
          (info.invalidCount + info.unsafeCount) + " manifest entr" +
          (info.invalidCount + info.unsafeCount === 1 ? "y has" : "ies have") +
          " no usable download and will be skipped"
        );
      }

      if (notes.length) {
        fileWarning.textContent = notes.join(". ") + ".";
        fileWarning.hidden = false;
      }

      convertButton.disabled = false;
    }).catch(function (error) {
      if (token !== inspectToken) {
        return;
      }
      selectedInfo = null;
      validationText.textContent = "Not a valid MRPack";
      validationDot.className = "status-dot is-invalid";
      convertButton.disabled = true;
      showError({
        title: (error && error.title) || "That file is not a usable MRPack",
        message: (error && error.message) || "The archive could not be read.",
        detail: (error && error.detail) || (error && error.message) || ""
      });
    });
  }

  /* --- Drop zone -------------------------------------------------------- */

  function openPicker() {
    if (!converting) {
      fileInput.click();
    }
  }

  dropzone.addEventListener("click", function (event) {
    if (event.target.closest("#browse-button")) {
      return;
    }
    openPicker();
  });

  browseButton.addEventListener("click", function (event) {
    event.stopPropagation();
    openPicker();
  });

  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!converting) {
        dropzone.classList.add("is-dragover");
      }
    });
  });

  dropzone.addEventListener("dragleave", function (event) {
    event.preventDefault();
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove("is-dragover");
    }
  });

  dropzone.addEventListener("drop", function (event) {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("is-dragover");
    if (converting || !event.dataTransfer || !event.dataTransfer.files.length) {
      return;
    }
    selectFile(event.dataTransfer.files[0]);
  });

  // Dropping a file outside the zone should not navigate away from the page.
  ["dragover", "drop"].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") !== -1) {
        event.preventDefault();
      }
    });
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files.length) {
      selectFile(fileInput.files[0]);
    }
  });

  replaceButton.addEventListener("click", openPicker);
  removeButton.addEventListener("click", function () {
    clearSelection();
    browseButton.focus();
  });

  /* --- Conversion state ------------------------------------------------- */

  function startProgressLoop() {
    stopProgressLoop();
    var tick = function () {
      if (!converting) {
        return;
      }

      var max = progressEl.max || 0;
      var value = progressEl.value || 0;

      if (progressMode === "build") {
        progressCount.textContent = "Building archive";
        progressPercent.textContent = Math.round(Math.min(value, 100)) + "%";
      } else if (max > 1) {
        progressCount.textContent = formatBytes(value) + " of " + formatBytes(max);
        progressPercent.textContent = Math.round((value / max) * 100) + "%";
      } else {
        progressCount.textContent = "Downloading";
        progressPercent.textContent = "";
      }

      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
  }

  function stopProgressLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  window.mrzUI = {
    start: function () {
      converting = true;
      hideError();
      hideSuccess();
      progressMode = "download";
      progressEl.max = 100;
      progressEl.value = 0;
      statusTitle.textContent = "Reading archive";
      statusStage.textContent = "Opening the local .mrpack file";
      statusStage.hidden = false;
      progressCount.textContent = "";
      progressPercent.textContent = "";

      convertButton.disabled = true;
      convertButton.classList.remove("is-quiet");
      convertButton.classList.add("is-busy");
      convertButton.setAttribute("aria-busy", "true");
      convertLabel.textContent = "Converting…";
      convertSpinner.hidden = false;
      convertIcon.hidden = true;
      replaceButton.disabled = true;
      removeButton.disabled = true;

      startProgressLoop();
    },

    status: function (data) {
      progressMode = data.label === "Building ZIP archive" ? "build" : "download";
      statusTitle.textContent = data.label || "Converting pack";
      statusStage.textContent = data.detail || "";
      statusStage.hidden = !data.detail;
    },

    success: function (data) {
      converting = false;
      stopProgressLoop();
      lastResult = { blob: data.blob, filename: data.filename };

      convertButton.disabled = false;
      convertButton.classList.remove("is-busy");
      convertButton.classList.add("is-quiet");
      convertButton.removeAttribute("aria-busy");
      convertLabel.textContent = "Convert again";
      convertSpinner.hidden = true;
      convertIcon.hidden = false;
      replaceButton.disabled = false;
      removeButton.disabled = false;
      validationText.textContent = "Converted";

      hideError();
      hideSuccess();

      var warnings = data.warnings || {};
      var failed = warnings.failed || [];
      var github = warnings.github || [];
      var invalid = warnings.invalid || [];
      var unsafe = warnings.unsafe || [];
      var unsafeOverrides = warnings.overrides || [];
      var hasWarnings =
        failed.length > 0 || github.length > 0 || invalid.length > 0 ||
        unsafe.length > 0 || unsafeOverrides.length > 0 || data.autoSaveFailed;

      successTitle.textContent = hasWarnings ? "ZIP created with warnings" : "ZIP created";

      var overrideCount = (data.overrides.overrides || 0) + (data.overrides.clientOverrides || 0);
      var summary = "Added " + data.included + " downloaded file" + (data.included === 1 ? "" : "s");
      if (overrideCount > 0) {
        summary += " and " + overrideCount + " override file" + (overrideCount === 1 ? "" : "s");
      }
      summary += ".";
      if (!hasWarnings) {
        summary += " Everything the browser was allowed to retrieve is in the archive.";
      }
      successText.textContent = summary;
      successFile.textContent = data.filename + " · " + formatBytes(data.blob.size);

      function addWarning(text) {
        var item = document.createElement("li");
        item.innerHTML = WARNING_ICON;
        var label = document.createElement("span");
        label.textContent = text;
        item.appendChild(label);
        successWarnings.appendChild(item);
      }

      if (data.autoSaveFailed) {
        addWarning("The ZIP was built, but the browser blocked the automatic download. Use the Download ZIP button below.");
      }
      if (failed.length) {
        addWarning(
          failed.length + " manifest file" + (failed.length === 1 ? "" : "s") +
          " could not be downloaded and " + (failed.length === 1 ? "is" : "are") +
          " missing from this ZIP."
        );
      }
      if (github.length) {
        addWarning(
          github.length + " GitHub-hosted file" + (github.length === 1 ? " was" : "s were") +
          " opened in a new tab instead of being added. Move " +
          (github.length === 1 ? "it" : "them") + " into the matching folder in the ZIP." +
          (github.length > 1 ? " Allow pop-ups for this site if no tabs opened." : "")
        );
      }
      if (invalid.length) {
        addWarning(
          invalid.length + " manifest entr" + (invalid.length === 1 ? "y has" : "ies have") +
          " no usable download URL and " + (invalid.length === 1 ? "was" : "were") + " skipped."
        );
      }
      if (unsafe.length || unsafeOverrides.length) {
        addWarning(
          (unsafe.length + unsafeOverrides.length) + " file path" +
          (unsafe.length + unsafeOverrides.length === 1 ? " was" : "s were") +
          " unsafe (absolute or containing ..) and " +
          (unsafe.length + unsafeOverrides.length === 1 ? "was" : "were") + " skipped."
        );
      }

      if (failed.length) {
        var details = document.createElement("details");
        details.className = "result-details";
        var summaryEl = document.createElement("summary");
        summaryEl.textContent = "Failed downloads";
        var pre = document.createElement("pre");
        var lines = failed.slice(0, 30).map(function (failure) {
          return failure.path + "\n  " + failure.url + "\n  " + failure.reason;
        });
        if (failed.length > 30) {
          lines.push("… and " + (failed.length - 30) + " more");
        }
        pre.textContent = lines.join("\n\n");
        details.appendChild(summaryEl);
        details.appendChild(pre);
        successPanel.appendChild(details);
      }

      successPanel.classList.add("is-visible");
      window.setTimeout(function () {
        successTitle.focus({ preventScroll: true });
      }, 30);
    },

    error: function (data) {
      converting = false;
      stopProgressLoop();
      convertButton.classList.remove("is-busy", "is-quiet");
      convertButton.removeAttribute("aria-busy");
      convertButton.disabled = !selectedInfo;
      convertLabel.textContent = "Convert to ZIP";
      convertSpinner.hidden = true;
      convertIcon.hidden = false;
      if (selectedInfo) {
        validationText.textContent = "Ready to convert";
        validationDot.className = "status-dot";
      }
      replaceButton.disabled = false;
      removeButton.disabled = false;
      hideSuccess();
      showError(data);
    }
  };

  downloadButton.addEventListener("click", function () {
    if (lastResult && lastResult.blob && window.saveAs) {
      window.saveAs(lastResult.blob, lastResult.filename);
    }
  });

  convertAnotherButton.addEventListener("click", function () {
    clearSelection();
    browseButton.focus();
  });
})();
