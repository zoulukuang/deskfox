feat-id: chat-tilde-del-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/ui/src/context/marked-del-strict.ts` | **新增(fork-only)**:导出 `STRICT_DEL_RE` + `strictDel: MarkedExtension`,含"必须返 undefined"陷阱注释 | 新文件(仍在黑名单路径) |
| `packages/ui/src/context/marked.tsx` | `marked.use(...)` 参数列表插入 `strictDel`(与 `==mark==` 那批并排),带 `// FORK:` marker | 改上游 |
| `packages/web/src/components/share/marked-del-strict.ts` | **新增(fork-only)**:与 ui 那份**逐字相同**的副本(web 不依赖 ui,不建跨包依赖) | 新文件 |
| `packages/web/src/components/share/content-markdown.tsx` | `markedWithShiki = marked.use(...)`(第 9 行)参数列表插入 `strictDel`,带 `// FORK:` marker | 改上游 |
| `packages/ui/src/context/marked-del-strict.test.ts` | **新增**:T1–T10 单测(含 bug-repro + 不回归 + 防漂移守卫) | 新文件 |

## 施工顺序

1. 写 `packages/ui/src/context/marked-del-strict.ts`(先有可测单元)。
2. 写测试文件,跑 T1–T8 —— 此时只测模块本身,应全绿。
3. 接进 `marked.tsx` 的 `use()` 链;跑 `packages/ui` 全量 `bun test src` 确认既有 markdown 相关测试(`markdown-stream.test.ts` / `message-part.test.ts`)不回归。
4. 复制模块到 web,接进 `content-markdown.tsx`;补 T9(防漂移)+ T10(两份行为一致)。
5. `bun turbo typecheck --filter='!./packages/console/*'` 全绿。
6. 打本地版验 T11(真机聊天),`local` 渠道,**只杀本地版**。
7. 出 R4 复核报告(wrapper 不可行性 / 风险 / 逐文件论证)→ user 审 → commit。

## 决策轨迹

- **为什么抽成独立小模块而不是内联进 `marked.tsx`**:① 内联进上游文件会让改上游行数变大(R1 三级跳倾向"新文件承载逻辑,上游只留注入点");② 独立模块可被单测直接 import,不必构造整个 `MarkedProvider`;③ web 那份可逐字复制,漂移守卫才有可比对象。上游注入点各 1 行。
- **为什么复制而不是跨包 import**:`packages/web/package.json` 依赖表无 `@opencode-ai/ui`;为一个 12 行 tokenizer 新建包依赖会改 `package.json` + `bun.lock`(两者都在黑名单),代价高于复制。改用**测试守卫**兜漂移风险。
- **为什么用 `undefined` 而非 `false`**:`use()` 的覆盖包装是 `c === false && (c = 内置(...))`,`false` 触发回退 → 改动完全失效。已用对照组实测(返 `false` 时三条 bug 用例照旧产 `<del>`)。这条写进代码注释,防后人"顺手改成 false 更符合直觉"。
- **正则只动第一组**:`(~~?)` → `(~~)`,其余前后瞻断言逐字保留内置规则 —— 最小差分,`~~` 路径行为与上游位元一致,升级 marked 时对比成本最低。
- **防漂移守卫怎么写**:测试用 `import.meta.dir` 拼相对路径读 web 那份源码文本,断言其中 `STRICT_DEL_RE` 的正则字面量与 ui 那份 `STRICT_DEL_RE.source` 一致。纯文本比对,不引入构建期跨包依赖。

## 风险 / 回退

| 风险 | 评估 | 处置 |
|---|---|---|
| 收紧后有人真的想用单 `~` 打删除线 | GFM 标准写法是 `~~`;单 `~` 是 marked 的宽松扩展,非标准 | 不兼容,规范侧站得住 |
| ui 改了 web 忘改(或反之) | 中(两包无耦合) | T9 守卫测试拦住 |
| 上游后续升级 marked 改了内置 del 规则 | 低,且我们只覆盖不继承 | 升级时对照本文件正则重跑 T1–T8 |
| 回退 | 单 commit 内两包改动 | `git revert` 一笔即可(P4) |

## 待办追踪

- [ ] ui 模块 + 测试
- [ ] ui 接线
- [ ] web 模块 + 接线
- [ ] T9 / T10 守卫
- [ ] typecheck + ui 全量测试
- [ ] 真机 T11
- [ ] R4 复核报告 → user 审 → commit → 回填 3-changelog
