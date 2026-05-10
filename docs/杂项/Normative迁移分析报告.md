# Normative 核心功能迁移至 file-compliance-web 系统分析报告

> 报告日期：2026-04-18
> 分析范围：CAD图纸解析、数据提取、规则匹配、结果展示

---

## 一、Normative 项目概述

### 1.1 技术架构

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端 | Windows Forms (.NET 4.5.2) | 桌面客户端 |
| 后端 | WCF服务 (.NET 4.6.1) | SOAP协议通信 |
| 数据库 | SQL Server + Dapper | 关系型数据访问 |
| CAD处理 | Aspose.CAD | DWG文件解析 |
| 文档处理 | Aspose.Cells/Words, Spire.PDF | Office/PDF解析 |
| OCR识别 | PaddleOCR | 文字识别增强 |
| IOC容器 | Autofac | 依赖注入 |

### 1.2 核心功能模块

```
Normative项目
├── Normative.Core (核心业务层)
│   ├── DocTypeHandle/          # 文档类型处理器
│   │   ├── DwgHandle.cs        # CAD图纸处理器 ⭐
│   │   ├── PdfHandle.cs        # PDF处理器
│   │   ├── WordHandle.cs       # Word处理器
│   │   ├── ExcelHandle.cs      # Excel处理器
│   │   └── DocHandleBase.cs    # 处理器基类
│   ├── CheckDocStandardHelper.cs  # 标准规范检查核心 ⭐
│   ├── CheckStandardHelper.cs   # 相似度算法
│   ├── NormativeHelper.cs       # 主入口协调
│   └── AutoFacContext.cs        # IOC配置
├── Normative.Model (数据模型)
└── Normative.Services (服务层)
```

---

## 二、CAD图纸解析机制详解

### 2.1 DWG处理流程

```csharp
// DwgHandle.cs 核心逻辑
public override void GetDocTxt()
{
    // 1. 使用Aspose.CAD加载DWG文件
    using (CadImage cadimg = (CadImage)Image.Load(docitem.FilePath))
    {
        // 2. 遍历图纸中的所有实体
        foreach (CadBaseEntity entity in cadimg.Entities)
        {
            string strval = string.Empty;
            // 3. 提取文本内容
            if (entity is CadText text)
                strval = text.DefaultValue;           // 单行文本
            else if (entity is CadMText mtext)
                strval = mtext.FullClearText;         // 多行文本
            
            // 4. 解析标准规范引用
            if (!string.IsNullOrEmpty(strval))
                GetDocStandards(strval);
        }
    }
}
```

### 2.2 标准规范引用正则匹配

```csharp
// DocHandleBase.cs - 核心正则表达式
string codePattern = @"《.*?》(\s+)?[\(\（]?(\s+)?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)\）]?([\(\（].*[\)\）])?";

// 匹配示例：
// 《建筑设计防火规范》(GB 50016-2014)
// 《建筑结构荷载规范》GB 50009-2012
// 《混凝土结构设计规范》(2019年版)GB 50010-2010
```

### 2.3 标准标识符提取

```csharp
// 从标准编号中提取前缀（如 GB、GB/T、JG、ANSI等）
public static string GetIdent(string str)
{
    string strident = "";
    ASCIIEncoding asciiencoding = new ASCIIEncoding();
    foreach (var c in str)
    {
        if (c == '/') { strident += c; continue; }
        int ascii = (int)asciiencoding.GetBytes(c.ToString().ToUpper())[0];
        if (ascii >= 65 && ascii <= 90)  // A-Z
            strident += c.ToString();
        else break;
    }
    return strident;
}
```

---

## 三、规则匹配机制详解

### 3.1 多层级匹配策略

```csharp
// CheckDocStandardHelper.cs - GetStandardSimilarity()
// 采用10+层级匹配策略，从精确到模糊

// 第1层：完全匹配
var q = CheckStandardInfos.FirstOrDefault(t => t.StandardName == docstandardinfo.StandardName);
var q = CheckStandardInfos.FirstOrDefault(t => t.StandardNo == docstandardinfo.StandardNo);

// 第2层：去除空格后匹配
t.StandardName.Replace(" ", "") == docstandardinfo.StandardName.Replace(" ", "")

// 第3层：去除标点符号后匹配
.Replace("（", "(").Replace("）", ")").Replace("：", ":").Replace("，", ",")
.Replace("及", "和").Replace("、", "和")

// 第4层：忽略大小写匹配
.ToUpper()

// 第5层：包含匹配
t.StandardNo.Contains(docstandardinfo.StandardNo)

// 第6层：编号数字部分比较
GetStandardNum() // 提取纯数字部分进行比较
```

### 3.2 错误检测类型

| 错误类型 | 触发条件 | 说明 |
|---------|---------|------|
| 不存在该标准规范 | 所有匹配层都失败 | 标准库中无此标准 |
| 编号错误 | `NoResults.Count > 0` | 字符对比发现差异 |
| 名称错误 | `NameResults.Count > 0` | 名称与标准库不匹配 |

### 3.3 字符差异对比算法

