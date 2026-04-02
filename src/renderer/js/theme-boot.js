/**
 * Runs in <head> before first paint to set data-theme and avoid flash.
 * Storage key must match THEME_PREF_KEY in constants.js.
 */
(function () {
  try {
    var pref = localStorage.getItem('quill-theme-pref') || 'system';
    var dark =
      pref === 'dark' ||
      (pref !== 'light' &&
        typeof matchMedia !== 'undefined' &&
        matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
