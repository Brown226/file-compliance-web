using Aspose.Cells;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Normative.Core
{
    [DocType("EXCEL")]
    public class ExcelHandle : DocHandleBase
    {
        public ExcelHandle(ItemModel item, List<string> standardIdents) : base(item, standardIdents)
        {

        }

        public override void GetDocTxt()
        {
            Workbook workbook = new Workbook(this.docitem.FilePath);
            Worksheet worksheet = workbook.Worksheets[0];
            Cells cells = worksheet.Cells;
            this.docitem.DocStandards = new List<DocStandard>();

            for (int r = 4; r < cells.MaxDataRow; r++)
            {
                if (cells[r, 7].Value == null)
                {
                    continue;
                }
                string strval = cells[r, 7].Value.ToString();
                string codePattern = @"[\(\（]?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.]\d+)*)[\)\）]?([\(\（].*[\)\）])?";
                var codeMatchs = Regex.Matches(strval, codePattern, RegexOptions.IgnoreCase | RegexOptions.Multiline);
                if (codeMatchs != null && codeMatchs.Count > 0)
                {
                    foreach (Match codeMatch in codeMatchs)
                    {
                        string fullCode = codeMatch.Groups[0].Value;
                        if (!this.checkstandardidents.Exists(t => fullCode.StartsWith(t)))
                        {
                            continue;
                        }
                        if (this.docitem.DocStandards.Exists(t => t.StandardNo == fullCode.Trim()))
                        {
                            continue;
                        }
                        DocStandard docStandard = new DocStandard();
                        docStandard.StandardNo = fullCode.Trim();
                        docStandard.StandardIdent = NormativeHelper.GetIdent(docStandard.StandardNo);
                        this.docitem.DocStandards.Add(docStandard);
                    }
                }
            }
        }
    }
}
