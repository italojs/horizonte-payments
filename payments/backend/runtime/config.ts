export function env(name: string) {
  const value = process.env[name];
  if (!value) throw Error('Missing ' + name);
  return value;
}
