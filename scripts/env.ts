export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}
