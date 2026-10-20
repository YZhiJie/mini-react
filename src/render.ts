import { createDom, installEventDelegation, setProps } from './dom';
import { collectHostChildren } from './fiber';
import type { Fiber } from './fiber';
import { reconcileChildren } from './reconcile';
import type { ElementLike } from './reconcile';
import { scheduleHostCallback } from './scheduler';
import { state } from './state';

/**
 * 渲染主流程（对应 React 的 ReactFiberWorkLoop）：
 *
 *   createElement  →  render()：render 阶段（可中断，产出 fiber 树）
 *                                    ↓
 *                             commit 阶段（一次性提交 DOM 变更）
 *                                    ↓
 *                             flushEffects（passive effect）
 */

export function createElement(
  type: ElementLike['type'],
  config?: Record<string, unknown> | null,
  ...children: unknown[]
): ElementLike {
  const props: Record<string, unknown> = {};
  let key: string | null = null;
  if (config) {
    for (const name of Object.keys(config)) {
      if (name === 'key') {
        key = config[name] == null ? null : String(config[name]);
        continue;
      }
      props[name] = config[name];
    }
  }
  props.children = children;
  return { type, key, props };
}

/** h 是 createElement 的短别名，方便在示例与测试里书写虚拟 DOM */
export const h = createElement;

/** 每帧可用于渲染的时间预算（ms），超出就让出主线程 */
const FRAME_BUDGET_MS = 5;

function createRootFiber(container: HTMLElement, alternate: Fiber | null): Fiber {
  return {
    type: 'root',
    key: null,
    props: { children: [] },
    dom: container,
    parent: null,
    child: null,
    sibling: null,
    alternate,
    effectTag: alternate ? 'update' : 'placement',
    hooks: null,
  };
}

function updateHostComponent(fiber: Fiber): void {
  // 只在首次创建 DOM；更新时沿用 alternate 上的旧节点（双缓存复用）
  if (!fiber.dom) fiber.dom = createDom(fiber);
  if (fiber.type === '#text') return;
  reconcileChildren(fiber, fiber.props.children);
}

function updateFunctionComponent(fiber: Fiber): void {
  // 进入函数组件：切换 Hook 上下文（相当于 React 的 renderWithHooks）
  state.wipFiber = fiber;
  state.hookIndex = 0;
  fiber.hooks = [];
  const output = (fiber.type as (props: Record<string, unknown>) => unknown)(fiber.props);
  reconcileChildren(fiber, [output]);
}

/** 处理一个工作单元，并把 nextUnitOfWork 指向下一个（这里是"中序遍历"的简化版） */
function performUnitOfWork(fiber: Fiber): void {
  if (typeof fiber.type === 'function') updateFunctionComponent(fiber);
  else updateHostComponent(fiber);

  if (fiber.child) {
    state.nextUnitOfWork = fiber.child;
    return;
  }
  let node: Fiber | null = fiber;
  while (node) {
    if (node.sibling) {
      state.nextUnitOfWork = node.sibling;
      return;
    }
    node = node.parent;
  }
  state.nextUnitOfWork = null;
}

/**
 * 让某个 DOM 节点下的宿主子节点按"新 fiber 顺序"就位。
 *
 * 用一个指针 nextExisting 沿现有 DOM 走：如果当前 fiber 的 DOM 不是指针所指节点，
 * 就把它插到指针前面；指针随后推进到该节点的下一个兄弟。
 * 这样新增、删除、重排三种情况统一处理，无需在 diff 阶段单独标记 move。
 */
function orderChildren(parentDom: HTMLElement, hostChildren: Fiber[]): void {
  let nextExisting = parentDom.firstChild;
  for (const child of hostChildren) {
    const dom = child.dom as ChildNode;
    if (dom !== nextExisting) parentDom.insertBefore(dom, nextExisting);
    nextExisting = dom.nextSibling;
  }
}

/** 卸载整棵子树：先跑 effect 清理，再摘掉 DOM（对应 React 的 commitDeletionEffects） */
function unmountFiber(fiber: Fiber): void {
  if (fiber.hooks) {
    for (const hook of fiber.hooks) {
      hook.cleanup?.();
      hook.cleanup = null;
    }
  }
  for (let child = fiber.child; child; child = child.sibling) unmountFiber(child);
}

