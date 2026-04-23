using Aspose.Words;
using Normative.Model;
using Spire.Pdf;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Core
{
    [DocType("PDF")]
    public class PdfHandle : DocHandleBase
    {
        public PdfHandle(ItemModel item, List<string> standardIdents) : base(item, standardIdents)
        {

        }

        public override void GetDocTxt()
        {
            this.docitem.DocStandards = new List<DocStandard>();
            using (var doc = new PdfDocument())
            {
                doc.LoadFromFile(this.docitem.FilePath);
                var image = doc.SaveAsImage(0, 500, 500);
                int rectwidth = 3200;
                int rectheight = 3000;
                int imgheight = image.Height;

                using (Bitmap original = new Bitmap(image))
                {
                    List<Rectangle> rects = new List<Rectangle>();
                    int y = 900;
                    while (y + 3000 < imgheight)
                    {
                        Rectangle rect = new Rectangle(900, y, rectwidth, rectheight);
                        rects.Add(rect);
                        y += 3000 - 100;
                    }

                    if (imgheight - y > 1000)
                    {
                        int lastheight = imgheight - y - 500;
                        Rectangle rect = new Rectangle(900, y, rectwidth, lastheight);
                        rects.Add(rect);
                    }
                    foreach (var rect in rects)
                    {
                        using (Bitmap subImage = original.Clone(rect, original.PixelFormat))
                        {
                            var ocrResult = NormativeDataHelper.Instance.OcrEngine.DetectText(subImage);
                            if (ocrResult != null && ocrResult.TextBlocks != null && ocrResult.TextBlocks.Count > 0)
                            {
                                foreach (var tb in ocrResult.TextBlocks)
                                {
                                    if (string.IsNullOrEmpty(tb.Text))
                                    {
                                        continue;
                                    }
                                    string tbstr = tb.Text.Trim().Replace("—", "-").Replace("一", "-").Replace("－", "-");
                                    GetDocStandards(tbstr);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
