feat-id: voice-main-integration
status: in-progress
related: ./1-spec.md ./3-changelog.md

# 实施计划

1. 从更新后的 main 建集成分支，保留原语音分支，验证既有 bundle。
2. 合并原分支，解决文档冲突，保留两侧历史。
3. 先跑语音测试并核对当前后端接口；集成缺陷先补复现测试再修复。
4. 跑完整开发闸，补齐分支回执与真机验收清单。

无需引入设置 UI、重写语音架构或删除旧链路。测试使用临时目录/独立进程，不连接正式数据与付费模型。
