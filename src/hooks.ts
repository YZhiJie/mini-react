import type { Fiber, Hook } from './fiber';
import { scheduleUpdate } from './render';
import { state } from './state';

/**
 * Hooks 实现。
 *
 * React 的 Hooks 本质是"挂在 fiber 上的一条链表"，靠调用顺序定位：
 * 第 N 次渲染时第 i 个 Hook 一定能对上上一次渲染的第 i 个 Hook。
 * 本实现用数组 + 游标（state.hookIndex）表达同一件事，更直白。
 */

function currentFiber(): Fiber {
  const fiber = state.wipFiber;
  if (!fiber) throw new Error('Hook 只能在函数组件渲染期间调用');
  return fiber;
}

function oldHookAt(fiber: Fiber, index: number): Hook | undefined {
  return fiber.alternate?.hooks?.[index];
}

function depsChanged(oldHook: Hook | undefined, deps?: unknown[]): boolean {
  if (!oldHook) return true;
  if (!deps) return true; // 不传依赖数组 => 每次渲染都重新执行
  if (!oldHook.deps) return true;
  if (deps.length !== oldHook.deps.length) return true;
  return deps.some((value, index) => !Object.is(value, oldHook.deps?.[index]));
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const fiber = currentFiber();
  const index = state.hookIndex;
  const oldHook = oldHookAt(fiber, index);

  const hook: Hook = {
    state: oldHook ? oldHook.state : typeof initial === 'function' ? (initial as () => T)() : initial,
    queue: [],
  };

  // 消费上一轮渲染之后累积的更新队列：
  // 同一个事件里连续调用 3 次 setState，最终只触发一次渲染，且状态一次性推进到位
  for (const update of oldHook?.queue ?? []) {
    hook.state = typeof update === 'function' ? (update as (prev: T) => T)(hook.state as T) : (update as T);
  }

  const setState = (next: T | ((prev: T) => T)): void => {
    // 入队到"本轮渲染产出的 hook"上 —— 提交之后它就是 current fiber 的 hook，
    // 下一次渲染时会被当作 oldHook 读取（这就是闭包陷阱能成立的原因）
    hook.queue.push(next);
    scheduleUpdate();
  };

  fiber.hooks?.push(hook);
  state.hookIndex += 1;
  return [hook.state as T, setState];
}

export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  const fiber = currentFiber();
  const index = state.hookIndex;
  const oldHook = oldHookAt(fiber, index);

  const hook: Hook = {
    state: undefined,
    queue: [],
    deps,
    effect,
    // 把上一次的清理函数带到新 hook 上，这样"依赖变化时先清理"与"卸载时清理"都是同一份
    cleanup: oldHook?.cleanup ?? null,
  };

  if (depsChanged(oldHook, deps)) hook.effectTag = oldHook?.cleanup ? 'update' : 'create';

  fiber.hooks?.push(hook);
  state.hookIndex += 1;
}

export function useRef<T>(initial: T): { current: T } {
  const fiber = currentFiber();
  const index = state.hookIndex;
  const oldHook = oldHookAt(fiber, index);

  // ref 的关键是"跨渲染保持同一个对象引用"
  const hook: Hook = {
    state: oldHook ? oldHook.state : { current: initial },
    queue: [],
  };

  fiber.hooks?.push(hook);
  state.hookIndex += 1;
  return hook.state as { current: T };
}

export function useMemo<T>(factory: () => T, deps?: unknown[]): T {
  const fiber = currentFiber();
  const index = state.hookIndex;
  const oldHook = oldHookAt(fiber, index);
  const changed = depsChanged(oldHook, deps);

  const hook: Hook = {
    state: !oldHook || changed ? factory() : oldHook.state,
    queue: [],
    deps,
  };

  fiber.hooks?.push(hook);
  state.hookIndex += 1;
  return hook.state as T;
}
