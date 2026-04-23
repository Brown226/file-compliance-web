using Aspose.CAD;
using Aspose.CAD.FileFormats.Cad;
using Aspose.CAD.FileFormats.Cad.CadObjects;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.Remoting.Contexts;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;


namespace Normative.Core
{
    [DocType("DWG")]
    public class DwgHandle : DocHandleBase
    {
        public DwgHandle(ItemModel item, List<string> standardIdents) : base(item, standardIdents)
        {

        }

        public override void GetDocTxt()
        {
            this.docitem.DocStandards = new List<DocStandard>();          
            using (CadImage cadimg = (CadImage)Image.Load(docitem.FilePath))
            {
                foreach (CadBaseEntity entity in cadimg.Entities)
                {
                    string strval = string.Empty;
                    if (entity is CadText text)
                    {
                        strval = text.DefaultValue;
                    }
                    else if (entity is CadMText mtext)
                    {
                        strval = mtext.FullClearText;
                    }
                    if (string.IsNullOrEmpty(strval))
                    {
                        continue;
                    }
                    GetDocStandards(strval);
                }
            }
        }
    }
}
