/**
 * 有界队列，容量满时自动丢弃最旧元素并计数丢弃次数。
 */
export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private readonly capacity: number;
  private _dropped = 0;
  private warnCounter = 0;

  constructor(capacity = 64) {
    this.capacity = capacity;
  }

  /** 入队：满则 shift 并递增 droppedCount，每累计 16 次 warn 一条日志 */
  push(item: T): void {
    if (this.items.length >= this.capacity) {
      this.items.shift();
      this._dropped++;
      this.warnCounter++;
      if (this.warnCounter % 16 === 0) {
        console.warn(
          `[BoundedQueue] 已丢弃 ${this._dropped} 条元素（容量 ${this.capacity}）`,
        );
      }
    }
    this.items.push(item);
  }

  /** 取出所有元素并清空 */
  drain(): T[] {
    const result = [...this.items];
    this.items.length = 0;
    return result;
  }

  /** 当前元素个数 */
  get size(): number {
    return this.items.length;
  }

  /** 累计丢弃次数 */
  get dropped(): number {
    return this._dropped;
  }
}
