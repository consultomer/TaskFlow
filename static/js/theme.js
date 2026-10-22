// Light/dark theme. Loaded in <head> so the theme is set before first paint.
// Uses the saved choice, otherwise follows the OS setting.
(function () {
    const STORAGE_KEY = 'taskflow-theme';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let chosen = null; // this page view's choice, in case storage is blocked

    function savedTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function currentTheme() {
        return chosen || savedTheme() || (media.matches ? 'dark' : 'light');
    }

    function apply(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
            const next = theme === 'dark' ? 'light' : 'dark';
            btn.innerHTML = `<i class="ti ti-${theme === 'dark' ? 'sun' : 'moon'}"></i>`;
            btn.title = `Switch to ${next} mode`;
            btn.setAttribute('aria-label', btn.title);
        });
    }

    apply(currentTheme());

    media.addEventListener('change', () => {
        if (!chosen && !savedTheme()) apply(currentTheme());
    });

    document.addEventListener('DOMContentLoaded', () => {
        apply(currentTheme());
        document.addEventListener('click', e => {
            if (!e.target.closest('[data-theme-toggle]')) return;
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            chosen = next;
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                // Storage blocked: still switch for this page view
            }
            apply(next);
        });
    });
})();
