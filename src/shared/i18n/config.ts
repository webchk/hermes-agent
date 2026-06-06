import type { AppLocale } from "./types";

export const SOURCE_LOCALE: AppLocale = "en";
export const FALLBACK_LOCALE: AppLocale = "en";
// Souza/JS: pt-BR é o idioma padrão neste fork. Quando desktop.json não
// existe ou está corrompido, o app abre em português em vez de inglês.
// O valor escolhido pelo usuário (Settings → Language) sempre vence quando
// presente em ~/.hermes/desktop.json.
export const DEFAULT_ACTIVE_LOCALE: AppLocale = "pt-BR";
export const APP_LOCALES: AppLocale[] = [
  "en",
  "es",
  "id",
  "ja",
  "pt-BR",
  "pt-PT",
  "zh-CN",
  "zh-TW",
];
