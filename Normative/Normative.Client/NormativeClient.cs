using Normative.Context;
using Normative.Model;
using Normative.Services.Contracts;
using System;
using System.Collections.Generic;
using System.Linq;
using System.ServiceModel;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Client
{
    public class NormativeClient
    {
        #region 初始化

        private INormativeServices serviceProxy;

        //private const string ConfigFileName = "Client.config";

        private NormativeClient()
        {
            this.serviceProxy = new BaseClient<INormativeServices>().CreateProxy();
        }

        private static NormativeClient instance;

        public static NormativeClient Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new NormativeClient();
                }

                return instance;
            }
        }
        #endregion

        public bool InsertSatndard(List<StandardModel> ItemModels)
        {
            try
            {
                return this.serviceProxy.InsertSatndard(ItemModels);
            }
            catch (Exception e)
            {
                GlobalHelper.appendlog(e.ToString());
                return false;
            }
        }

        public List<StandardModel> GetStandardModels()
        {
            try
            {
                return this.serviceProxy.GetStandardModels();
            }
            catch (Exception e)
            {
                GlobalHelper.appendlog(e.ToString());
                return new List<StandardModel>();
            }
        }

        public ApiResult DelStandards(List<Guid> StandardOids)
        {
            try
            {
                return this.serviceProxy.DelStandards(StandardOids, AppContextInfo.Instance.CurrentUser);
            }
            catch (Exception e)
            {
                GlobalHelper.appendlog(e.ToString());
                return null;
            }
        }


        public UserModel GetUserModel()
        {
            try
            {
                return this.serviceProxy.GetUserModel(AppContextInfo.Instance.CurrentUser);
            }
            catch (Exception ex)
            {
                GlobalHelper.appendlog(ex.ToString());
                return null;
            }
        }

        public List<EnumModel> GetRoleEnumModels(string EnumType)
        {
            try
            {
                return this.serviceProxy.GetRoleEnumModels(EnumType);
            }
            catch (Exception ex)
            {
                GlobalHelper.appendlog(ex.ToString());
                return new List<EnumModel>();
            }
        }

        public string GetCurrentPubVersion()
        {
            try
            {
                return this.serviceProxy.GetCurrentPubVersion();
            }
            catch (Exception ex)
            {
                GlobalHelper.appendlog(ex.ToString());
                return null;
            }
        }

    }
}
