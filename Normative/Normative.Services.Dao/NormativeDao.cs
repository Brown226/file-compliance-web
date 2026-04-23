using Dapper;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Dao
{
    public class NormativeDao : BaseDao
    {
        public NormativeDao(string sqlConnStr) : base(sqlConnStr)
        {

        }

        #region 规范标准
        public bool InsertSatndard(List<StandardModel> ItemModels)
        {
            try
            {
                insertSatndardInfo(ItemModels, 0);
                bool bl = this.dbHelper.ExecuteSqlTrans();
                return bl;
            }
            catch (Exception ex)
            {
                this.logUtil.Error("插入标准失败", ex);
                return false;
            }
            finally
            {
                this.ClearParas();
            }
        }

        private void insertSatndardInfo(List<StandardModel> ItemModels, int logtype)
        {
            var stringbaseitemlist = new List<string>();
            List<StandardModel> SingleItemModels = new List<StandardModel>();
            foreach (var item in ItemModels)
            {
                if (item.StandardNo.Contains("'")
                    || item.StandardName.Contains("'")
                    || item.SpecialtyStr.Contains("'")
                    || item.StandardStatus.Contains("'")
                    || item.FileName.Contains("'")
                    || item.PurchasingStatus.Contains("'")
                    )
                {
                    SingleItemModels.Add(item);
                    continue;
                }
                Guid Oid = Guid.Empty;
                string strPublishDate = "null";
                string strImplementDate = "null";
                string strRepealDate = "null";
                if (item.PublishDate != DateTime.MinValue)
                {
                    strPublishDate = $"'{item.PublishDate}'";
                }
                if (item.ImplementDate != DateTime.MinValue)
                {
                    strImplementDate = $"'{item.ImplementDate}'";
                }
                if (item.RepealDate != DateTime.MinValue)
                {
                    strRepealDate = $"'{item.RepealDate}'";
                }
                if (logtype == 0)
                {
                    Oid = Guid.NewGuid();
                    stringbaseitemlist.Add($"('{Oid}','{item.StandardNo}','{item.StandardName}',{strPublishDate},{strImplementDate},{strRepealDate},'{item.SpecialtyStr}',GetDate(),'{item.CreateUser}','{item.PurchasingStatus}','{item.StandardStatus}','{item.FileName}','{item.StandardIdent}')");
                }
                else
                {
                    Oid = item.StandardOID;
                    stringbaseitemlist.Add($"('{Oid}','{item.StandardNo}','{item.StandardName}',{strPublishDate},{strImplementDate},{strRepealDate},'{item.SpecialtyStr}','{item.CreateTime}','{item.CreateUser}','{item.PurchasingStatus}','{item.StandardStatus}','{item.FileName}',GetDate(),'{item.ModifyUser}',{logtype},'{item.StandardIdent}')");
                }
            }
            string batchsql = NormativeSql.BatchInsertStandardSql;
            if (logtype > 0)
            {
                batchsql = NormativeSql.BatchInsertStandardLogSql;
            }
            this.BatchInsert(stringbaseitemlist, batchsql);
            if (SingleItemModels.Count > 0)
            {
                foreach (var item in SingleItemModels)
                {
                    DynamicParameters param = new DynamicParameters();
                    Guid Oid = Guid.NewGuid();
                    DateTime? dtPublishDate = null;
                    DateTime? dtImplementDate = null;
                    DateTime? dtRepealDate = null;
                    if (item.PublishDate != DateTime.MinValue)
                    {
                        dtPublishDate = item.PublishDate;
                    }
                    if (item.ImplementDate != DateTime.MinValue)
                    {
                        dtImplementDate = item.ImplementDate;
                    }
                    if (item.RepealDate != DateTime.MinValue)
                    {
                        dtRepealDate = item.RepealDate;
                    }
                    param.Add("@StandardOID", Oid);
                    param.Add("@StandardNo", item.StandardNo);
                    param.Add("@StandardName", item.StandardName);
                    param.Add("@PublishDate", dtPublishDate);
                    param.Add("@ImplementDate", dtImplementDate);
                    param.Add("@RepealDate", dtRepealDate);
                    param.Add("@SpecialtyStr", item.SpecialtyStr);
                    param.Add("@CreateUser", item.CreateUser);
                    param.Add("@PurchasingStatus", item.PurchasingStatus);
                    param.Add("@StandardStatus", item.StandardStatus);
                    param.Add("@FileName", item.FileName);
                    param.Add("@StandardIdent", item.StandardIdent);
                    string sql = NormativeSql.InsertStandardSql;
                    if (logtype > 0)
                    {
                        param.Add("@CreateTime", item.CreateTime);
                        param.Add("@ModifyUser", item.ModifyUser);
                        param.Add("@LogType", logtype);
                        sql = NormativeSql.InsertStandardLogSql;
                    }
                    this.dbHelper.AddTranSql(sql, param);
                }
            }
        }

        public List<StandardModel> GetStandardModels()
        {
            try
            {
                List<StandardModel> res = new List<StandardModel>();
                DynamicParameters param = new DynamicParameters();
                string sql = NormativeSql.GetStandardSql;
                res = this.dbHelper.ExecuteToModelList<StandardModel>(sql, param);
                return res;
            }
            catch (Exception ex)
            {
                this.logUtil.Error("获取标准失败", ex);
                return null;
            }
            finally
            {
                this.ClearParas();
            }
        }

        public ApiResult DelStandards(List<Guid> StandardOids, string currentuser)
        {
            try
            {
                ApiResult apiResult = new ApiResult();
                apiResult.Code = 1;
                List<StandardModel> delmodels = this.BatchSelectBySingle<StandardModel, Guid>(StandardOids, NormativeSql.GetStandardByOidSql, "@StandardOIDs", null);
                if (delmodels == null || delmodels.Count == 0)
                {
                    apiResult.Msg = "获取要删除的标准失败";
                    return apiResult;
                }
                delmodels.ForEach(t => t.ModifyUser = currentuser);
                insertSatndardInfo(delmodels, 1);
                List<KeyValObjModel> paramlist = new List<KeyValObjModel>();
                KeyValObjModel parammodel = new KeyValObjModel();
                parammodel.Key = "@ModifyUser";
                parammodel.Value = currentuser;
                paramlist.Add(parammodel);
                this.BatchUpdateBySingle(StandardOids, NormativeSql.DelStandardSql, "@StandardOIDs", paramlist);
                bool bl = this.dbHelper.ExecuteSqlTrans();
                if (bl)
                {
                    apiResult.Code = 0;
                }
                else
                {
                    apiResult.Msg = "删除标准失败";
                }
                return apiResult;
            }
            catch (Exception ex)
            {
                this.logUtil.Error("删除标准失败", ex);
                return null;
            }
            finally
            {
                this.ClearParas();
            }
        }
        #endregion

        #region 获取用户及角色
        public UserModel GetUserModel(string currentuser)
        {
            try
            {
                DynamicParameters param = new DynamicParameters();
                param.Add("@RTXID", currentuser);
                var result = this.dbHelper.ExecuteToModel<UserModel>(NormativeSql.GetUserSql, param);
                return result;
            }
            catch (Exception ex)
            {
                this.logUtil.ErrorFormat("获取人员列表失败，{0}", ex.ToString());

                return null;
            }
            finally
            {
                this.ClearParas();
            }
        }

        public List<EnumModel> GetEnumModels(string enumType)
        {
            try
            {
                DynamicParameters param = new DynamicParameters();
                var sql = NormativeSql.GetEnumsSql;
                if (!string.IsNullOrEmpty(enumType))
                {
                    sql += " and [Enums].[EnumType]= @EnumType";
                    param.Add("EnumType", enumType);
                }
                var models = this.dbHelper.ExecuteToModelList<EnumModel>(sql, param);
                if (models != null)
                {
                    return models;
                }
                else
                {
                    return new List<EnumModel>();
                }
            }
            catch (Exception ex)
            {
                this.logUtil.ErrorFormat("获取枚举值失败，{0}", ex.ToString());
                return new List<EnumModel>();
            }
            finally
            {
                this.ClearParas();
            }
        }
        #endregion

        #region 版本
        public string GetCurrentPubVersion()
        {
            try
            {
                var result = this.dbHelper.ExecuteToModel<string>(NormativeSql.GetSoftVersionSql, null);
                return result;
            }
            catch (Exception ex)
            {
                this.logUtil.ErrorFormat("获取版本失败，{0}", ex.ToString());
                return string.Empty;
            }
            finally
            {
                this.ClearParas();
            }
        }
        #endregion
    }
}
