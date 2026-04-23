using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.ServiceModel;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Services.Contracts
{
    [ServiceContract]
    public interface INormativeServices
    {
        [OperationContract]
        bool InsertSatndard(List<StandardModel> ItemModels);

        [OperationContract]
        List<StandardModel> GetStandardModels();

        [OperationContract]
        ApiResult DelStandards(List<Guid> StandardOids, string currentuser);

        [OperationContract]
        UserModel GetUserModel(string currentuser);

        [OperationContract]
        List<EnumModel> GetRoleEnumModels(string EnumType);

        [OperationContract]
        string GetCurrentPubVersion();

    }
}
