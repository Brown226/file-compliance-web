using Normative.Context;
using Normative.Core;
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Reflection;
using System.Windows.Forms;

namespace Normative
{
    public static class UIMarkHelper
    {
        const float cos30 = 0.866f;
        const float sin30 = 0.5f;
        public static void BindWaterMark(this Control ctrl, bool isroot = true)
        {
            try
            {
                if (ctrl == null || ctrl.IsDisposed)
                    return;
                // 绘制水印
                if (ctrl.HaveEventHandler("Paint", "BindWaterMark"))
                    return;
                ctrl.Paint += (sender, e) =>
                {
                    try
                    {
                        System.Windows.Forms.Control paintCtrl = sender as System.Windows.Forms.Control;
                        var g = e.Graphics;
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;

                        // 计算控件位置
                        int offsetX = 0;
                        int offsetY = 0;
                        while (paintCtrl.Parent != null)
                        {
                            offsetX += paintCtrl.Location.X;
                            offsetY += paintCtrl.Location.Y;
                            paintCtrl = paintCtrl.Parent;
                        }

                        // 平移画布到窗体左上角
                        g.TranslateTransform(0 - offsetX, 0 - offsetY + 128);

                        //逆时针旋转30度
                        g.RotateTransform(-30);

                        for (int x = 0; x < e.ClipRectangle.Right + 256 + offsetX; x += 256)
                        {
                            for (int y = 0; y < e.ClipRectangle.Bottom + 256 + offsetY; y += 256)
                            {
                                // 计算文字起点位置
                                float x1 = cos30 * x - sin30 * y;
                                float y1 = sin30 * x + cos30 * y;

                                //画上文字
                                g.DrawString("中国核电工程有限公司河北分公司-数字化管理科", new Font("微软雅黑", 14, FontStyle.Regular),
                                        new SolidBrush(Color.FromArgb(50, 100, 100, 100)), x1, y1);
                            }
                        }
                    }
                    catch (Exception ex)
                    {

                    }
                };
                // 子控件绑定绘制事件
                if (isroot)
                {
                    foreach (System.Windows.Forms.Control child in ctrl.Controls)
                    {
                        BindWaterMark(child, true);
                    }
                }

            }
            catch (Exception ex)
            {

            }
        }

        public static bool HaveEventHandler(this Control control, string eventName, string methodName)
        {
            //获取Control类定义的所有事件的信息
            PropertyInfo pi = (control.GetType()).GetProperty("Events", BindingFlags.Instance | BindingFlags.NonPublic);
            //获取Control对象control的事件处理程序列表
            EventHandlerList ehl = (EventHandlerList)pi.GetValue(control, null);

            //获取Control类 eventName 事件的字段信息
            FieldInfo fieldInfo = (typeof(Control)).GetField(string.Format("Event{0}", eventName), BindingFlags.Static | BindingFlags.NonPublic);
            //用获取的 eventName 事件的字段信息，去匹配 control 对象的事件处理程序列表，获取control对象 eventName 事件的委托对象
            //事件使用委托定义的，C#中的委托时多播委托，可以绑定多个事件处理程序，当事件发生时，这些事件处理程序被依次执行
            //因此Delegate对象，有一个GetInvocationList方法，用来获取这个委托已经绑定的所有事件处理程序
            Delegate d = ehl[fieldInfo.GetValue(null)];

            if (d == null)
                return false;

            foreach (Delegate del in d.GetInvocationList())
            {
                string anonymous = string.Format("<{0}>", methodName);
                //判断一下某个事件处理程序是否已经被绑定到 eventName 事件上
                if (del.Method.Name == methodName || del.Method.Name.StartsWith(anonymous))
                {
                    return true;
                }
            }

            return false;
        }

        private static string softversion;
        public static string SoftVersion
        {
            get
            {
                if (string.IsNullOrEmpty(softversion))
                {
                    try
                    {
                        softversion = Assembly.GetExecutingAssembly().GetName().Version.ToString();
                    }
                    catch (Exception ex)
                    {
                        softversion = "";
                    }
                }
                return softversion;
            }
        }

        public static void SetVersion(this Form frm)
        {
            try
            {
                string version = SoftVersion;
                if (string.IsNullOrEmpty(version))
                {
                    return;
                }
                string frmtitle = frm.Text;
                if (string.IsNullOrEmpty(frmtitle))
                {
                    frm.Text = $"版本：{version}";
                }
                else
                {
                    frm.Text = $"{frmtitle} (版本：{version})";
                }
            }
            catch (Exception ex)
            {

            }
        }

        public static string CheckVersion()
        {
            try
            {
                if (string.IsNullOrEmpty(SoftVersion))
                {
                    return "获取软件版本信息失败";
                }
                string CurrentPubVersion = NormativeDataHelper.Instance.CurrentPubSoftVersion;
                if (string.IsNullOrEmpty(CurrentPubVersion))
                {
                    return "连接服务器失败，请联系管理员";
                }
                string[] arrver = SoftVersion.Split('.');
                string[] arrpubver = CurrentPubVersion.Split('.');
                int ver0 = 0;
                int ver1 = 0;
                int pubver0 = 0;
                int pubver1 = 0;
                if (!int.TryParse(arrver[0], out ver0) || !int.TryParse(arrver[1], out ver1))
                {
                    return "当前软件版本信息有误，请联系管理员";
                }
                if (!int.TryParse(arrpubver[0], out pubver0) || !int.TryParse(arrpubver[1], out pubver1))
                {
                    return "软件版本信息有误，请联系管理员";
                }
                if (ver0 < pubver0 || ver1 < pubver1)
                {
                    return "当前版本已无法使用，请获取最新版本";
                }
                return string.Empty;
            }
            catch (Exception ex)
            {
                GlobalHelper.appendlog(ex.ToString());
                return "出现异常，请尝试重新打开软件";
            }
        }
    }
}
