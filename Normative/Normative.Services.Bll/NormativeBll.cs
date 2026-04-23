using Normative.Dao;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Bll
{
    public class NormativeBll
    {
        private readonly NormativeDao dao;

        public NormativeBll()
        {
            try
            {
                dao = new NormativeDao($"Resource");
            }
            catch (Exception ex)
            {
                
            }
        }

        public bool InsertSatndard(List<StandardModel> ItemModels)
        {
            return this.dao.InsertSatndard(ItemModels);
        }

        public List<StandardModel> GetStandardModels()
        {
            return this.dao.GetStandardModels();
        }

        public ApiResult DelStandards(List<Guid> StandardOids, string currentuser)
        {
            return this.dao.DelStandards(StandardOids, currentuser);
        }

        public UserModel GetUserModel(string currentuser)
        {
            return this.dao.GetUserModel(currentuser);
        }

        public List<EnumModel> GetEnumModels(string enumType)
        {
            return this.dao.GetEnumModels(enumType);
        }

        public string GetCurrentPubVersion()
        {
            return this.dao.GetCurrentPubVersion();
        }
    }
}
