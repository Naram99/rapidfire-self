/** Synchronous state work is serialized; external I/O never holds this queue. */
export class StateQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(task: () => T): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  idle(): Promise<void> {
    return this.tail;
  }
}
