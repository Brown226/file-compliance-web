#r "nuget: DocumentFormat.OpenXml, 3.2.0"

using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

class Program
{
    static void Main(string[] args)
    {
        string outputDir = @"e:\工作\file-compliance-web\offline-packages";
        
        CreateUserGuide(outputDir, "管理员", "管理员使用手册.md", "管理员使用手册.docx");
        CreateUserGuide(outputDir, "普通用户", "普通用户使用手册.md", "普通用户使用手册.docx");
        CreateUserGuide(outputDir, "二级管理员", "二级管理员使用手册.md", "二级管理员使用手册.docx");
        
        Console.WriteLine("Done! Created 3 Word documents.");
    }

    static void CreateUserGuide(string outputDir, string title, string mdFile, string docxFile)
    {
        string mdPath = Path.Combine(outputDir, mdFile);
        string docxPath = Path.Combine(outputDir, docxFile);
        
        string markdown = File.ReadAllText(mdPath);
        
        using var doc = WordprocessingDocument.Create(docxPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document();
        var body = new Body();
        
        // 设置默认字体（中文）
        var stylesPart = mainPart.AddNewPart<StyleDefinitionsPart>();
        stylesPart.Styles = CreateStyles();
        stylesPart.Styles.Save();
        
        // 解析 Markdown 并转换为 OpenXML
        var lines = markdown.Split('\n');
        int i = 0;
        bool inTable = false;
        string[][] tableData = null;
        string[] tableHeaders = null;
        int tableColCount = 0;
        
        while (i < lines.Length)
        {
            string line = lines[i].Trim();
            
            // 跳过分隔线
            if (line == "---" || line.StartsWith("***") || line.StartsWith("---"))
            {
                i++;
                continue;
            }
            
            // 跳过页脚
            if (line.StartsWith("*文档版本") || line.StartsWith("*适用版本"))
            {
                i++;
                continue;
            }
            
            // 表格处理
            if (line.StartsWith("|"))
            {
                var rows = new System.Collections.Generic.List<string[]>();
                int colCount = 0;
                
                while (i < lines.Length && lines[i].Trim().StartsWith("|"))
                {
                    string tableLine = lines[i].Trim();
                    // 跳过分隔行（如 |------|------|）
                    if (tableLine.Contains("---") || tableLine.Contains(":--") || tableLine.Contains("--:"))
                    {
                        i++;
                        continue;
                    }
                    
                    var cells = tableLine.Split('|', StringSplitOptions.RemoveEmptyEntries)
                        .Select(c => c.Trim().Trim('`').Trim('*').Trim('_')).ToArray();
                    if (cells.Length > 0)
                    {
                        rows.Add(cells);
                        colCount = Math.Max(colCount, cells.Length);
                    }
                    i++;
                }
                
                if (rows.Count >= 2)
                {
                    tableHeaders = rows[0];
                    var dataRows = rows.Skip(1).ToArray();
                    CreateTable(body, tableHeaders, dataRows);
                }
                continue;
            }
            
            // 标题处理
            if (line.StartsWith("# "))
            {
                var para = new Paragraph(
                    new ParagraphProperties(
                        new Justification { Val = JustificationValues.Center },
                        new SpacingBetweenLines { Before = "480", After = "240" }
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "微软雅黑", Ascii = "Microsoft YaHei", HighAnsi = "Microsoft YaHei" },
                            new Bold(),
                            new FontSize { Val = "44" },
                            new FontSizeComplexScript { Val = "44" }
                        ),
                        new Text(line.Substring(2)) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(para);
                i++;
                continue;
            }
            
            // 二级标题
            if (line.StartsWith("## "))
            {
                var para = new Paragraph(
                    new ParagraphProperties(
                        new SpacingBetweenLines { Before = "360", After = "200" },
                        new KeepNext()
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "微软雅黑", Ascii = "Microsoft YaHei", HighAnsi = "Microsoft YaHei" },
                            new Bold(),
                            new FontSize { Val = "36" },
                            new FontSizeComplexScript { Val = "36" },
                            new Color { Val = "1F4E79" }
                        ),
                        new Text(line.Substring(3)) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(para);
                i++;
                continue;
            }
            
            // 三级标题
            if (line.StartsWith("### "))
            {
                var para = new Paragraph(
                    new ParagraphProperties(
                        new SpacingBetweenLines { Before = "240", After = "120" },
                        new KeepNext()
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "微软雅黑", Ascii = "Microsoft YaHei", HighAnsi = "Microsoft YaHei" },
                            new Bold(),
                            new FontSize { Val = "28" },
                            new FontSizeComplexScript { Val = "28" },
                            new Color { Val = "2E75B6" }
                        ),
                        new Text(line.Substring(4)) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(para);
                i++;
                continue;
            }
            
            // 四级标题
            if (line.StartsWith("#### "))
            {
                var para = new Paragraph(
                    new ParagraphProperties(
                        new SpacingBetweenLines { Before = "200", After = "100" }
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "微软雅黑", Ascii = "Microsoft YaHei", HighAnsi = "Microsoft YaHei" },
                            new Bold(),
                            new FontSize { Val = "24" },
                            new FontSizeComplexScript { Val = "24" }
                        ),
                        new Text(line.Substring(5)) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(para);
                i++;
                continue;
            }
            
            // 列表项
            if (line.StartsWith("- ") || line.StartsWith("* ") || Regex.IsMatch(line, @"^\d+\. "))
            {
                string text = line;
                if (line.StartsWith("- ") || line.StartsWith("* "))
                    text = line.Substring(2);
                else if (Regex.IsMatch(line, @"^\d+\. "))
                    text = Regex.Replace(line, @"^\d+\. ", "");
                
                var para = new Paragraph(
                    new ParagraphProperties(
                        new Indentation { Left = "360", Hanging = "360" },
                        new SpacingBetweenLines { After = "60" }
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                            new FontSize { Val = "21" },
                            new FontSizeComplexScript { Val = "21" }
                        ),
                        new Text("• " + text) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(para);
                i++;
                continue;
            }
            
            // 代码块
            if (line.StartsWith("```"))
            {
                var codeLines = new System.Collections.Generic.List<string>();
                i++;
                while (i < lines.Length && !lines[i].Trim().StartsWith("```"))
                {
                    codeLines.Add(lines[i]);
                    i++;
                }
                string code = string.Join("\n", codeLines);
                var codePara = new Paragraph(
                    new ParagraphProperties(
                        new Shading { Val = ShadingPatternValues.Clear, Fill = "F5F5F5" },
                        new SpacingBetweenLines { After = "120" }
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "Consolas", Ascii = "Consolas", HighAnsi = "Consolas" },
                            new FontSize { Val = "18" },
                            new FontSizeComplexScript { Val = "18" },
                            new Color { Val = "333333" }
                        ),
                        new Text(code) { Space = SpaceProcessingModeValues.Preserve }
                    )
                );
                body.Append(codePara);
                i++;
                continue;
            }
            
            // 空行
            if (string.IsNullOrWhiteSpace(line))
            {
                i++;
                continue;
            }
            
            // 普通段落 - 处理内联格式
            ProcessParagraph(body, line);
            i++;
        }
        
        // 添加页脚信息
        body.Append(new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines { Before = "480", After = "120" }
            ),
            new Run(
                new RunProperties(
                    new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                    new Italic(),
                    new FontSize { Val = "18" },
                    new FontSizeComplexScript { Val = "18" },
                    new Color { Val = "666666" }
                ),
                new Text($"文档版本: 1.0 | 更新日期: 2026-04-22 | 适用版本: v1.0") { Space = SpaceProcessingModeValues.Preserve }
            )
        ));
        
        // 添加页面设置
        body.Append(new SectionProperties(
            new PageSize { Width = 11906, Height = 16838 }, // A4
            new PageMargin { Top = 1440, Right = 1440, Bottom = 1440, Left = 1440, Header = 720, Footer = 720 }
        ));
        
        mainPart.Document.Append(body);
        mainPart.Document.Save();
        
        Console.WriteLine($"Created: {docxPath}");
    }

    static void ProcessParagraph(Body body, string line)
    {
        // 清理 Markdown 格式
        string text = line
            .Replace("**", "")
            .Replace("*", "")
            .Replace("`", "")
            .Replace("__", "")
            .Replace("_", "");
        
        // 处理加粗标记
        var runs = new System.Collections.Generic.List<OpenXmlElement>();
        
        int pos = 0;
        string remaining = text;
        
        while (remaining.Length > 0)
        {
            int boldStart = remaining.IndexOf("**");
            if (boldStart == -1)
            {
                if (remaining.Length > 0)
                {
                    runs.Add(new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                            new FontSize { Val = "21" },
                            new FontSizeComplexScript { Val = "21" }
                        ),
                        new Text(remaining) { Space = SpaceProcessingModeValues.Preserve }
                    ));
                }
                break;
            }
            
            if (boldStart > 0)
            {
                runs.Add(new Run(
                    new RunProperties(
                        new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                        new FontSize { Val = "21" },
                        new FontSizeComplexScript { Val = "21" }
                    ),
                    new Text(remaining.Substring(0, boldStart)) { Space = SpaceProcessingModeValues.Preserve }
                ));
            }
            
            remaining = remaining.Substring(boldStart + 2);
            int boldEnd = remaining.IndexOf("**");
            if (boldEnd == -1) boldEnd = remaining.Length;
            
            runs.Add(new Run(
                new RunProperties(
                    new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                    new Bold(),
                    new FontSize { Val = "21" },
                    new FontSizeComplexScript { Val = "21" }
                ),
                new Text(remaining.Substring(0, boldEnd)) { Space = SpaceProcessingModeValues.Preserve }
            ));
            
            remaining = remaining.Substring(boldEnd + 2);
        }
        
        var para = new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines { After = "120" }
            )
        );
        foreach (var run in runs)
        {
            para.Append(run);
        }
        body.Append(para);
    }

    static void CreateTable(Body body, string[] headers, string[][] rows)
    {
        var table = new Table();
        
        // 表格属性
        var tblPr = new TableProperties(
            new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" },
                new LeftBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" },
                new BottomBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" },
                new RightBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" },
                new InsideVerticalBorder { Val = BorderValues.Single, Size = 4, Space = 0, Color = "808080" }
            )
        );
        table.Append(tblPr);
        
        // 列宽
        var grid = new TableGrid();
        int colWidth = 9360 / headers.Length;
        for (int c = 0; c < headers.Length; c++)
        {
            grid.Append(new GridColumn { Width = colWidth.ToString() });
        }
        table.Append(grid);
        
        // 表头
        var headerRow = new TableRow();
        foreach (var h in headers)
        {
            var cell = new TableCell(
                new TableCellProperties(
                    new Shading { Val = ShadingPatternValues.Clear, Fill = "D9E2F3" },
                    new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }
                ),
                new Paragraph(
                    new ParagraphProperties(
                        new Justification { Val = JustificationValues.Center },
                        new SpacingBetweenLines { After = "60" }
                    ),
                    new Run(
                        new RunProperties(
                            new RunFonts { EastAsia = "微软雅黑", Ascii = "Microsoft YaHei", HighAnsi = "Microsoft YaHei" },
                            new Bold(),
                            new FontSize { Val = "20" },
                            new FontSizeComplexScript { Val = "20" }
                        ),
                        new Text(h) { Space = SpaceProcessingModeValues.Preserve }
                    )
                )
            );
            headerRow.Append(cell);
        }
        table.Append(headerRow);
        
        // 数据行
        for (int r = 0; r < rows.Length; r++)
        {
            var dataRow = new TableRow();
            string fill = r % 2 == 0 ? "FFFFFF" : "F5F5F5";
            
            for (int c = 0; c < Math.Min(rows[r].Length, headers.Length); c++)
            {
                var cell = new TableCell(
                    new TableCellProperties(
                        new Shading { Val = ShadingPatternValues.Clear, Fill = fill },
                        new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }
                    ),
                    new Paragraph(
                        new ParagraphProperties(
                            new SpacingBetweenLines { After = "40" }
                        ),
                        new Run(
                            new RunProperties(
                                new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun" },
                                new FontSize { Val = "19" },
                                new FontSizeComplexScript { Val = "19" }
                            ),
                            new Text(rows[r][c]) { Space = SpaceProcessingModeValues.Preserve }
                        )
                    )
                );
                dataRow.Append(cell);
            }
            table.Append(dataRow);
        }
        
        body.Append(table);
        body.Append(new Paragraph(new ParagraphProperties(new SpacingBetweenLines { After = "120" })));
    }

    static Styles CreateStyles()
    {
        var styles = new Styles();
        
        // 文档默认样式
        styles.Append(new DocDefaults(
            new RunPropertiesDefault(
                new RunPropertiesBaseStyle(
                    new RunFonts { EastAsia = "宋体", Ascii = "SimSun", HighAnsi = "SimSun", ComplexScript = "Arial" },
                    new FontSize { Val = "21" },
                    new FontSizeComplexScript { Val = "21" },
                    new Languages { Val = "en-US", EastAsia = "zh-CN" }
                )
            )
        ));
        
        return styles;
    }
}
