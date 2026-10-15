/** The worker count Automatic picks: one per CPU core, at most eight. */
export function automaticWorkerPoolSize(cpuCount: number): number {
  return Math.min(8, Math.max(1, cpuCount));
}
