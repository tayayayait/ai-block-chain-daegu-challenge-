export const shortHash = (hash: string) =>
  hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
