export function createSubmitGate() {
  let pending = false

  return {
    get pending() {
      return pending
    },
    tryEnter() {
      if (pending) {
        return false
      }

      pending = true
      return true
    },
    leave() {
      pending = false
    },
  }
}
