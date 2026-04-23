using Normative.Context;
using Normative.Core;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Normative
{
    internal static class Program
    {
        /// <summary>
        /// 应用程序的主入口点。
        /// </summary>
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                if (string.IsNullOrEmpty(System.Environment.UserName))
                {
                    MessageBox.Show("获取域账号失败");
                    return;
                }
                AppContextInfo.Instance.CurrentUser = System.Environment.UserName.ToUpper();
                string checkvererror = UIMarkHelper.CheckVersion();
                if (!string.IsNullOrEmpty(checkvererror))
                {
                    MessageBox.Show(checkvererror);
                    return;
                }              
                if (NormativeDataHelper.Instance.CurrentUserModel == null
                    || string.IsNullOrEmpty(NormativeDataHelper.Instance.CurrentUserModel.RTXID)
                    || string.IsNullOrEmpty(NormativeDataHelper.Instance.CurrentUserModel.RoleCode)
                    || !NormativeDataHelper.Instance.RoleEnums.Any(t => NormativeDataHelper.Instance.CurrentUserModel.RoleCode.Contains(t.ValueCode)))
                {
                    MessageBox.Show($"您好，{AppContextInfo.Instance.CurrentUser}，您没有权限使用该软件");
                    return;
                }
            }
            catch (Exception ex)
            {
                GlobalHelper.appendlog(ex.ToString());
                MessageBox.Show("打开软件出现异常，请联系管理员");
                return;
            }
            Application.Run(new NormativeMain());
        }
    }
}
