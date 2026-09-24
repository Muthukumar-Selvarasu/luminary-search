/**
 * In-flight asks. The ingest worker shares this process and the Atlas cluster,
 * so it waits while an answer is being served. That keeps search latency during
 * a large PDF ingest inside the idle envelope.
 */
let active = 0;

export function beginInteractive(): void {
  active += 1;
}

export function endInteractive(): void {
  active = Math.max(0, active - 1);
}

export function interactiveInFlight(): boolean {
  return active > 0;
}

export async function waitUntilInteractiveQuiet(maxMs = 260_000): Promise<void> {
  const start = Date.now();
  while (interactiveInFlight() && Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
