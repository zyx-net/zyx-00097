# 急救分诊训练小游戏

一个基于 React + TypeScript + Vite 的急救分诊训练工具，用于训练医护人员在紧急情况下快速、准确地对患者进行分诊。

## 功能特性

- **四色通道分诊**：红（紧急）、黄（危重）、绿（非紧急）、黑（死亡/预期死亡）
- **实时资源管理**：氧气、心电图、阿司匹林、颈托、静脉输液、CT 等多种医疗资源
- **患者维度资源绑定**：每次资源消耗明确记录分配给哪位患者，避免评分模糊
- **评分可复算**：完整的操作日志 + 评分证据链（recalcProof），支持事后复盘
- **持久化存储**：未完成局面自动保存，刷新页面可恢复
- **状态流转控制**：开始、暂停、结束、放弃，状态间互斥拦截
- **复盘导出**：支持 TXT / JSON / CSV 格式导出完整操作时间线和评分证据
- **旧存档兼容**：旧版本存档可降级读取和评分

## 技术栈

- React 18 + TypeScript 5
- Vite 6（构建工具）
- Zustand 5（状态管理）
- Zod 3（数据校验）
- TailwindCSS 3（样式）
- Lucide React（图标）

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173 即可开始游戏。

### 构建生产版本

```bash
npm run build
```

### 类型检查

```bash
npm run check
```

### 回归测试

```bash
npx tsx scripts/resource-triage-regression.mts
```

## 游戏玩法

1. **选择关卡**：从关卡列表中选择一个训练场景（如 `basic-emergency`）
2. **查看患者**：患者队列会显示每位患者的病情描述和分诊建议
3. **分配通道**：点击患者卡片选中，然后点击目标通道（红/黄/绿/黑）
4. **分配资源**：选中患者后，点击对应资源卡片的「消耗」按钮为该患者分配资源
5. **归还资源**：如果资源可复用，选中患者后点击「归还」按钮
6. **暂停/继续**：可随时暂停游戏，暂停期间禁止任何操作
7. **提交评分**：所有患者分诊完成后点击「提交」，查看详细评分和复盘

## 评分规则

总分 = 通道分 + 资源分 + 时间分 + 奖励分 - 扣分项

| 项目 | 说明 | 分值 |
|------|------|------|
| 通道正确 | 患者分配到正确通道 | +100 / 人 |
| 通道错误 | 患者分配到错误通道，按严重程度梯度扣分 | -10 ~ -50 / 人 |
| 资源缺失 | 患者需要的资源未分配 | -10 / 个 |
| 资源滥用 | 消耗性资源分配过多 | -10 / 个 |
| 超时 | 超出关卡时间限制 | -1 / 秒 |
| 暂停惩罚 | 每次暂停 | -20 |
| 全对奖励 | 所有患者通道全对 | +50 |
| 资源高效 | 资源使用率 ≥ 90% 且全对 | +30 |

## 核心架构

### 资源绑定机制

```
ResourceAssignment {
  id: string;           // 资源分配单唯一ID
  patientId: string;    // 分配给哪位患者
  resourceId: string;   // 哪种资源
  assignedAt: number;   // 分配时间
  returnedAt?: number;  // 归还时间（可复用资源）
}
```

**评分双轨制**：
- **Modern 模式**：有 `resourceAssignments` 时，按患者维度聚合统计
- **Legacy 模式**：只有旧的全局 `resourceUsage` 时，按患者顺序依次消费

### 状态拦截

所有修改操作（分配通道、消耗/归还资源）都会经过 `checkStatusAllowsMutation` 校验，在 `PAUSED` / `ENDED` / `ABANDONED` / `IDLE` 状态下被拦截。

### 持久化

- `saveInProgress()`：自动保存未完成局面到 localStorage
- `loadInProgress()`：恢复未完成局面
- `saveHistory()`：保存已提交的评分记录
- `normalizeSession()`：加载时自动补齐缺失字段，兼容旧存档

## 项目结构

```
src/
├── components/       # UI 组件
│   ├── game/        # 游戏界面组件（ResourceSlot、ChannelZone 等）
│   ├── result/      # 结果页组件（Timeline、ScoreBreakdown 等）
│   └── shared/      # 通用组件
├── pages/           # 页面组件
├── store/           # Zustand 状态管理（gameStore）
├── types/           # TypeScript 类型定义
├── utils/           # 工具函数
│   ├── scoring.ts   # 评分引擎
│   ├── storage.ts   # 持久化
│   ├── export.ts    # 复盘导出
│   └── levels.ts    # 关卡配置加载
├── validators/      # 运行时校验
└── main.tsx         # 入口

scripts/
└── resource-triage-regression.mts  # 回归测试脚本
```

## 回归测试覆盖

测试脚本 `scripts/resource-triage-regression.mts` 覆盖以下场景：

1. **核心 Bug 回归**：`p001` 和 `p005` 共用 `oxygen` 的评分准确性
2. **状态拦截**：`PAUSED` / `ENDED` / `RUNNING` 状态下的操作拦截正确性
3. **旧存档兼容**：无 `resourceAssignments` 的旧存档 fallback 算法
4. **三方一致性**：评分、序列化/反序列化（模拟刷新）、TXT 导出三者相互印证

## 复算验证流程

1. 游戏操作产生 `operationLog` 和 `resourceAssignments`
2. 提交时 `calculateScore()` 生成 `recalcProof` 证据链
3. 复盘导出 `exportReplayTXT()` 包含「资源-患者绑定表」
4. 三者可独立相互校验，确保评分公平透明

## License

MIT
