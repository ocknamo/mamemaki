/** LocalStorage access that degrades to a no-op where unavailable. */
export const storage = {
  get(key: string): string {
    try {
      return globalThis.localStorage?.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode などで保存できなくても動作は継続する */
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
