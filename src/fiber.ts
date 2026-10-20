/**
 * Fiber 数据结构与通用遍历工具。
 *
 * 设计取自 React 的 FiberNode：每个节点既是一棵"树"（child / parent），
 * 又是一条"链表"（sibling），因此 render 阶段可以用一个游标
 * （nextUnitOfWork）顺序遍历整棵树，随时暂停、恢复。
 */

export type EffectTag = 'placement' | 'update' | null;

/** 一个 Hook 的存储单元，等价于 React 的 hook.memoizedState + hook.queue */
export interface Hook {
  /** 当前状态值 */
  state: unknown;
  /** 待应用的更新队列（setState 入队，下一次渲染时一次性消费） */
  queue: unknown[];
  /** useEffect / useMemo 的依赖数组 */
  deps?: unknown[];
  /** useEffect 的回调 */
  effect?: () => void | (() => void);
  /** 本轮是否需要执行 effect */
  effectTag?: 'create' | 'update';
  /** effect 返回的清理函数 */
  cleanup?: (() => void) | null;
}

export interface Fiber {
  /** '#text' 表示文本节点，'root' 表示根，函数表示函数组件 */
  type: string | ((props: Record<string, unknown>) => unknown) | null;
  key: string | null;
  props: Record<string, unknown> & { children?: unknown };
  dom: HTMLElement | Text | null;
  /** React 源码里叫 return */
  parent: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  /** 双缓存：指向另一棵树上的对应节点 */
  alternate: Fiber | null;
  effectTag: EffectTag;
  hooks: Hook[] | null;
}

/**
 * 收集某个 fiber 之下的"宿主子节点"（真正对应 DOM 的 fiber）。
 * 函数组件自身没有 DOM，需要向下穿透，因此直接递归穿透无 dom 的节点。
 *
 * 提交阶段靠这个函数拿到"这一层 DOM 应该有哪些 child、顺序如何"，
 * 对应 React commit 阶段遍历 effect list 时对 host 节点的处理。
 */
export function collectHostChildren(fiber: Fiber): Fiber[] {
  const result: Fiber[] = [];
  const walk = (node: Fiber): void => {
    for (let child = node.child; child; child = child.sibling) {
      if (child.dom) result.push(child);
      else walk(child);
    }
  };
  walk(fiber);
  return result;
}

/** 把 fiber 的子节点链表转成数组 */
export function collectSiblings(firstChild: Fiber | null): Fiber[] {
  const result: Fiber[] = [];
  for (let node = firstChild; node; node = node.sibling) result.push(node);
  return result;
}
