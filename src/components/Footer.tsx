"use client";

import { useLang } from "./i18n";

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="shrink-0 border-t border-gray-200 bg-white px-4 py-2 text-center text-xs text-gray-700">
      <strong>{t.footer.notOfficial}</strong> {t.footer.emergency}{" "}
      <a href="tel:112" className="font-semibold text-red-700 underline">
        112
      </a>
      . {t.footer.check}{" "}
      <a href="/privacy" className="ml-1 text-gray-500 underline">
        {t.footer.privacy}
      </a>
    </footer>
  );
}
