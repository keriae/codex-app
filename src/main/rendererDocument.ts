/** IPC listener readiness belongs to one document, even when its native window survives reload. */
export class RendererDocumentTracker<T extends object> {
  private readonly generations = new WeakMap<T, number>()

  generation(window: T): number { return this.generations.get(window) ?? 0 }

  invalidate(window: T): void { this.generations.set(window, this.generation(window) + 1) }

  assertCurrent(window: T, generation: unknown): void {
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0 ||
        generation !== this.generation(window)) throw new Error('IPC readiness belongs to an expired renderer document')
  }
}
