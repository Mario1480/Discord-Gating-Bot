export function safeNumber(input: unknown, fallback = 0): number {
  const n = typeof input === "string" ? Number.parseFloat(input) : Number(input);
  return Number.isFinite(n) ? n : fallback;
}
