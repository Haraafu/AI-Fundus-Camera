(() => {
  const root = document.documentElement;
  const button = document.querySelector('#theme-toggle');
  const label = document.querySelector('#theme-label');
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const savedTheme = () => {
    try { return localStorage.getItem('luxora-theme'); } catch { return null; }
  };
  const apply = theme => {
    const dark = theme === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    label.textContent = dark ? 'Light mode' : 'Dark mode';
  };
  const sync = () => {
    const saved = savedTheme();
    apply(saved === 'dark' || saved === 'light' ? saved : preference.matches ? 'dark' : 'light');
  };
  sync();
  button.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(theme);
    try { localStorage.setItem('luxora-theme', theme); } catch {}
  });
  preference.addEventListener('change', () => {
    if (!['dark', 'light'].includes(savedTheme())) sync();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'luxora-theme' || event.key === null) sync();
  });
})();
