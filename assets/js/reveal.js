/*
 * MRPack to ZIP — scroll reveals
 * Interface by MrDefault.
 *
 * Marks <html> as "js", which lets the stylesheet hide [data-reveal] elements
 * until they enter the viewport. An IntersectionObserver then reveals them.
 *
 * Fallbacks:
 *   - No JavaScript: the class is never set, so nothing is hidden.
 *   - prefers-reduced-motion: every element is shown immediately.
 *   - No IntersectionObserver: every element is shown immediately.
 */

(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  function allRevealTargets() {
    return document.querySelectorAll("[data-reveal]");
  }

  function showAll() {
    var nodes = allRevealTargets();
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.add("is-in");
    }
  }

  function observe() {
    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            // Each element animates once; leaving the viewport does not reset it.
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    var nodes = allRevealTargets();
    for (var i = 0; i < nodes.length; i++) {
      observer.observe(nodes[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observe);
  } else {
    observe();
  }
})();
