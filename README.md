# mini-react

一个**教学级**的 React 运行时实现：手写 Fiber 架构、Hooks、时间切片调度、Diff 与事件委托。
目的是把「React 为什么能这样做」从"会用 API"推进到"能亲手实现"，全部源码不到 900 行，配 32 个单测锁定行为。

> 这不是 React 的替代品，而是一份**可运行的原理说明书**。所有实现都对照 React 源码里的真实概念命名
> （`workInProgress` / `alternate` / `effectTag` / `reconcileChildFibers` / `flushPassiveEffects`），
> 读完再去读 react-reconciler 会顺畅很多。

## 一、跑起来

```bash
pnpm install

pnpm test           # 32 个单测（jsdom 环境）
pnpm typecheck      # tsc --noEmit，strict 模式
pnpm build:example  # 打包 examples/main.ts → examples/dist/main.js
```

打包完成后**直接双击打开 `examples/counter.html`**（IIFE 格式，无需起服务器），
里面是一个计数器 + 待办列表，覆盖了 `useState` / `useEffect` / `useMemo` / `useRef` / keyed diff / 事件冒泡。

## 二、目录结构

```
src/
├── state.ts        # 全局可变状态单例（wipFiber / hookIndex / wipRoot / currentRoot / nextUnitOfWork …）
├── scheduler.ts    # MessageChannel 宏任务调度 + flushScheduled（测试用）
├── fiber.ts        # Fiber 数据结构 + 宿主子节点收集
├── dom.ts          # createDom / setProps（属性 diff）/ 事件委托与合成事件
├── reconcile.ts    # children 拍平 + diff（key 匹配 / 就近匹配 / deletions 收集）
├── hooks.ts        # useState / useEffect / useRef / useMemo
├── render.ts       # createElement / render / performUnitOfWork / commit / workLoop
└── index.ts        # 对外导出
tests/              # 6 个 spec，32 例
examples/           # 可交互 demo（无 JSX，用 h() 直写虚拟 DOM）
```

## 三、核心链路

### 1. 阶段划分：render（可中断）→ commit（一次性）

```
render(h(App), container)
        │
        ▼
┌────────────────────────── render 阶段（可被时间切片打断）──────────────────────────┐
│  nextUnitOfWork = root                                                              │
│  while (nextUnitOfWork) {                                                           │
│      performUnitOfWork(fiber)                                                       │
│        ├─ 函数组件 → 切换 Hook 上下文（wipFiber + hookIndex 归零）→ 执行组件取输出   │
│        │             └─ reconcileChildren(fiber, [output])   ← diff 在这里发生      │
│        └─ 宿主组件 → 首次 createDom（不插入文档！）→ reconcileChildren               │
│      游标推进：child → sibling → 回溯 parent.sibling，走完即中止                    │
│  }                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
        │  （首次渲染：同步跑完 workLoopSync；更新：workLoopConcurrent 超 5ms 就让出）
        ▼
┌────────────────────────── commit 阶段（不可中断）──────────────────────────────────┐
│  1. 先卸载：deletions 里的 fiber → unmountFiber（跑 cleanup）→ 摘 DOM               │
│  2. 再变更：commitWork 自顶向下 → setProps 属性 diff + orderChildren 按新顺序重排   │
│  3. 后生效：flushEffects 收集所有带 hooks 的 fiber → 先跑全部 cleanup，再跑全部 effect │
│  4. currentRoot = wipRoot（双缓存交换）                                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

关键设计：**render 阶段绝不触碰真实 DOM**，只生成本次变更的"意图"（新 fiber 树 + effectTag + deletions）；
真正的 insertBefore / removeChild 全部集中在 commit 阶段一次性执行。这样即使 render 被打断十几次，
用户也只会看到"要么没变、要么一步到位"，不会看到半成品。

### 2. 双缓存（double buffering）

`state.currentRoot` 是当前屏幕上的树，每次更新都用它作为 `alternate` 重建一棵新的 `wipRoot`：

```
currentRoot ──alternate──┐
                         ▼
   rootA ──child──> App ──child──> div ──child──> button        （屏幕上正在显示的）
     ▲                                                              
     │ alternate                                                    
   rootB ──child──> App' ──child──> div' ──child──> button'       （本次构建的 wip 树）
