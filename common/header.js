// Reusable page header for the static pages. Put a
// <header id="page-header" class="page-header"> in the HTML, keep any actions
// (e.g. a logout link) inside it, then call renderPageHeader — the title and
// optional subtitle render on the left, and the existing actions stay right.
export function renderPageHeader(header, title, subtitle = "") {
  const block = document.createElement("div");

  const h1 = document.createElement("h1");
  h1.textContent = title;
  block.appendChild(h1);

  if (subtitle) {
    const p = document.createElement("p");
    p.innerHTML = subtitle; // HTML so callers can highlight parts of it
    block.appendChild(p);
  }

  header.prepend(block);
  return block;
}
