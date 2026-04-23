using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Core
{
    [AttributeUsage(AttributeTargets.Class)]
    public class DocTypeAttribute : System.Attribute
    {
        public DocTypeAttribute(params string[] paramnames)
        {
            AttriNames = new List<string>();

            foreach (var c in paramnames)
            {
                AttriNames.Add(c);
            }
        }

        public List<string> AttriNames { get; set; }

    }
}
