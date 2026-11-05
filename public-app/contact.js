(() => {
  'use strict';
  const dialog = document.getElementById('authorContactDialog');
  const poster = document.getElementById('authorPoster');
  const pane = document.getElementById('authorPosterPane');
  const zoomButton = document.getElementById('zoomAuthorContact');
  let zoomed = false;
  function reset() {
    zoomed = false;
    poster.style.width = '100%';
    pane.scrollTo(0, 0);
    zoomButton.disabled = false;
  }
  document.getElementById('openAuthorContact').addEventListener('click', () => {
    reset();
    dialog.showModal();
  });
  document.getElementById('closeAuthorContact').addEventListener('click', () => dialog.close());
  document.getElementById('resetAuthorContact').addEventListener('click', reset);
  zoomButton.addEventListener('click', async () => {
    try {
      await poster.decode();
      zoomed = true;
      poster.style.width = `${Math.max(poster.naturalWidth, pane.clientWidth * 2)}px`;
      zoomButton.disabled = true;
      pane.focus();
    } catch { document.getElementById('authorCopyStatus').textContent = '图片未能加载，请重新打开应用'; }
  });
  window.addEventListener('resize', () => { if (dialog.open && !zoomed) reset(); });
  document.querySelectorAll('[data-copy-author]').forEach(button => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyAuthor;
      const status = document.getElementById('authorCopyStatus');
      try {
        try {
          if (!navigator.clipboard?.writeText) throw Error('No clipboard API');
          await navigator.clipboard.writeText(value);
        } catch {
          const field = document.createElement('textarea');
          field.value = value;
          field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px';
          document.body.append(field);
          field.focus(); field.select();
          try { if (!document.execCommand('copy')) throw Error('Copy failed'); }
          finally { field.remove(); button.focus(); }
        }
        status.textContent = `已复制：${value}`;
      } catch { status.textContent = `未能自动复制，可长按账号文字复制：${value}`; }
    });
  });
})();