```

复用规则：节点在 reconcile 时命中旧的 `alternate` 就**继承它的 `dom`**，
于是更新时只需 `setProps` 改属性，不必重建整棵 DOM。`alternate` 同时也是 Hooks 能找到
"上一次渲染的 hook 数组"的唯一入口（见 `oldHookAt`）。

### 3. 时间切片调度

```
scheduleUpdate()  ← setState 调用
      │
      ├─ 提交阶段用 isScheduled 去重：一批事件里连续 3 次 setState 只安排 1 次渲染
      │
      └─ MessageChannel.postMessage → 下一个宏任务执行 workLoopConcurrent
               │
               └─ 每个工作单元后检查 performance.now() - start > 5ms
                      ├─ 未超预算 → 继续下一个 fiber
                      └─ 超预算   → 重新 postMessage 排队，把主线程还回去
```

浏览器在宏任务之间可以处理点击/输入/绘制，所以长列表渲染不会卡住交互。
React 18 在此基础上加了 lane 优先级模型，本实现只做"单一优先级 + 时间切片"。

### 4. Hooks：数组 + 游标，而不是链表

React 用链表（`hook.next`）挂 Hook，本实现用「数组 + `hookIndex` 游标」表达同一件事：

```
fiber.hooks = [useState, useEffect, useRef, useMemo]
                 ↑ index 0    ↑ 1        ↑ 2      ↑ 3
每次渲染 hookIndex 从 0 开始，第 i 次调用就对上第 i 个 hook —— 
这就是「Hook 不能写在条件/循环里」的根本原因。
```

- **setState 批量合并**：`setState` 把更新 push 进**本轮 hook 的 queue**（不是立刻改 state），
  并调用 `scheduleUpdate()`。下一次渲染时，新 hook 先把 `oldHook.queue` 全部消费完再返回，
  所以「同一事件里 3 次函数式 setState」最终只渲染 1 次、值一次性累加到位（对应测试
  `renders === 2` / 值 `=== 3`）。
- **闭包陷阱**：`setState` 闭包里捕获的是**那一次渲染的 hook 对象**，它排进 queue 的更新会被
  未来某次渲染正确消费——这正是 React 里"闭包拿到旧 state"的机制来源。
- **useEffect**：`depsChanged` 时打 `effectTag`；清理函数通过 `oldHook.cleanup` 传递到新 hook，
  保证"依赖变化先 cleanup 再 effect"和"卸载时 cleanup"用的是同一份。
- **useRef**：跨渲染复用同一个 `{ current }` 对象（`oldHook.state`），修改它不触发渲染。
- **useMemo**：依赖不变直接返回 `oldHook.state`，不重新执行工厂函数。

### 5. Diff：key 匹配 + 就近匹配 + 提交阶段统一重排

`reconcileChildren` 只做"匹配"，不做"移动"：

| 场景 | 策略 |
|------|------|
| 有 key | 建 `Map<key, Fiber[]>` 索引，命中即复用（**可跨位置复用！**） |
| 无 key | 在未占用的旧 fiber 里按 `type` 就近匹配 |
| 同 key 但 `type` 变了 | 旧节点判定作废 → 进 `deletions`；新节点 `effectTag: 'placement'` |
| 未匹配上的旧 fiber | 全部进 `deletions`，commit 阶段集中卸载 |

位置重排**不在 diff 阶段处理**（React 源码里靠 `Placement`/`ChildDeletion` 两种 effect 标记表达移动），
本实现改用提交阶段的指针走位（`orderChildren`）：

```
parentDom.firstChild ──nextExisting（指针）
对每个目标子节点 dom：
   dom !== nextExisting  →  insertBefore(dom, nextExisting)   // 插到指针前面
   nextExisting = dom.nextSibling                            // 指针推进
```

新增、删除、重排三种情况被统一成同一个动作，顺序永远收敛到新 fiber 树的顺序，
且**同一个 DOM 节点在一次重排中最多被移动一次**。

### 6. 事件委托与合成事件

只在根容器上挂 `click / input / change` 三个原生监听器（对齐 React 17+ 的"委托到 root"）：

```
用户点击 button
      │
      ▼
原生事件冒泡到 container → dispatchDelegated(container, nativeEvent)
      │
      ▼