function commitDeletion(fiber: Fiber): void {
  unmountFiber(fiber);
  if (fiber.dom) {
    fiber.dom.parentNode?.removeChild(fiber.dom);
    return;
  }
  // 函数组件没有 DOM，需要继续向下找到真正挂着的宿主节点
  for (const hostChild of collectHostChildren(fiber)) commitDeletion(hostChild);
}

/** 提交阶段：自顶向下修正属性、重排顺序（对应 commitMutationEffects） */
function commitWork(fiber: Fiber | null): void {
  if (!fiber) return;

  const isHost = typeof fiber.type === 'string' && fiber.type !== 'root';
  if (isHost && fiber.dom) {
    if (fiber.type === '#text') {
      if (fiber.alternate) (fiber.dom as Text).nodeValue = String(fiber.props.nodeValue ?? '');
    } else {
      if (fiber.alternate) setProps(fiber.dom as HTMLElement, fiber.props, fiber.alternate.props);
      // 事件委托靠 DOM 上的 __fiber 反查 handler，更新时必须指向最新的 fiber
      (fiber.dom as unknown as { __fiber?: Fiber }).__fiber = fiber;
    }
  }

  if (fiber.dom) orderChildren(fiber.dom as HTMLElement, collectHostChildren(fiber));

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

/** passive effect：提交完成后统一执行，先清理再执行（对应 flushPassiveEffects） */
function flushEffects(root: Fiber): void {
  const withHooks: Fiber[] = [];
  const collect = (fiber: Fiber | null): void => {
    if (!fiber) return;
    if (fiber.hooks) withHooks.push(fiber);
    collect(fiber.child);
    collect(fiber.sibling);
  };
  collect(root);

  for (const fiber of withHooks) {
    for (const hook of fiber.hooks as never[]) {
      const item = hook as { effectTag?: 'create' | 'update'; cleanup?: (() => void) | null };
      if (item.effectTag === 'update') {
        item.cleanup?.();
        item.cleanup = null;
      }
    }
  }
  for (const fiber of withHooks) {
    for (const hook of fiber.hooks as never[]) {
      const item = hook as {
        effectTag?: 'create' | 'update';
        effect?: () => void | (() => void);
        cleanup?: (() => void) | null;
      };
      if (!item.effectTag) continue;
      const result = item.effect?.();
      item.cleanup = typeof result === 'function' ? result : null;
      item.effectTag = undefined;
    }
  }
}

function commitRoot(): void {
  const root = state.wipRoot;
  if (!root) return;

  // 1. 先卸载（先删后插，避免 orderChildren 的指针被残留节点干扰）
  for (const fiber of state.deletions) commitDeletion(fiber);
  state.deletions = [];
  // 2. 再修正属性与顺序
  commitWork(root);
  // 3. 最后跑 effect
  flushEffects(root);

  state.currentRoot = root;
  state.wipRoot = null;
  state.wipFiber = null;
}

/** 首次渲染同步跑完，保证首屏结果确定（React 的 legacy 同步模式也是这个语义） */
function workLoopSync(): void {
  while (state.nextUnitOfWork) performUnitOfWork(state.nextUnitOfWork);
  commitRoot();
}

/** 更新走可中断的时间切片：超过本帧预算就重新排队，下次宏任务接着做 */
function workLoopConcurrent(): void {
  state.isScheduled = false;
  const start = performance.now();
  while (state.nextUnitOfWork) {
    performUnitOfWork(state.nextUnitOfWork);
    if (state.nextUnitOfWork && performance.now() - start > FRAME_BUDGET_MS) {
      state.isScheduled = true;
      scheduleHostCallback(workLoopConcurrent);
      return;
    }
  }
  commitRoot();
}

export function render(element: unknown, container: HTMLElement): void {
  state.container = container;
  state.element = element;
  installEventDelegation(container);

  const root = createRootFiber(container, state.currentRoot);
  root.props = { children: [element] };
  state.wipRoot = root;
  state.deletions = [];
  state.isScheduled = false;
  state.nextUnitOfWork = root;

  workLoopSync();
}

/** setState 触发的调度入口：同一批次内的多次调用只安排一次渲染 */
export function scheduleUpdate(): void {
  if (!state.container) return;
  if (state.isScheduled) return;
  state.isScheduled = true;

  // 从 current 树重新开始一次完整的 work-in-progress 构建（双缓存）
  const root = createRootFiber(state.container, state.currentRoot);
  root.props = { children: [state.element] };
  state.wipRoot = root;
  state.deletions = [];
  state.nextUnitOfWork = root;

  scheduleHostCallback(workLoopConcurrent);
}
