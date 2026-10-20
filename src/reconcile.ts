import { collectSiblings } from './fiber';
import type { Fiber } from './fiber';
import { state } from './state';

export interface ElementLike {
  type: string | ((props: Record<string, unknown>) => unknown);
  key: string | null;
  props: Record<string, unknown> & { children?: unknown };
}

export type Child = ElementLike | string | number | boolean | null | undefined | Child[];

/** 把 children 拍平：过滤 null / undefined / boolean，展开嵌套数组 */
export function flattenChildren(input: unknown, out: Child[] = []): Child[] {
  if (input === null || input === undefined || typeof input === 'boolean') return out;
  if (Array.isArray(input)) {
    for (const item of input) flattenChildren(item, out);
    return out;
  }
  out.push(input as Child);
  return out;
}

function toElement(child: Child): ElementLike {
  if (typeof child === 'string' || typeof child === 'number') {
    return { type: '#text', key: null, props: { nodeValue: String(child) } };
  }
  return child as ElementLike;
}

/**
 * Diff（React 源码里叫 childReconciler / reconcileChildFibers）。
 *
 * 本实现采用简化策略：
 * 1. 有 key 的子节点按 key 匹配旧 fiber —— 可以跨位置复用同一个 DOM 节点；
 * 2. 无 key 的子节点按"同类型、未被占用"就近匹配
 *    （真 React 走的是索引遍历 + 尾指针的双端对比，能在 O(n) 内完成同样的匹配）；
 * 3. 没被匹配上的旧 fiber 统一进入 deletions，提交阶段集中卸载；
 * 4. 位置移动不在这里打标记，而是由提交阶段按新顺序重排 DOM（见 render.ts 的 orderChildren）。
 */
export function reconcileChildren(wipFiber: Fiber, rawChildren: unknown): void {
  const newChildren = flattenChildren(rawChildren).map(toElement);
  const oldFibers = collectSiblings(wipFiber.alternate?.child ?? null);

  const matched = new Set<Fiber>();
  const oldByKey = new Map<string, Fiber[]>();
  const oldUnkeyed: Fiber[] = [];
  for (const oldFiber of oldFibers) {
    if (oldFiber.key !== null) {
      const list = oldByKey.get(oldFiber.key) ?? [];
      list.push(oldFiber);
      oldByKey.set(oldFiber.key, list);
    } else {
      oldUnkeyed.push(oldFiber);
    }
  }

  let prevSibling: Fiber | null = null;
  newChildren.forEach((element, index) => {
    let reused: Fiber | null = null;
    if (element.key !== null) {
      const list = oldByKey.get(element.key);
      if (list && list.length > 0) reused = list.shift() as Fiber;
    } else {
      reused = oldUnkeyed.find((candidate) => !matched.has(candidate) && candidate.type === element.type) ?? null;
    }

    let fiber: Fiber;
    if (reused && reused.type === element.type) {
      matched.add(reused);
      // 复用旧节点：DOM 与 alternate 都继承，提交阶段只需更新属性
      fiber = {
        type: element.type,
        key: element.key,
        props: element.props,
        dom: reused.dom,
        parent: wipFiber,
        child: null,
        sibling: null,
        alternate: reused,
        effectTag: 'update',
        hooks: null,
      };
    } else {
      // 同 key 但类型变了（例如 div → span）：旧节点作废进删除队列，新节点从头创建
      if (reused) state.deletions.push(reused);
      fiber = {
        type: element.type,
        key: element.key,
        props: element.props,
        dom: null,
        parent: wipFiber,
        child: null,
        sibling: null,
        alternate: null,
        effectTag: 'placement',
        hooks: null,
      };
    }

    if (index === 0) wipFiber.child = fiber;
    else (prevSibling as Fiber).sibling = fiber;
    prevSibling = fiber;
  });

  for (const oldFiber of oldFibers) {
    if (!matched.has(oldFiber)) state.deletions.push(oldFiber);
  }
}