```csharp
// CheckChar() - 逐字符对比，标记错误位置
private void CheckChar(string StandardInfo, string CorrectStandardInfo, 
                      List<CharResult> Results, List<CharResult> CorrectResults)
{
    int minnolen = Math.Min(StandardInfo.Length, CorrectStandardInfo.Length);
    int errorlen = 0;
    int firstno = 0;

    for (int i = 0; i < minnolen; i++)
    {
        if (StandardInfo[i] == CorrectStandardInfo[i])
        {
            if (errorlen > 0)
            {
                // 记录错误区间
                CharResult charResult = new CharResult();
                charResult.startindex = firstno;
                charResult.length = errorlen;
                Results.Add(charResult);
            }
            errorlen = 0;
        }
        else
        {
            if (errorlen == 0) firstno = i;
            errorlen++;
        }
    }
    // 处理长度差异部分
}
```

---

## 四、结果导出机制

### 4.1 Excel结果导出

```csharp
// NormativeHelper.ExportResult() - 带颜色标注的结果导出
// 列结构：序号、标准名称、标准编号、错误类型/内容、更正后名称、更正后编号、文件名

// 颜色标注规则：
// - 标准名称错误字符 → 红色
// - 标准编号错误字符 → 红色
// - 更正后的正确内容 → 绿色
```

### 4.2 UI展示

```csharp
// CheckResults.cs - 结果详情展示
// - 按文件分组显示检查结果
// - 错误信息红色高亮
// - 显示正确标准编号和名称作为参考
```

---

## 五、迁移至 file-compliance-web 的可行性与方案

### 5.1 现有系统能力评估

| 功能 | Normative实现 | file-compliance-web现状 | 迁移难度 |
|------|-------------|------------------------|---------|
| DWG解析 | Aspose.CAD | 无CAD解析能力 | ⭐⭐⭐⭐⭐ 高 |
| PDF解析 | Spire.PDF + PaddleOCR | pdf-parse基础解析 | ⭐⭐⭐ 中 |
| Word解析 | Aspose.Words | mammoth基础解析 | ⭐⭐⭐ 中 |
| Excel解析 | Aspose.Cells | ExcelJS基础解析 | ⭐⭐ 低 |
| 标准库管理 | WCF服务 | PostgreSQL + Prisma | ⭐⭐ 低 |
| 规则匹配 | 多层模糊匹配 | LLM语义匹配 | ⭐⭐⭐ 中 |

### 5.2 推荐迁移方案

#### 方案A：完全集成 (推荐短期)

**核心思路**：将 Normative 的 CAD 解析能力作为 Node.js 后端的扩展模块

```
迁移路径：
1. 后端：新增 DWG 解析服务 (使用 CAD.js / opendwg)
2. 后端：复用 NormativeHelper 正则匹配逻辑 (TypeScript 重写)
3. 前端：复用结果展示组件
```

**技术选型**：
- CAD解析：`node-opendwg` 或 `libreCAD` (开源方案)
- 或使用 Python 微服务封装 Aspose.CAD，通过内部API调用

#### 方案B：微服务架构 (推荐长期)

```
┌─────────────────┐    ┌─────────────────┐
│  file-compliance │    │  CAD解析微服务   │
│  -web (Node.js) │───▶│  (Python/.NET)  │
│                  │    │  - Aspose.CAD   │
│  - 标准库管理    │    │  - 规则匹配      │
│  - 任务调度      │    │  - OCR增强      │
│  - LLM审查      │◀───│                 │
└─────────────────┘    └─────────────────┘
```

#### 方案C：纯前端增强 (快速实现)

**适用场景**：仅需在现有基础上增加 CAD 支持

```
1. 保留后端解析逻辑 (mammoth/pdf-parse)
2. CAD文件 → 上传到后端 → 使用 ImageMagick 转 PDF → 调用 PaddleOCR → 文本提取
3. 文本提取 → 复用 NormativeHelper 正则 → 规则匹配 → 存储结果
```

---

## 六、详细迁移步骤

### 6.1 第一阶段：CAD文本提取能力 (2-3天)

```typescript
// backend/src/services/cadParser.service.ts (新建)
import * as opendwg from 'node-opendwg';

export class CadParserService {
  /**
   * 从DWG文件中提取文本内容
   * 核心逻辑：参考 DwgHandle.cs 的 GetDocTxt()
   */
  static async extractText(filePath: string): Promise<string[]> {
    // 1. 使用 opendwg 或 ImageMagick 转换
    // 2. 遍历 CadText、CadMText 实体
    // 3. 收集所有文本内容
  }

  /**
   * 解析标准规范引用
   * 核心逻辑：参考 DocHandleBase.cs 的 GetDocStandards()
   */
  static parseStandards(text: string): DocStandard[] {
    const codePattern = /《.*?》(\s+)?[\(\（]?(\s+)?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)\）]?/gi;
    // 正则匹配 + 解析
  }
}
```

### 6.2 第二阶段：规则匹配服务 (2-3天)

