using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Model
{
    public class StandardModel
    {
        public int ID { get; set; }
        public Guid StandardOID { get; set; }
        public string StandardNo { get; set; } = string.Empty;
        public string StandardName { get; set; } = string.Empty;
        public DateTime PublishDate { get; set; }
        public DateTime ImplementDate { get; set; }
        public DateTime RepealDate { get; set; }
        public string SpecialtyStr { get; set; } = string.Empty;
        public string PurchasingStatus { get; set; } = string.Empty;
        public string StandardStatus { get; set; } = string.Empty;
        public string StandardIdent { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public int Index { get; set; }
        public string MessInfo { get; set; } = string.Empty;
        public string CreateUser { get; set; } = string.Empty;
        public string ModifyUser { get; set; } = string.Empty;
        public DateTime CreateTime { get; set; }
    }
}
