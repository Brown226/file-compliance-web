using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Model
{
    public class ItemModel
    {
        public string FileName { get; set; }

        public string FilePath { get; set; }

        public DocTypeEnums DocType { get; set; }

        public string StrDocType
        {
            get
            {
                switch (DocType)
                {
                    case DocTypeEnums.dwg:
                        return "DWG";
                    case DocTypeEnums.pdf:
                        return "PDF";
                    case DocTypeEnums.word:
                        return "WORD";
                    case DocTypeEnums.excel:
                        return "EXCEL";
                    default:
                        return "未知";
                }
            }
        }

        public string MessInfo { get; set; }

        public List<DocStandard> DocStandards { get; set; }

        public string FileNameInfo { get; set; }

    }

    public class DocStandard
    {
        public string StandardNo { get; set; } = string.Empty;

        public string StandardIdent { get; set; } = string.Empty;

        public string StandardName { get; set; } = string.Empty;

        public string CorrectStandardNo { get; set; } = string.Empty;

        public string CorrectStandardName { get; set; } = string.Empty;

        public List<string> error { get; set; } = new List<string>();

        public List<CharResult> NoResults { get; set; } = new List<CharResult>();

        public List<CharResult> CorrectNoResults { get; set; } = new List<CharResult>();

        public List<CharResult> NameResults { get; set; } = new List<CharResult>();

        public List<CharResult> CorrectNameResults { get; set; } = new List<CharResult>();

        public string errorinfo
        {
            get
            {
                return string.Join("；", error);
            }
        }

    }


    public class CharResult
    {
        public int startindex = 0;
        public int length = 0;
    }


    public class StandardSimilarity
    {
        public string StandardNo { get; set; } = string.Empty;

        public string StandardName { get; set; } = string.Empty;

        public double Similarity { get; set; }

        public double StandardNoSimilarity { get; set; }

        public double StandardNameSimilarity { get; set; }

        public bool isreplase { get; set; }

    }

}
