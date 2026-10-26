/** Settle one inventory without waiting for unrelated integration providers. */
export async function settleIntegrationRead<T>(
  read: () => Promise<T>,
  callbacks: {
    isCurrent: () => boolean
    onValue: (value: T) => void
    onError: (error: unknown) => void
    onFinished: () => void
  }
): Promise<void> {
  try {
    const value = await read()
    if (callbacks.isCurrent()) callbacks.onValue(value)
  } catch (error) {
    if (callbacks.isCurrent()) callbacks.onError(error)
  } finally {
    if (callbacks.isCurrent()) callbacks.onFinished()
  }
}
