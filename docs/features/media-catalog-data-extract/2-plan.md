feat-id: media-catalog-data-extract
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 实施步骤

1. 读 `catalog.ts` 全文 + 确认打包器(`Bun.build`,原生内联 JSON)+ tsconfig(`@tsconfig/bun` 带 resolveJsonModule)+ 导出依赖方(`dispatch.ts` 用 `*_KEY` / `CatalogEntry`;`registry.ts` 用 `BUILTIN_CATALOG` / `CatalogEntry` / `Capability`)。
2. 新建 `catalog.data.json`(15 条 entry 纯数据)。
3. 新建 `catalog.schema.json`(JSON Schema 契约)。
4. 改 `catalog.ts`:删内联数组 → `import catalogData from "./catalog.data.json"` 重导出;类型/常量/`CAPABILITY_LABEL` 保留。
5. 新建 `__tests__/catalog-data.test.ts`。
6. typecheck + test + 重建 dist 验证内联。

## 决策轨迹

- **数据 vs 代码边界**:只搬「会变动的数据」(模型清单),类型/标签/key 常量是代码契约,留 `.ts`。
- **注释怎么保留**:JSON 无注释 → 给 `CatalogEntry` 加可选 `note?: string`,把原内联里有价值的踩坑/决策(尤其 `xiaomi-mimo-v2.5-asr` 的「Omni 当 ASR、mimo-v2.5-asr 未暴露、6/30 下线预警」)落成数据字段,随数据一起走 —— 正好契合 registry 让维护者看到的目标。
- **校验放哪**:阶段 1 数据是可信的(随包 ship),**不在运行时校验**(保持行为一致 + bundle 精简);测试期用结构断言校验。运行时校验留到阶段 3(拉不可信线上数据时)。
- **不引入 ajv**:`zod` 虽在依赖里,但用纯结构断言更透明、零新增依赖,且能直接做「schema.json 枚举 == 代码 CAPABILITY_LABEL keys」的防漂移检查。
- **类型 cast**:JSON 的 `capability`/`needFile` 被推断为 `string`,与联合类型不等价 → `as unknown as CatalogEntry[]`,经测试校验兜底。
- **未用常量清理**:数据搬走后 `ALIBABA`/`MINIMAX`/`MINIMAX_HAILUO`/`XIAOMI` 显示名常量无引用,移除避免 `noUnusedLocals`;`*_KEY`(被 dispatch 依赖)保留。

## 踩坑 / 验证

- `dist/plugin.js` 内确认数据作为 `var catalog_data_default = [...]` 内联,无 `require/import/readFileSync` 外部 json(避免边车跑时找不到文件)。
- `bun test` 140 pass(原 128 + 新 12 用例)。
