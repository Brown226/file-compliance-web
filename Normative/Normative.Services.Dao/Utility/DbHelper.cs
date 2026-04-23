using Dapper;
using log4net;
using Microsoft.Win32.SafeHandles;
using StackExchange.Profiling;
using StackExchange.Profiling.Storage;
using System;
using System.Collections.Generic;
using System.Data;
using System.Dynamic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;

namespace Normative.Dao
{
    public class TransSql
    {
        public string Sql { get; set; }
        public object Param { get; set; }
    }

    public class DbHelper
    {
        private ILog logUtil = null;
        public List<TransSql> tranSqls = new List<TransSql>();
        private string sqlConnStr = string.Empty;

        public DbHelper(string sqlConnStr)
        {
            this.logUtil = LogManager.GetLogger("Debuge");
            this.sqlConnStr = sqlConnStr;
        }

        /// <summary>
        /// 执行一个SQL语句 增 改 删.
        /// </summary>
        /// <param name="sql">The SQL.</param>
        /// <param name="obj">Model对象</param>
        /// <returns>影响的行数</returns>
        public int ExecuteSql(string sql, object obj)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Execute(sql, obj);
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        private void WriteLog(MiniProfiler profiler)
        {
            if (profiler?.Root != null)
            {
                var root = profiler.Root;

                if (root.HasChildren)
                {
                    root.Children.ForEach(
                        chil =>
                            {
                                if (chil.CustomTimings?.Count > 0)
                                {
                                    int index = 0;
                                    foreach (var chilCustomTiming in chil.CustomTimings)
                                    {
                                        chilCustomTiming.Value?.ForEach(
                                            value =>
                                                {
                                                    var log = $@"
【{chilCustomTiming.Key}{index++}】
{value.CommandString}
Exeute time {value.DurationMilliseconds}ms 
Start offset:{value.StartMilliseconds} ms
Errored:{value.Errored}
";
                                                    this.logUtil.Error(log);
                                                });
                                    }
                                }
                            });
                }
            }

        }
        /// <summary>
        /// 批量执行SQL.
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="sql">The SQL.</param>
        /// <param name="list">对象列表.</param>
        /// <returns></returns>
        public int ExecuteSql<T>(string sql, List<T> list)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Execute(sql, list);
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        public IEnumerable<T> Query<T>(string sql, DynamicParameters p)
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Query<T>(sql, p);
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        /// <summary>
        /// 执行一个SQL语句 增 改 删.
        /// </summary>
        /// <param name="sql">The SQL.</param>
        /// <param name="p">参数.</param>
        /// <returns></returns>
        public int ExecuteSql(string sql, DynamicParameters p)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Execute(sql, p);
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }
        }
        /// <summary>
        /// 执行事务
        /// </summary>
        /// <param name="list">事务列表</param>
        /// <exception cref="System.Exception"></exception>   
        public bool ExecuteSqlTrans()
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(sqlConnStr))
                    {
                        conn.Open();
                        using (var transaction = conn.BeginTransaction())
                        {
                            try
                            {
                                foreach (var sqlExcue in tranSqls)
                                {
                                    conn.Execute(sqlExcue.Sql, sqlExcue.Param, transaction);
                                }

                                transaction.Commit();
                                return true;
                            }
                            catch (Exception ex)
                            {
                                transaction.Rollback();
                                throw ex;
                            }
                            finally
                            {
                                tranSqls.Clear();
                                if (conn.State == ConnectionState.Open)
                                {
                                    conn.Close();
                                }
                            }
                        }
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }


        public bool ExecuteSqlTrans(out string error)
        {
            error = "";
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(sqlConnStr))
                    {
                        conn.Open();
                        using (var transaction = conn.BeginTransaction())
                        {
                            try
                            {
                                foreach (var sqlExcue in tranSqls)
                                {
                                    int obj = conn.Execute(sqlExcue.Sql, sqlExcue.Param, transaction);
                                    if (sqlExcue.Sql.Contains("UPDATE dbo.AtlasInfos") && obj == 0)
                                    {
                                        transaction.Rollback();
                                        error = "生成卷册流水号失败";
                                        return false;
                                    }
                                }

                                transaction.Commit();
                                return true;
                            }
                            catch (Exception ex)
                            {
                                transaction.Rollback();
                                throw ex;
                            }
                            finally
                            {
                                tranSqls.Clear();
                                if (conn.State == ConnectionState.Open)
                                {
                                    conn.Close();
                                }
                            }
                        }
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }

        /// <summary>
        /// 执行事务
        /// </summary>
        /// <param name="list">事务列表</param>
        /// <exception cref="System.Exception"></exception>   
        public bool ExecuteSqlTrans(List<object[]> list)
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        conn.Open();
                        using (var transaction = conn.BeginTransaction())
                        {
                            try
                            {
                                foreach (var sqlExcue in list)
                                {
                                    conn.Execute((string)sqlExcue[0], sqlExcue[1], transaction);
                                }

                                transaction.Commit();

                                return true;
                            }
                            catch (Exception ex)
                            {
                                transaction.Rollback();

                                return false;
                            }
                            finally
                            {

                                tranSqls.Clear();

                                if (conn.State == ConnectionState.Open)
                                {
                                    conn.Close();
                                }
                            }
                        }
                    }
                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        /// <summary>
        /// 执行事务
        /// </summary>
        /// <param name="list">事务列表</param>
        /// <exception cref="System.Exception"></exception>   
        public bool ExecuteSqlTrans(List<object[]> list, out string error)
        {
            error = string.Empty;
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        conn.Open();
                        var transaction = conn.BeginTransaction();

                        try
                        {
                            foreach (var sqlExcue in list)
                            {
                                conn.Execute((string)sqlExcue[0], sqlExcue[1], transaction);
                            }

                            transaction.Commit();

                            return true;
                        }
                        catch (Exception ex)
                        {
                            transaction.Rollback();
                            error = ex.ToString();

                            return false;
                        }
                        finally
                        {
                            tranSqls.Clear();

                            if (conn.State == ConnectionState.Open)
                            {
                                conn.Close();
                            }
                        }
                    }
                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }

        /// <summary>
        /// 查询至对象.
        /// </summary>
        /// <typeparam name="T">对象类</typeparam>
        /// <param name="sql">The SQL.</param>
        /// <param name="p">参数.</param>
        /// <returns></returns>
        public T ExecuteToModel<T>(string sql, DynamicParameters p)
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Query<T>(sql, p).FirstOrDefault();
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        /// <summary>
        /// 查询至对象列表.
        /// </summary>
        /// <typeparam name="T">对象类</typeparam>
        /// <param name="sql">The SQL.</param>
        /// <param name="p">参数.</param>
        /// <returns></returns>
        public List<T> ExecuteToModelList<T>(string sql, DynamicParameters p)
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Query<T>(sql, p).ToList<T>();
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }

        public List<T> ExecuteToModelList<T>(string sql, object p)
        {

#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.Query<T>(sql, p).ToList<T>();
                    }

                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }

        }
        public List<T> ExecuteToModelList<T>(string sql)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        var mulit = conn.QueryMultiple(sql);
                        var results = new List<T>();

                        while (!mulit.IsConsumed)
                        {
                            var res = mulit.Read<T>().ToList();

                            if (res != null)
                            {
                                results.AddRange(res);
                            }
                        }

                        return results;
                    }
                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }

        public object ExecuteSqlScalar(string sql, DynamicParameters p)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.ExecuteScalar(sql, p);
                    }
                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }
        public object ExecuteSqlScalar(string sql, object p)
        {
#if DEBUG
            var profiler = MiniProfiler.StartNew("ExecuteSql");
            using (profiler.Step("ExecuteSql"))
            {
#endif
                try
                {
                    using (IDbConnection conn = DbFactory.GetConnection(this.sqlConnStr))
                    {
                        return conn.ExecuteScalar(sql, p);
                    }
                }
                finally
                {
#if DEBUG
                    WriteLog(profiler);
                }
#endif
            }


        }

        public void AddTranSql(string sql,
                               object param)
        {
            tranSqls.Add(new TransSql() { Sql = sql, Param = param });
        }
    }
}