using Aspose.Cells;
using Autofac;
using Normative.Context;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace Normative.Core
{
    public static class NormativeHelper
    {
        public static DocTypeEnums GetDocTypeEnum(string filetype)
        {
            DocTypeEnums docTypeEnums = DocTypeEnums.none;
            switch (filetype)
            {
                case "dwg":
                    return DocTypeEnums.dwg;
                case "docx":
                case "doc":
                    return DocTypeEnums.word;
                case "xlsx":
                case "xls":
                    return DocTypeEnums.excel;
                case "pdf":
                    return DocTypeEnums.pdf;
            }
            return docTypeEnums;
        }

        public static void CheckDoc(ItemModel item, List<StandardModel> CheckStandardInfos)
        {
            if (string.IsNullOrEmpty(item.FilePath))
            {
                return;
            }

            List<string> standardIdents = CheckStandardInfos.Where(t => !string.IsNullOrEmpty(t.StandardIdent)).Select(t => t.StandardIdent).Distinct().ToList();
            DocHandleBase handle = null;
            using (var container = AutoFacContext.Instance.HandleProvider.BeginLifetimeScope())
            {
                try
                {
                    handle = container.ResolveNamed<DocHandleBase>(item.StrDocType,
                        new TypedParameter(typeof(ItemModel), item),
                        new TypedParameter(typeof(List<string>), standardIdents)
                        );
                }
                catch (Exception ex)
                {
                    GlobalHelper.appendlog(ex.ToString());
                    item.MessInfo = $"没有适合的处理器";
                    return;
                }
                if (handle == null)
                {
                    item.MessInfo = $"没有合适的类型处理器";
                    return;
                }

                try
                {
                    handle.GetDocTxt();
                }
                catch (Exception ex)
                {
                    GlobalHelper.appendlog(ex.ToString());
                    if (ex.Message.Contains("正由另一进程使用，因此该进程无法访问此文件"))
                    {
                        item.MessInfo = "该文档正由另一进程使用，因此该进程无法访问此文件";
                    }
                    else
                    {
                        item.MessInfo = "获取标准规范引用信息出现异常";
                    }                   
                    return;
                } 
            }

            if (item.DocStandards == null || item.DocStandards.Count == 0)
            {
                if (string.IsNullOrEmpty(item.MessInfo))
                {
                    item.MessInfo = "未获取到标准规范引用信息";
                }
                return;
            }
            CheckDocStandardHelper checkDocStandardHelper = new CheckDocStandardHelper();
            checkDocStandardHelper.CheckDocStandard(item.DocStandards, CheckStandardInfos, item.DocType);
            item.MessInfo = "查看详情";
        }

        public static List<StandardModel> GetStandard(string filename)
        {
            Workbook workbook = new Workbook(filename);
            Worksheet sheet = workbook.Worksheets[0];
            Cells cells = sheet.Cells;

            List<StandardModel> models = new List<StandardModel>();

            if (
                    cells[0, 1].StringValue != "状态"
                 || cells[0, 2].StringValue != "标准编号"
                 || cells[0, 3].StringValue != "标准名称"                 
                 || cells[0, 4].StringValue != "发布日期"
                 || cells[0, 5].StringValue != "实施日期"
                 || cells[0, 6].StringValue != "废止日期"
                 )
            {
                MessageBox.Show("导入的文档格式有误");
                return models;
            }

            int indexfirstrow = 1;
            int index = 0;
            for (int i = indexfirstrow; i <= cells.MaxDataRow; i++)
            {
                string StandardNo = string.Empty;
                string StandardName = string.Empty;
                string PurchasingStatus = string.Empty;
                string StandardStatus = string.Empty;
                string FileName = string.Empty;

                DateTime PublishDate = DateTime.MinValue;
                DateTime ImplementDate = DateTime.MinValue;
                DateTime RepealDate = DateTime.MinValue;

                if (cells[i, 0].Value != null)
                {
                    PurchasingStatus = cells[i, 0].Value.ToString();
                }
                if (cells[i, 1].Value != null)
                {
                    StandardStatus = cells[i, 1].Value.ToString();
                }
                if (cells[i, 2].Value != null)
                {
                    StandardNo = cells[i, 2].StringValue.Trim();
                }
                if (cells[i, 3].Value != null)
                {
                    StandardName = cells[i, 3].StringValue.Trim();
                }                
                if (cells[i, 4].Value != null)
                {
                    PublishDate = DateTime.Parse(cells[i, 4].StringValue);
                }
                if (cells[i, 5].Value != null)
                {
                    ImplementDate = DateTime.Parse(cells[i, 5].StringValue);
                }
                if (cells[i, 6].Value != null)
                {
                    RepealDate = DateTime.Parse(cells[i, 6].StringValue);
                }
                StandardModel standardModel = new StandardModel();
                standardModel.StandardNo = StandardNo;
                standardModel.StandardName = StandardName;
                standardModel.PublishDate = PublishDate;
                standardModel.ImplementDate = ImplementDate;
                standardModel.RepealDate = RepealDate;
                standardModel.PurchasingStatus = PurchasingStatus;
                standardModel.StandardStatus = StandardStatus;
                standardModel.FileName = FileName;
                standardModel.Index = index;
                standardModel.StandardIdent = GetIdent(StandardNo);
                //if (string.IsNullOrEmpty(StandardNo) || string.IsNullOrEmpty(StandardName) || PublishDate == DateTime.MinValue || RepealDate == DateTime.MinValue)
                //{
                //    continue;
                //}
                //if (models.Exists(t => t.StandardName == standardModel.StandardName) || models.Exists(t => t.StandardNo == standardModel.StandardNo))
                //{
                //    continue;
                //}
                models.Add(standardModel);
                index++;
            }
            return models;
        }

        public static string GetIdent(string str)
        {
            string strident = "";
            try
            {
                if (string.IsNullOrEmpty(str))
                {
                    return strident;
                }
                ASCIIEncoding asciiencoding = new ASCIIEncoding();
                foreach (var c in str)
                {
                    if (c == '/')
                    {
                        strident += c.ToString();
                        continue;
                    }
                    int intasciicode = (int)asciiencoding.GetBytes(c.ToString().ToUpper())[0];
                    if (intasciicode >= 65 && intasciicode <= 90)
                    {
                        strident += c.ToString();
                    }
                    else
                    {
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                strident = "";
            }
            return strident;
        }

        public static bool ExportResult(string filename, List<ItemModel> NormativeItems)
        {
            var workbook = new Workbook();
            var worksheet = workbook.Worksheets[0];
            var workCells = worksheet.Cells;
            workCells.Rows[0][0].Value = "序号";
            workCells.Rows[0][1].Value = "标准名称";
            workCells.Rows[0][2].Value = "标准编号";
            workCells.Rows[0][3].Value = "错误类型/内容";
            workCells.Rows[0][4].Value = "更正后的标准名称";
            workCells.Rows[0][5].Value = "更正后的标准编号";
            workCells.Rows[0][6].Value = "文件名称";

            int index = 1;
            foreach (var item in NormativeItems)
            {
                int firstrow = index;
                foreach (var docstandard in item.DocStandards)
                {
                    workCells.Rows[index][0].PutValue($"{index}");
                    workCells.Rows[index][1].PutValue($"{docstandard.StandardName}");
                    workCells.Rows[index][2].PutValue($"{docstandard.StandardNo}");
                    string strerrinfo = "";
                    if (docstandard.error != null && docstandard.error.Count > 0)
                    {
                        if (docstandard.error.Count == 1)
                        {
                            strerrinfo = docstandard.error[0];
                        }
                        else
                        {
                            for (int e = 0; e < docstandard.error.Count; e++)
                            {
                                strerrinfo += $"{e + 1}.{docstandard.error[e]}\n";
                            }
                            strerrinfo = strerrinfo.Trim('\n');
                        }
                    }
                    workCells.Rows[index][3].PutValue($"{strerrinfo}");
                    workCells.Rows[index][4].PutValue($"{docstandard.CorrectStandardName}");
                    workCells.Rows[index][5].PutValue($"{docstandard.CorrectStandardNo}");

                    foreach (var res in docstandard.NameResults)
                    {
                        workCells.Rows[index][1].Characters(res.startindex, res.length).Font.Color = Color.Red;
                        workCells.Rows[index][1].Characters(res.startindex, res.length).Font.Name = "宋体";
                        workCells.Rows[index][1].Characters(res.startindex, res.length).Font.Size = 11;
                    }
                    foreach (var res in docstandard.NoResults)
                    {
                        workCells.Rows[index][2].Characters(res.startindex, res.length).Font.Color = Color.Red;
                        workCells.Rows[index][2].Characters(res.startindex, res.length).Font.Name = "宋体";
                        workCells.Rows[index][2].Characters(res.startindex, res.length).Font.Size = 11;
                    }
                    foreach (var res in docstandard.CorrectNameResults)
                    {
                        workCells.Rows[index][4].Characters(res.startindex, res.length).Font.Color = Color.Green;
                        workCells.Rows[index][4].Characters(res.startindex, res.length).Font.Name = "宋体";
                        workCells.Rows[index][4].Characters(res.startindex, res.length).Font.Size = 11;
                    }
                    foreach (var res in docstandard.CorrectNoResults)
                    {
                        workCells.Rows[index][5].Characters(res.startindex, res.length).Font.Color = Color.Green;
                        workCells.Rows[index][5].Characters(res.startindex, res.length).Font.Name = "宋体";
                        workCells.Rows[index][5].Characters(res.startindex, res.length).Font.Size = 11;
                    }
                    index++;
                }
                workCells.Rows[firstrow][6].PutValue($"{item.FileName}");
                workCells.Merge(firstrow, 6, item.DocStandards.Count, 1);
            }

            var style0 = workbook.DefaultStyle;
            style0.HorizontalAlignment = TextAlignmentType.Center;
            style0.VerticalAlignment = TextAlignmentType.Center;
            style0.Font.Size = 11;
            style0.Font.Name = "宋体";
            style0.IsTextWrapped = true;
            style0.Borders[BorderType.LeftBorder].LineStyle = CellBorderType.Thin;
            style0.Borders[BorderType.RightBorder].LineStyle = CellBorderType.Thin;
            style0.Borders[BorderType.TopBorder].LineStyle = CellBorderType.Thin;
            style0.Borders[BorderType.BottomBorder].LineStyle = CellBorderType.Thin;

            var rangeinstall = workCells.CreateRange(0, 0, index, 7);
            rangeinstall.SetStyle(style0);
            rangeinstall.RowHeight = 30;

            Style stylehead = workbook.CreateStyle();
            stylehead.Copy(style0);
            stylehead.Font.IsBold = true;

            var rangehead = workCells.CreateRange(0, 0, 1, 7);
            rangehead.SetStyle(stylehead);

            worksheet.AutoFitColumns();
            workCells.Columns[0].Width = 10;
            workCells.Columns[2].Width = 40;
            workCells.Columns[5].Width = 40;
            workbook.Save(filename);
            return true;
        }

        #region MyRegion

        ///// <summary>
        ///// 解析引用行字符串，返回YinYong对象
        ///// </summary>
        ///// <param name="referenceLine">引用行字符串</param>
        ///// <returns>解析后的YinYong对象</returns>
        //public static DocStandard YinYongParse(string referenceLine)
        //{
        //    DocStandard result = new DocStandard();
        //    result.OriginalText = referenceLine ?? "";

        //    if (string.IsNullOrWhiteSpace(referenceLine))
        //        return result;

        //    string processedLine = referenceLine.Trim();

        //    // 步骤1：提取序号（支持纯数字、数字+点、中英文括号包裹）
        //    string sequencePattern = @"^([\(\（]\d+[\)\）]|\d+\.|\d+)\s*";
        //    Match sequenceMatch = Regex.Match(processedLine, sequencePattern);
        //    if (sequenceMatch.Success)
        //    {
        //        result.SequenceNumber = sequenceMatch.Groups[1].Value;
        //        processedLine = processedLine.Substring(sequenceMatch.Length).Trim();
        //    }

        //    // 步骤2：提取文件编号（核心锚点，保留原始空格）
        //    // 编号规则：字母(可含/) + 可选空格 + 数字(可含-、/、.)，可被中英文括号包裹
        //    string codePattern = @"[\(\（]?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.]\d+)*)[\)\）]?";
        //    Match codeMatch = Regex.Match(processedLine, codePattern, RegexOptions.IgnoreCase);

        //    if (codeMatch.Success)
        //    {
        //        // 提取编号（保留字母与数字间的空格，剔除外部括号）
        //        string fullCode = codeMatch.Groups[0].Value;
        //        // 移除整体包裹的括号（保留内部空格）
        //        result.FileCode = Regex.Replace(fullCode, @"^[\(\（]|[\)\）]$", "").Trim();

        //        // 分割编号左侧和右侧内容
        //        int codeEndIndex = codeMatch.Index + codeMatch.Length;
        //        string leftPart = processedLine.Substring(0, codeMatch.Index).Trim();
        //        string rightPart = processedLine.Substring(codeEndIndex).Trim();

        //        // 步骤3：提取修订信息（必须被中英文括号包裹，紧跟编号后）
        //        string revisionPattern = @"^[\s]*[\(\（](.*?)[\)\）]"; // 匹配括号内的修订信息
        //        Match revisionMatch = Regex.Match(rightPart, revisionPattern);
        //        if (revisionMatch.Success)
        //        {
        //            result.Revision = revisionMatch.Groups[1].Value.Trim();
        //            // 移除修订信息部分，剩余内容可能是名称
        //            rightPart = rightPart.Substring(revisionMatch.Length).Trim();
        //        }

        //        // 步骤4：提取文件名称（优先左侧，左侧为空则取右侧）
        //        result.FileName = !string.IsNullOrWhiteSpace(leftPart)
        //            ? CleanFileName(leftPart)
        //            : CleanFileName(rightPart);
        //    }
        //    else
        //    {
        //        // 无编号时，整行作为名称（修订信息需依附于编号，故无编号时不提取修订信息）
        //        result.FileName = CleanFileName(processedLine);
        //    }

        //    return result;
        //}

        ///// <summary>
        ///// 清理文件名（去除书名号和多余空格）
        ///// </summary>
        //private static string CleanFileName(string name)
        //{
        //    // 去除书名号（《》）
        //    string cleaned = Regex.Replace(name, @"《|》", "").Trim();
        //    // 合并多个空格为单个
        //    return Regex.Replace(cleaned, @"\s+", " ");
        //}
        #endregion

    }
}
