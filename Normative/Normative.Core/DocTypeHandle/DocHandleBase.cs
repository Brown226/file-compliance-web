using Normative.Model;
using System;
using System.Collections.Generic;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Normative.Core
{
    public abstract class DocHandleBase
    {
        protected ItemModel docitem;
        protected List<string> checkstandardidents;
        public DocHandleBase(ItemModel item, List<string> standardIdents)
        {
            this.docitem = item;
            checkstandardidents = standardIdents;
        }

        public abstract void GetDocTxt();

        public void GetDocStandards(string strval)
        {
            string codePattern = @"《.*?》(\s+)?[\(\（]?(\s+)?([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)\）]?([\(\（].*[\)\）])?";
            var codeMatchs = Regex.Matches(strval, codePattern, RegexOptions.IgnoreCase | RegexOptions.Multiline);
            if (codeMatchs != null && codeMatchs.Count > 0)
            {
                foreach (Match codeMatch in codeMatchs)
                {
                    string fullCode = codeMatch.Groups[0].Value;
                    string[] arr = fullCode.Split('》');
                    DocStandard docStandard = new DocStandard();
                    string strStandardName = arr[arr.Length - 2].Trim().Trim('《');
                    int indexn = strStandardName.LastIndexOf("《");
                    if (indexn > -1)
                    {
                        strStandardName = strStandardName.Substring(indexn + 1);
                    }
                    string strno = arr[arr.Length - 1].Trim();
                    if (strno.StartsWith("(") || strno.StartsWith("（"))
                    {
                        strno = strno.Substring(1);
                        int index = strno.IndexOf(")");
                        if (index < 0)
                        {
                            index = strno.IndexOf("）");
                        }
                        if (index > 0)
                        {
                            strno = strno.Substring(0, index) + strno.Substring(index + 1);
                        }
                    }
                    if (this.docitem.DocStandards.Exists(t => t.StandardNo == strno && t.StandardName == strStandardName))
                    {
                        continue;
                    }
                    docStandard.StandardNo = strno.Trim();
                    docStandard.StandardName = strStandardName.Trim();
                    docStandard.StandardIdent = NormativeHelper.GetIdent(docStandard.StandardNo);
                    this.docitem.DocStandards.Add(docStandard);
                }
            }
        }
    }
}
