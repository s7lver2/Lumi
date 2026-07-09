// apps/web/app/lib/draw-history.ts
export class DrawHistory<T> {
  private stack: T[] = [];
  private index = -1;
  push(state: T): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    this.index = this.stack.length - 1;
  }
  undo(): T | null { if (this.index <= 0) return null; this.index--; return this.stack[this.index]; }
  redo(): T | null { if (this.index >= this.stack.length - 1) return null; this.index++; return this.stack[this.index]; }
  current(): T | null { return this.index >= 0 ? this.stack[this.index] : null; }
}