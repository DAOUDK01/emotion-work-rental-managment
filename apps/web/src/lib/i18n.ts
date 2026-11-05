import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * EN/FI UI. Each page owns its namespace file:
 *   src/locales/<lang>/<namespace>.json  ->  useTranslation('<namespace>')
 * Files are auto-discovered, so adding a page never edits shared code.
 */
const files = import.meta.glob('../locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(files)) {
  const match = /\/locales\/([a-z]{2})\/([\w-]+)\.json$/.exec(path);
  if (!match) continue;
  const [, lang, ns] = match;
  resources[lang] ??= {};
  resources[lang][ns] = mod.default;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('emf.lang') ?? 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.en ?? { common: {} }),
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('emf.lang', lng);
    document.documentElement.lang = lng;
  } catch {
    /* storage may be unavailable */
  }
});

export default i18n;
