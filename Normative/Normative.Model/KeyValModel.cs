using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Model
{
    public class KeyValModel
    {
        public string Key { get; set; }

        public string Value { get; set; }

        public int ValueData { get; set; }

    }

    public class KeyValObjModel
    {
        public string Key { get; set; }

        public object Value { get; set; }
    }

    public class OldAndVewVal
    {
        public string OldVal { get; set; }

        public string NewVal { get; set; }

    }
}