从 event.target 沿 parentNode 上溯，对每个节点读 (dom as any).__fiber 反查
      │   handlerName = 'on' + 事件名首字母大写（click → onClick）
      ▼
命中 fiber.props[handlerName] 是函数 → 构造合成事件（type/target/currentTarget/
preventDefault/stopPropagation）→ 调用；stopPropagation 命中即中断上溯
```

因为 handler 是从**当前 fiber 的 props** 里现读的，所以属性更新后事件自动指向最新闭包，
不需要重新绑定监听器——这就是为什么 `setEnabled(false)` 之后 handler "被移除"立即生效
（见 `tests/event.spec.ts` 第 4 例）。

## 四、与真实 React 的差距

诚实列出"没做"的部分，也是继续深入的地图：

| 维度 | 本实现 | 真实 React 18/19 |
|------|--------|------------------|
| 优先级模型 | 单一优先级 + 5ms 时间切片 | lane 位掩码模型（31 条车道），高优先级更新可打断低优先级渲染 |
| 中断恢复 | 整棵 wip 树从头重建 | 复用已完成的 wip 子树，靠 `renderLanes` 判断能否跳过 |
| Diff | key 索引 + 类型就近匹配 | 复用索引遍历 + 尾指针双端对比，O(n) 且能识别"仅末尾新增/删除"快速路径 |
| Effect 时机 | commit 后同步 flush | passive effect 在下一帧批量异步执行，且支持优先级、`flushSync` 逃生舱 |
| 并发特性 | 无 | `startTransition` / `useDeferredValue` / `Suspense`（需要"可抛弃的重渲染"全程支持） |
| 组件类型 | 函数组件 | 函数 + 类 + `memo` / `forwardRef` / `lazy` / Context / ErrorBoundary |
| Hooks | 4 个 | 全量（`useReducer` / `useCallback` / `useLayoutEffect` / `useId` / `useTransition` …） |
| 事件系统 | 3 类委托 + 简化合成事件 | 全事件表 + 捕获/冒泡双阶段 + 优先级 + 事件池 + 与宿主配置对接 |
| DOM 宿主 | 浏览器 DOM 硬编码 | HostConfig 抽象，一套 reconciler 支持 DOM / Native / 自定义渲染器 |
| Portal | 无 | `createPortal`（DOM 树与 fiber 树分离） |
| 错误处理 | 无 | Error Boundary + `captureOwnerStack` |
| 服务端渲染 | 无 | `react-dom/server` +  hydrate 复用 |
| React 19 新特性 | 无 | Actions / `use()` / `useOptimistic` / 自动 ref 传递 / 文档元数据提升 |

## 五、可验证的行为清单（32 个单测）

| 文件 | 覆盖内容 |
|------|---------|
| `tests/render.spec.ts` | 嵌套结构、函数组件、style 对象、null/false 忽略、数组 children 拍平、数字转文本 |
| `tests/hooks.spec.ts` | 初始值、setState 更新、**3 次 setState 合并为 1 次渲染**、连续点击各自渲染、传值覆盖、useRef 引用保持 |
| `tests/effect.spec.ts` | 首次执行、依赖变化先 cleanup、依赖不变不重跑、无依赖每次执行、卸载 cleanup |
| `tests/diff.spec.ts` | key 重排复用同一 DOM 节点、删除后摘除、中间插入位置正确、key 同类型变不复用、无 key 按位置复用 |
| `tests/update.spec.ts` | props/disabled/title 更新、className 清除、style 逐键 diff、文本复用、条件渲染挂载卸载 |
| `tests/event.spec.ts` | 冒泡顺序 inner→outer、stopPropagation 阻断、合成事件 target/currentTarget、handler 热插拔、不误触兄弟 |

## 六、推荐阅读顺序

1. `fiber.ts` — 先理解"树 + 链表"这个能暂停的数据结构
2. `render.ts` 的 `performUnitOfWork` + `workLoop*` — 遍历与调度
3. `reconcile.ts` — diff 如何决定复用还是新建
4. `hooks.ts` — 数组游标如何实现"按调用顺序定位"
5. `dom.ts` — 属性和事件如何落到真实 DOM
6. 对照 `tests/` 逐个跑，改一行代码看哪个断言会红

## License

MIT
