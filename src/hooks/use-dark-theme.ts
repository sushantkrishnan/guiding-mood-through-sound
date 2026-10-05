import { useEffect, useState } from 'react';
import { useSSR } from './use-ssr';

const themeMatch = '(prefers-color-scheme: dark)';

export function useDarkTheme() {
  const { isBrowser } = useSSR();
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(false);

  useEffect(() => {
    if (!isBrowser) return;

    const themeMediaQuery = window.matchMedia(themeMatch);

    function syncTheme() {
      const selectedTheme = document.documentElement.dataset.theme;
      setIsDarkTheme(
        selectedTheme ? selectedTheme === 'dark' : themeMediaQuery.matches,
      );
    }

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributeFilter: ['data-theme'],
      attributes: true,
    });

    themeMediaQuery.addEventListener('change', syncTheme);
    syncTheme();

    return () => {
      observer.disconnect();
      themeMediaQuery.removeEventListener('change', syncTheme);
    };
  }, [isBrowser]);

  return isDarkTheme;
}