```typescript
// backend/src/services/standardMatcher.service.ts (新建)
export class StandardMatcherService {
  /**
   * 标准规范匹配
   * 核心逻辑：参考 CheckDocStandardHelper.cs
   */
  static async matchStandard(
    docStandards: DocStandard[],
    standardLibrary: Standard[]
  ): Promise<MatchResult[]> {
    // 1. 多层级精确匹配
    // 2. 模糊匹配 (去空格/标点)
    // 3. 包含匹配
    // 4. 编号数字部分比较
    // 5. 返回匹配结果和错误信息
  }

  /**
   * 字符差异对比
   * 核心逻辑：参考 CheckChar()
   */
  static diffChars(a: string, b: string): CharDiff[] {
    // 逐字符对比，返回差异区间
  }
}
```

### 6.3 第三阶段：数据模型扩展 (1天)

```typescript
// backend/prisma/schema.prisma 扩展
model TaskDetail {
  // ... 现有字段
  cadHandleId    String?   // CAD实体定位 (对应 Normative 的 cadHandleId)
  matchedStandardId String? // 匹配到的标准ID
  matchConfidence Float?   // 匹配置信度
}
```

### 6.4 第四阶段：前端结果展示 (1-2天)

```vue
<!-- frontend/src/views/TaskDetails/components/CadReviewPanel.vue -->
<template>
  <div class="cad-review-panel">
    <!-- 引用标准列表 -->
    <el-table :data="referencedStandards">
      <el-table-column label="标准编号" prop="standardNo">
        <template #default="{ row }">
          <span :class="{ 'error-text': row.hasError }">{{ row.standardNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="匹配状态">
        <template #default="{ row }">
          <el-tag v-if="row.isMatched" type="success">已匹配</el-tag>
          <el-tag v-else type="danger">未匹配</el-tag>
        </template>
      </el-table-column>
      <!-- 字符级差异高亮 -->
    </el-table>
  </div>
</template>
```

---

## 七、关键技术点对比

### 7.1 CAD文本提取

| 维度 | Normative (.NET) | 迁移方案 (Node.js) |
|------|------------------|-------------------|
| 库 | Aspose.CAD | node-opendwg / ImageMagick |
| 实体遍历 | CadImage.Entities | CAD.js parse() |
| 文本提取 | CadText.DefaultValue | entity.text |
| 多行文本 | CadMText.FullClearText | entity.texts.join('') |

### 7.2 正则表达式 (可完全复用)

```typescript
// 完全一致
const STANDARD_PATTERN = /《.*?》(\s+)?[\(\（]?(\s+)?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)\）]?([\(\（].*[\)\）])?/gi;
```

### 7.3 标识符提取 (可完全复用)

```typescript
// 完全一致
function getIdent(standardNo: string): string {
  const letters: string[] = [];
  for (const char of standardNo) {
    if (char === '/') {
      letters.push(char);
    } else if (/[A-Za-z]/.test(char)) {
      letters.push(char.toUpperCase());
    } else {
      break;
    }
  }
  return letters.join('');
}
```

---

## 八、风险评估与建议

### 8.1 技术风险

| 风险点 | 等级 | 缓解措施 |
|-------|------|---------|
| CAD解析准确性不如Aspose | 高 | 使用Python微服务封装原.NET代码 |
| Node.js缺乏CAD库 | 高 | 采用ImageMagick+OCR替代方案 |
| DWG版本兼容性 | 中 | 限制支持DWG 2018以下版本 |

### 8.2 建议优先顺序

1. **短期**：先实现 PDF/Word/Excel 的标准规范提取（复用 Normative 正则）
2. **中期**：通过 Python 微服务提供 CAD 解析能力
3. **长期**：考虑自研 CAD 解析或商业授权 Aspose.CAD

---

## 九、附录

### 9.1 核心文件对照表

| Normative文件 | 迁移目标 | 说明 |
|--------------|---------|------|
| `DwgHandle.cs` | `cadParser.service.ts` | CAD解析核心 |
| `DocHandleBase.cs` | `parserBase.ts` | 文档解析基类+正则 |
| `CheckDocStandardHelper.cs` | `standardMatcher.service.ts` | 规则匹配核心 |
| `NormativeHelper.cs` | `normativeHelper.ts` | 主入口协调 |
| `ItemModel.cs` | `models/` | 数据模型 |
| `CheckResults.cs` | `TaskDetails.vue` | 结果展示 |

### 9.2 数据模型映射

```typescript
// Normative → file-compliance-web
Normative.ItemModel        → TaskFile
Normative.DocStandard      → TaskDetail (扩展)
Normative.StandardModel    → Standard
Normative.CharResult       → CharDiff
Normative.StandardSimilarity → MatchResult
```

---

## 十、结论

Normative 项目的核心价值在于：

1. **成熟的CAD解析能力**（Aspose.CAD商业库支持）
2. **完善的标准规范匹配算法**（多层级模糊匹配）
3. **字符级差异定位**（CheckChar算法）

迁移的关键路径：
- **正则匹配逻辑**可直接移植到现有系统
- **CAD解析能力**建议通过 Python 微服务实现
- **结果展示**可复用现有 TaskDetails 组件

---

*报告生成时间：2026-04-18*
*分析师：CodeBuddy AI*
