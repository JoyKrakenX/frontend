/** @format */

(() => {
  const root = document.body;
  const targetPage = String(root?.dataset?.redirectTarget || 'browse-surveys.html').trim();
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || params.get('Id');
  const target = id
    ? `${targetPage}?id=${encodeURIComponent(id)}`
    : 'browse-surveys.html';

  window.location.replace(target);
})();
