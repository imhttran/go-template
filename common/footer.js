// Reusable page footer for the static pages. Put a
// <footer id="page-footer" class="page-footer"> in the HTML, then call
// renderPageFooter — the optional meta (e.g. role · email verified) renders on
// the left, and the app version sits on the right.
export const VERSION = "0.0.1";

export function renderPageFooter(footer, meta = "") {
  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.innerHTML = meta; // HTML so callers can highlight parts of it
    footer.appendChild(metaEl);
  }

  const version = document.createElement("span");
  version.className = "footer-version";
  version.textContent = `v${VERSION}`;
  footer.appendChild(version);
  return footer;
}
