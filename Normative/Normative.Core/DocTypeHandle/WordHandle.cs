using Aspose.Words;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Normative.Core
{
    [DocType("WORD")]
    public class WordHandle : DocHandleBase
    {
        public WordHandle(ItemModel item, List<string> standardIdents) : base(item, standardIdents)
        {

        }

        public override void GetDocTxt()
        {
            this.docitem.DocStandards = new List<DocStandard>();
            Document doc = new Document(docitem.FilePath);

            foreach (Section section in doc.Sections)
            {
                try
                {
                    var nodes = section.GetChildNodes(NodeType.Paragraph, true);
                    foreach (Paragraph node in nodes)
                    {
                        string prargstr = node.GetText();
                        if (string.IsNullOrEmpty(prargstr))
                        {
                            continue;
                        }
                        GetDocStandards(prargstr);
                    }
                }
                catch (Exception)
                {

                }
            }
        }
    }
}
