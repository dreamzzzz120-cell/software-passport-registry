export type ReadinessDependency = { name: string; ok: boolean; detail?: string };

export function evaluateReadiness(dependencies: ReadinessDependency[]): { ready: boolean; failures: string[] } {
  const failures = dependencies.filter((d) => !d.ok).map((d) => d.name);
  return { ready: failures.length === 0, failures };
}

export function sanitizeReadiness(dependencies: ReadinessDependency[]) {
  return dependencies.map(({ name, ok }) => ({ name, ok }));
}
