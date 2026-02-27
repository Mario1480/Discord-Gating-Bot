export const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[INFO] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: unknown) => console.warn(`[WARN] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta ?? ""),
  debug: (msg: string, meta?: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[DEBUG] ${msg}`, meta ?? "");
    }
  }
};
