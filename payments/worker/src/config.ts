export function positiveEnv(key: string, fallback: number) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid ' + key);
  return value;
}
