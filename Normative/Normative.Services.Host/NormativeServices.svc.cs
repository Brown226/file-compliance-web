using Normative.Bll;
using Normative.Model;
using Normative.Services.Contracts;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.Serialization;
using System.Security.AccessControl;
using System.ServiceModel;
using System.Text;

namespace Normative.Host
{
    // 注意: 使用“重构”菜单上的“重命名”命令，可以同时更改代码、svc 和配置文件中的类名“NormativeServices”。
    // 注意: 为了启动 WCF 测试客户端以测试此服务，请在解决方案资源管理器中选择 NormativeServices.svc 或 NormativeServices.svc.cs，然后开始调试。
    public class NormativeServices : INormativeServices
    {

        public bool InsertSatndard(List<StandardModel> ItemModels)
        {
            return new NormativeBll().InsertSatndard(ItemModels);
        }

        public List<StandardModel> GetStandardModels()
        {
            return new NormativeBll().GetStandardModels();
        }

        public ApiResult DelStandards(List<Guid> StandardOids, string currentuser)
        {
            return new NormativeBll().DelStandards(StandardOids, currentuser);
        }

        public UserModel GetUserModel(string currentuser)
        {
            return new NormativeBll().GetUserModel(currentuser);
        }

        public List<EnumModel> GetRoleEnumModels(string EnumType)
        {
            return new NormativeBll().GetEnumModels(EnumType);
        }

        public string GetCurrentPubVersion()
        {
            return new NormativeBll().GetCurrentPubVersion();
        }
    }
}
