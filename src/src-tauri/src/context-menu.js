// Install before page scripts, including on the startup and service error pages.
(() => {
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void window.__TAURI_INTERNALS__
        .invoke("show_context_menu")
        .catch(() => {});
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();
      if (
        key === "f12" ||
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
        (event.metaKey && event.altKey && ["i", "j", "c"].includes(key))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
})();
