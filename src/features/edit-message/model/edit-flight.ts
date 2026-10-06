let generation = 0
const controllers = new Set<AbortController>()

export function currentEditGeneration(): number {
  return generation
}

export function invalidateEditFlights(): void {
  generation += 1
  for (const controller of controllers) {
    controller.abort()
  }
  controllers.clear()
}

export function bindEditFlight(controller: AbortController): void {
  controllers.add(controller)
}

export function unbindEditFlight(controller: AbortController): void {
  controllers.delete(controller)
}
