using StackExchange.Profiling;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;

namespace Normative.Dao
{
    public class DbFactory
    {
        public static IDbConnection GetConnection(string dbConnStr)
        {
            var sqlConnection =
              new SqlConnection(ConfigurationManager.ConnectionStrings[dbConnStr].ToString());
#if DEBUG
            //sqlConnection.Open();
            return new StackExchange.Profiling.Data.ProfiledDbConnection(sqlConnection, MiniProfiler.Current);
#else
            return sqlConnection;
#endif

        }
    }
}