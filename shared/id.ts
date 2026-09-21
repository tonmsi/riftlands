/** Web Crypto is available in both the browser and the supported Node runtime. */
export const randomUUID = (): string => globalThis.crypto.randomUUID();
