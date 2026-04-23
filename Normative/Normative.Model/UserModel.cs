using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Model
{
    public class UserModel
    {

        private string rtxid;

        public string RTXID
        {
            set
            {
                this.rtxid = value;
            }
            get
            {
                return this.rtxid;
            }
        }

        private string rtxName;


        public string RTXName
        {
            set
            {
                this.rtxName = value;
            }
            get
            {
                return this.rtxName;
            }
        }

        private string specialtyStr;

        public string SpecialtyStr
        {
            set
            {
                this.specialtyStr = value;
            }
            get
            {
                return this.specialtyStr;
            }
        }

        private string roleCode;
        public string RoleCode
        {
            set
            {
                this.roleCode = value;
            }
            get
            {
                return this.roleCode;
            }
        }

        private string mdb;
        public string Mdb
        {
            set
            {
                mdb = value;
            }
            get
            {
                return mdb;
            }
        }
    }
}
