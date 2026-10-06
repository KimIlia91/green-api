export function createSubmitGate() {
  let pending = false

  return {
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
