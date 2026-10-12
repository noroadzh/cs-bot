/**
 * Result 类型（单参数构造，兼容 JS）
 */
export class Err<E = unknown> {
  readonly ok = false as const;
  constructor(readonly error: E) {}
}

export class Ok<T> {
  readonly ok = true as const;
  constructor(readonly value: T) {}
}

export type Result<T, E = unknown> = Ok<T> | Err<E>;
