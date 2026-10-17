/*
 * MRPack to ZIP — colour theme
 * Interface by MrDefault.
 *
 * The visitor's choice is remembered in localStorage under one key. A visitor
 * who has never chosen follows the operating system, which is the default.
 * The resolved theme is written to <html data-theme="light|dark"> and the
 * preference to <html data-theme-preference="system|light|dark"> before the
 * first paint, so there is no flash of the wrong theme.
 *
 * This file is loaded synchronously in <head> on purpose.
 */

(function () {
  "use strict";

  var STORAGE_KEY = "mrz-theme";
  var CHOICES = ["system", "light", "dark"];
  var LABELS = { system: "System", light: "Light", dark: "Dark" };
  var THEME_COLORS = { light: "#f6f4ef", dark: "#121310" };

  var root = document.documentElement;
  var lightQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var preference = readPreference();

  function readPreference() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      return CHOICES.indexOf(saved) !== -1 ? saved : "system";
    } catch (error) {
      // Storage can be unavailable or blocked; the default still applies.
      return "system";
    }
  }

  function savePreference(value) {
    try {
      if (value === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, value);
      }
    } catch (error) {
      // The choice simply will not be remembered on the next visit.
    }
  }

  function resolveTheme(value) {
    if (value === "light" || value === "dark") {
      return value;
    }
    return lightQuery && lightQuery.matches ? "light" : "dark";
  }

  function apply(value) {
    var theme = resolveTheme(value);
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-preference", value);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[theme]);
    }

    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      var next = CHOICES[(CHOICES.indexOf(value) + 1) % CHOICES.length];
      toggle.setAttribute("title", "Colour theme: " + LABELS[value]);
      toggle.setAttribute(
        "aria-label",
        "Colour theme: " + LABELS[value] + " (activate to use " + LABELS[next].toLowerCase() + ")"
      );
    }
  }

  apply(preference);

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  onReady(function () {
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        preference = CHOICES[(CHOICES.indexOf(preference) + 1) % CHOICES.length];
        savePreference(preference);
        apply(preference);
      });
    }

    // Follow the system only while the visitor has not chosen a theme.
    if (lightQuery) {
      var onSystemChange = function () {
        if (preference === "system") {
          apply(preference);
        }
      };
      if (lightQuery.addEventListener) {
        lightQuery.addEventListener("change", onSystemChange);
      } else if (lightQuery.addListener) {
        lightQuery.addListener(onSystemChange);
      }
    }

    // The button exists now, so its label can be filled in.
    apply(preference);
  });
})();
