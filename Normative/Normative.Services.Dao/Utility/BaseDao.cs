using Dapper;
using log4net;
using System.Collections.Generic;
using System;
using Normative.Model;

namespace Normative.Dao
{
    public class BaseDao
    {
        protected DbHelper dbHelper = null;

        protected ILog logUtil = null;

        // protected DbHelper dbHelper = null;
        /// <summary>
        /// 参数列表
        /// </summary>
        protected DynamicParameters p = new DynamicParameters();

        public BaseDao(string sqlConnStr)
        {
            this.logUtil = LogManager.GetLogger("log");
            this.dbHelper = new DbHelper(sqlConnStr);
        }

        public void ClearParas()
        {
            this.p = null;
            this.p = new DynamicParameters();
        }

        public void BatchInsert(List<string> strlist, string strsql)
        {
            if (strlist == null || strlist.Count == 0)
            {
                return;
            }
            for (int i = 0; i < Math.Floor(strlist.Count / 1000.0); ++i)
            {
                this.dbHelper.tranSqls.Add(
                    new TransSql
                    {
                        Sql = strsql + string.Join(",", strlist.GetRange(i * 1000, 1000).ToArray())
                    });
            }

            var startindex = (int)Math.Floor(strlist.Count / 1000.0) * 1000;
            var count = strlist.Count - startindex;
            this.dbHelper.tranSqls.Add(
                    new TransSql
                    {
                        Sql = strsql + string.Join(",", strlist.GetRange(startindex, count).ToArray())
                    });
        }

        public void BatchUpdateBySingle<T>(List<T> strlist, string strsql, string Datafiled, List<KeyValObjModel> paramlist)
        {
            DynamicParameters param = new DynamicParameters();
            var groupcount = strlist.Count / 1000;
            for (int i = 0; i < groupcount; i++)
            {
                var subrefs = strlist.GetRange(i * 1000, 1000);
                param.Add(Datafiled, subrefs);
                if (paramlist != null && paramlist.Count > 0)
                {
                    foreach (var paramitem in paramlist)
                    {
                        param.Add(paramitem.Key, paramitem.Value);
                    }
                }
                this.dbHelper.AddTranSql(strsql, param);
                param = new DynamicParameters();
            }
            var lastcount = strlist.Count - groupcount * 1000;
            if (lastcount > 0)
            {
                var lastrefs = strlist.GetRange(groupcount * 1000, lastcount);
                param.Add(Datafiled, lastrefs);
                if (paramlist != null && paramlist.Count > 0)
                {
                    foreach (var paramitem in paramlist)
                    {
                        param.Add(paramitem.Key, paramitem.Value);
                    }
                }
                this.dbHelper.AddTranSql(strsql, param);
            }
        }

        public List<T> BatchSelectBySingle<T, A>(List<A> strlist, string strsql, string Datafiled, List<KeyValObjModel> paramlist)
        {
            List<T> res = new List<T>();
            DynamicParameters param = new DynamicParameters();
            var groupcount = strlist.Count / 1000;
            for (int i = 0; i < groupcount; i++)
            {
                var subrefs = strlist.GetRange(i * 1000, 1000);
                param.Add(Datafiled, subrefs);
                if (paramlist != null && paramlist.Count > 0)
                {
                    foreach (var paramitem in paramlist)
                    {
                        param.Add(paramitem.Key, paramitem.Value);
                    }
                }
                res.AddRange(this.dbHelper.Query<T>(strsql, param));
                param = new DynamicParameters();
            }
            var lastcount = strlist.Count - groupcount * 1000;
            if (lastcount > 0)
            {
                var lastrefs = strlist.GetRange(groupcount * 1000, lastcount);
                param.Add(Datafiled, lastrefs);
                if (paramlist != null && paramlist.Count > 0)
                {
                    foreach (var paramitem in paramlist)
                    {
                        param.Add(paramitem.Key, paramitem.Value);
                    }
                }
                res.AddRange(this.dbHelper.Query<T>(strsql, param));
            }
            return res;
        }

    }
}