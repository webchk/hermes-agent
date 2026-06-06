export function filterSystemContent(content: string): string {
  if (!content) return "";
  let filtered = content;

  // Remove bloco [IMPORTANT: ...] no início (cron job prefix).
  // Usa match greedy para saltar colchetes aninhados (ex: "[SILENT]" dentro do bloco).
  filtered = filtered.replace(/^\[IMPORTANT:[\s\S]*\]\s*\n*/m, "");

  // Suprime resposta [SILENT] como conteúdo único
  if (filtered.trim() === "[SILENT]") return "";

  return filtered.trim();
}
