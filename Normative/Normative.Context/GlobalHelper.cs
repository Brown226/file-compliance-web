using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Normative.Context
{
    public static class GlobalHelper
    {
        #region 读写文件
        public static void appendfile(string filepath, string strdata)
        {
            try
            {
                using (FileStream fs = new FileStream(filepath, FileMode.Append))
                {
                    using (StreamWriter writer = new StreamWriter(fs, Encoding.UTF8))
                    {
                        writer.WriteLine(strdata);
                    }
                }
            }
            catch (Exception ex)
            {
            }
        }

        #endregion

        #region 记录日志
        public static void appendlog(string strdata)
        {
            try
            {
                StringBuilder s = new StringBuilder();
                s.AppendLine($"时间：{DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss")}");
                s.AppendLine($"信息：{strdata}");
                s.AppendLine($"*****************************************************************************************************************************************************************************************");
                s.AppendLine();
                if (!Directory.Exists(AppContextInfo.Instance.LogDir))
                {
                    Directory.CreateDirectory(AppContextInfo.Instance.LogDir);
                }
                string logpath = Path.Combine(AppContextInfo.Instance.LogDir, $"Log_{AppContextInfo.Instance.CurrentUser}.log");
                appendfile(logpath, s.ToString());
            }
            catch (Exception ex)
            {

            }
        }
        #endregion


    }
}
